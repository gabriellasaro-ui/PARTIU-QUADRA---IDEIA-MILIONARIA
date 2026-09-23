"""Casos de uso de reservas — maquina de estados, cotacao e criacao com lock.

Decisao de produto: o jogador paga primeiro (conforme doc §9.1):
pending_payment -> payment_confirmed -> requested -> confirmed -> completed.
O servidor calcula preco/fee/total (nunca confia no cliente) e o snapshot
fica no booking. O cliente apenas informa quadra, data, hora, duracao e plano.

Mensalista: um comando cria 4 bookings semanais (grupo por group_id); a
primeira carrega a mensalidade (total do mes) e as outras 3 sao sessoes
(is_session=True, total 0) que seguram o slot das semanas seguintes.
"""
import logging
import uuid
from datetime import datetime, time, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..core.config import settings
from ..core.timezone import TZ, now_local, utc_now
from ..core.ws import publish_user_event
from ..models import (
    PLAN_AVULSO,
    PLAN_MENSALISTA,
    ROLE_ADMIN,
    ROLE_GERENTE,
    ROLE_JOGADOR,
    ACTIVE_STATUSES,
    NOTIF_BOOKING_APPROVED,
    NOTIF_BOOKING_CANCELLED,
    NOTIF_BOOKING_COMPLETED,
    NOTIF_BOOKING_EXPIRED,
    NOTIF_BOOKING_REJECTED,
    NOTIF_RESERVA_SOLICITADA,
    NOTIF_PAYMENT_CONFIRMED,
    PAYMENT_CONFIRMED,
    PAYMENT_FAILED,
    PAYMENT_PENDING,
    PAYMENT_REFUNDED,
    STATUS_CANCELLED,
    STATUS_COMPLETED,
    STATUS_CONFIRMED,
    STATUS_EXPIRED,
    STATUS_PAYMENT_CONFIRMED,
    STATUS_PAYMENT_FAILED,
    STATUS_PENDING_PAYMENT,
    STATUS_REFUNDED,
    STATUS_REJECTED,
    STATUS_REQUESTED,
    Arena,
    Booking,
    BookingStatusEvent,
    Court,
    Payment,
    Review,
)
from ..repositories import bookings as repo
from ..repositories import payments as pay_repo
from ..repositories import venues as venues_repo
from sqlalchemy import select
from .catalog import _as_local, _day_window, bairro_da_arena
from .messages import ensure_conversation_for_booking
from .notifications import emit_notification, notify_booking_event
from .payments import get_provider, provider_para_conexao
from .payments.mercadopago import MercadoPagoError
from .payments import split as split_calc
from . import mercadopago_oauth as mp_oauth

logger = logging.getLogger(__name__)

ROLE_SISTEMA = "sistema"

# Transicoes permitidas por status de origem -> destino -> papeis.
TRANSITIONS: dict[str, dict[str, set[str]]] = {
    STATUS_PENDING_PAYMENT: {
        STATUS_PAYMENT_CONFIRMED: {ROLE_JOGADOR, ROLE_SISTEMA},
        STATUS_PAYMENT_FAILED: {ROLE_SISTEMA},
        STATUS_CANCELLED: {ROLE_JOGADOR, ROLE_GERENTE, ROLE_ADMIN},
        STATUS_EXPIRED: {ROLE_SISTEMA},
        # Recusar um mensalista alcanca as SESSOES, que nunca foram pagas
        # separado (total 0) e por isso estao aqui, e nao em `requested`. Sem
        # esta aresta a recusa parava no pai e as semanas seguintes seguiam
        # ocupando a quadra.
        STATUS_REJECTED: {ROLE_GERENTE},
    },
    STATUS_PAYMENT_CONFIRMED: {
        STATUS_REQUESTED: {ROLE_SISTEMA},
        STATUS_CANCELLED: {ROLE_JOGADOR, ROLE_GERENTE, ROLE_ADMIN},
        STATUS_REFUNDED: {ROLE_SISTEMA},
    },
    STATUS_REQUESTED: {
        STATUS_CONFIRMED: {ROLE_GERENTE},
        STATUS_REJECTED: {ROLE_GERENTE},
        STATUS_CANCELLED: {ROLE_JOGADOR, ROLE_GERENTE, ROLE_ADMIN},
        STATUS_EXPIRED: {ROLE_SISTEMA},
    },
    STATUS_CONFIRMED: {
        STATUS_COMPLETED: {ROLE_SISTEMA, ROLE_GERENTE},
        STATUS_CANCELLED: {ROLE_JOGADOR, ROLE_GERENTE, ROLE_ADMIN},
        STATUS_REFUNDED: {ROLE_SISTEMA},
    },
}

TERMINAL = {
    STATUS_PAYMENT_FAILED,
    STATUS_REJECTED,
    STATUS_CANCELLED,
    STATUS_EXPIRED,
    STATUS_REFUNDED,
    STATUS_COMPLETED,
}

MONTHLY_SESSIONS = 4


def _uuid_or_404(booking_id) -> uuid.UUID:
    try:
        return uuid.UUID(str(booking_id))
    except (ValueError, TypeError):
        raise HTTPException(status_code=404, detail="Reserva nao encontrada")


# --- Cotacao --------------------------------------------------------------

def compute_quote(price_cents: int, duration_h: int, *, plan: str = PLAN_AVULSO) -> dict:
    """Preco em centavos, sempre base x duracao.

    A DURACAO VALE PARA O MENSALISTA TAMBEM, e isto era um bug de dinheiro.

    O codigo dizia `base = price_cents if plan == PLAN_MENSALISTA else ...`, ou
    seja, ignorava a duracao no plano mensal — enquanto a propria docstring
    daqui afirmava "multiplicada pela duracao". A tela do app calculava certo
    (multiplicava) e o servidor calculava errado: o jogador escolhia 2h por
    semana, via "Continuar - R$ 1.046,40", avancava e o checkout dizia
    "R$ 523,20". Metade. A arena receberia metade do horario que cede.

    A mensalidade cadastrada e pelo padrao de 1h/semana. Quem trava duas horas
    por semana ocupa o dobro da quadra e paga o dobro — que e o que o card e a
    tela de escolha ja mostravam.
    """
    dur = max(1, min(3, int(duration_h or 1)))
    # `or 0` como rede: preco ausente vira zero e o erro aparece no valor, que
    # e visivel, em vez de virar 500 no meio da criacao da reserva.
    price_cents = int(price_cents or 0)
    base = price_cents * dur
    fee = round(base * settings.player_fee_rate)
    return {
        "subtotal_cents": base,
        "service_fee_cents": fee,
        "total_cents": base + fee,
        "duration_h": dur,
    }


def preco_base(court, plan: str) -> int:
    """O preco que serve de base para o plano escolhido.

    EXISTE PARA NAO HAVER DUAS CONTAS. Este calculo estava escrito duas vezes —
    uma no orcamento da tela de pagamento e outra na criacao da reserva — e so
    a segunda ganhou o fallback de mensalidade ausente. O resultado foi o pior
    tipo de divergencia: o checkout mostrava "Total R$ 0,00" e o botao dizia
    "Enviar solicitacao - R$ 0,00", enquanto a reserva, se chegasse a ser
    criada, sairia com o valor certo. O jogador via de graca o que nao era.

    `price_monthly_cents` e opcional no cadastro da quadra. Sem ele, a
    mensalidade e o preco da hora x 4 semanas — que e exatamente o que o card
    do jogador ja mostrava antes de ele tocar em reservar. Cobrar diferente do
    que estava na tela seria pior do que o zero.
    """
    if plan == PLAN_MENSALISTA:
        return court.price_monthly_cents or (court.price_cents * MONTHLY_SESSIONS)
    return court.price_cents


def quote_booking(db: Session, *, court_id, date: str, hora: str, dur: int, plan: str) -> dict:
    row = venues_repo.get_visible_court(db, court_id)
    if not row:
        raise HTTPException(status_code=404, detail="Quadra nao encontrada")
    court, _ = row
    amounts = compute_quote(preco_base(court, plan), dur, plan=plan)
    return {
        "quadraId": str(court.id),
        "plan": plan,
        "quote": amounts,
        "validUntil": (now_local() + timedelta(minutes=5)).isoformat(),
    }


# --- Datas e slots ---------------------------------------------------------

def _parse_start(date_str: str | None, hora: str, weekday: int | None = None) -> datetime:
    """Converte data+hora do jogador (fuso do produto) para UTC-aware.

    O DIA DA SEMANA DO MENSALISTA ERA IGNORADO AQUI.

    Sem `data`, a funcao caia em `now_local().date()` — HOJE — e o `weekday`
    escolhido so era guardado na coluna, nunca usado para achar a data. As
    consequencias eram duas, e as duas silenciosas:

    - a pessoa escolhia quinta e recebia quatro sessoes na TERCA, porque terca
      era o dia em que ela estava mexendo no app;
    - se a hora escolhida ja tivesse passado hoje, a criacao morria com 409
      "nao e possivel reservar um horario que ja passou" — falando de um
      horario que ninguem pediu.

    Agora, sem data explicita e com dia da semana, anda ate a proxima
    ocorrencia daquele dia. Hoje conta se a hora ainda nao passou: quem marca
    quinta as 21h, numa quinta as 18h, quer dizer hoje — mandar para a semana
    seguinte seria igualmente arbitrario, so na direcao oposta.

    A convencao bate com a do schema (0=segunda..6=domingo) e com
    `date.weekday()` do Python. Se um dos dois mudar, o mensalista comeca no
    dia errado sem nenhum erro aparecer.
    """
    try:
        hour = int(str(hora).split(":")[0])
    except (ValueError, TypeError):
        hour = 19
    hour = max(0, min(23, hour))

    if date_str:
        day = datetime.strptime(date_str, "%Y-%m-%d").date()
    else:
        agora = now_local()
        day = agora.date()
        if weekday is not None:
            passos = (int(weekday) - day.weekday()) % 7
            if passos == 0 and agora.hour >= hour:
                passos = 7
            day = day + timedelta(days=passos)

    return datetime.combine(day, time(hour, 0), tzinfo=TZ).astimezone(timezone.utc)


def _sessions(start_at: datetime, duration_h: int, plan: str) -> list[datetime]:
    if plan == PLAN_MENSALISTA:
        return [start_at + timedelta(weeks=w) for w in range(MONTHLY_SESSIONS)]
    return [start_at]


def _blocked(db: Session, court: Court, start: datetime, end: datetime) -> bool:
    """True se a janela cruza um block de manutencao/evento."""
    rows = venues_repo.blocks_for_court(db, court.id, start, end)
    for block in rows:
        b_start = _as_local(block.start_at)
        b_end = _as_local(block.end_at)
        if b_start < end and b_end > start:
            return True
    return False


def _ensure_slots_free(
    db: Session, court: Court, sessions: list[datetime], duration_h: int
) -> None:
    for start in sessions:
        end = start + timedelta(hours=duration_h)
        if repo.overlapping_bookings(db, court.id, start, end):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Horário já reservado para esta quadra",
            )
        if _blocked(db, court, start, end):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Horário indisponível (manutenção ou evento)",
            )
        _exigir_dentro_do_expediente(db, court, start, end)


def _exigir_dentro_do_expediente(
    db: Session, court: Court, start: datetime, end: datetime
) -> None:
    """A reserva tem de caber na grade que o gerente definiu para aquele dia.

    Isto faltava por completo: `_ensure_slots_free` so olhava reserva
    sobreposta e bloqueio de manutencao. Dava para reservar as 3 da manha, ou
    num dia que o gerente fechou — a agenda nem mostrava o horario, mas o POST
    aceitava, e a unica guarda era a tela nao oferecer.

    Guarda de tela nao e guarda: relogio errado, aba velha, link antigo ou uma
    chamada direta na API passam por cima. E agora que o gerente pode FECHAR um
    dia, a decisao dele precisa valer no servidor, senao e so um rotulo.
    """
    # EM HORA LOCAL. `start` chega em UTC (_parse_start converte), e a grade do
    # gerente e escrita no fuso do produto: comparar direto colocaria 19h como
    # 22h e recusaria uma reserva perfeitamente dentro do expediente. Mesma
    # armadilha de 3 horas que ja apareceu no controle de leitura do clube.
    inicio_local = _as_local(start)
    fim_local = _as_local(end)

    faixas = _day_window(db, court, inicio_local)
    if not faixas:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A quadra não abre neste dia",
        )

    # A janela pedida precisa caber INTEIRA em uma das faixas. Emendar duas
    # faixas (manha e noite, com almoco fechado no meio) reservaria o intervalo
    # fechado junto.
    hora_inicio = inicio_local.time()
    hora_fim = fim_local.time()
    # Reserva que atravessa a meia-noite nao existe no produto (max 3h dentro
    # do mesmo dia); tratar como fora do expediente e o correto e o simples.
    if hora_fim <= hora_inicio:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Horário fora do funcionamento da quadra",
        )

    for abre, fecha in faixas:
        if abre <= hora_inicio and hora_fim <= fecha:
            return

    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="Horário fora do funcionamento da quadra",
    )


def _generate_code(db: Session) -> str:
    for _ in range(10):
        suffix = uuid.uuid4().int % 90_000 + 10_000  # 5 digitos
        code = f"{settings.booking_code_prefix}{suffix}"
        exists = repo.get_booking_by_code(db, code)
        if not exists:
            return code
    raise HTTPException(status_code=500, detail="Falha ao gerar codigo da reserva")


# --- Maquina de estados -----------------------------------------------------

def _record_event(
    db: Session,
    booking: Booking,
    from_status: str | None,
    to_status: str,
    actor_id,
    actor_role: str,
    reason: str | None,
) -> None:
    db.add(
        BookingStatusEvent(
            id=uuid.uuid4(),
            booking_id=booking.id,
            from_status=from_status,
            to_status=to_status,
            actor_id=actor_id,
            actor_role=actor_role,
            reason=reason,
        )
    )


def _transition_booking(
    db: Session,
    booking: Booking,
    to_status: str,
    *,
    actor_id,
    actor_role: str,
    reason: str | None = None,
) -> Booking:
    allowed = TRANSITIONS.get(booking.status, {})
    if to_status not in allowed or actor_role not in allowed[to_status]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Transição {booking.status} -> {to_status} não permitida",
        )
    from_status = booking.status
    booking.status = to_status
    if to_status == STATUS_CANCELLED:
        booking.cancelled_at = now_local()
    elif to_status == STATUS_COMPLETED:
        booking.completed_at = now_local()
    _record_event(db, booking, from_status, to_status, actor_id, actor_role, reason)
    return booking


def _transition_group(
    db: Session,
    booking: Booking,
    to_status: str,
    *,
    actor_id,
    actor_role: str,
    reason: str | None = None,
) -> None:
    """Aplica a transicao a toda a familia (pai + sessoes de mensalista)."""
    ids = {booking.id}
    if booking.group_id:
        ids.update(b.id for b in repo.get_group(db, booking.group_id))
    targets = db.execute(select(Booking).where(Booking.id.in_(ids))).scalars().all()
    for target in targets:
        if target.status not in TERMINAL and target.status != to_status:
            _transition_booking(db, target, to_status, actor_id=actor_id, actor_role=actor_role, reason=reason)


# --- Criacao ---------------------------------------------------------------

def _clube_para_reserva(db: Session, user, club_id):
    """O clube da reserva, conferindo o cargo — ou None quando nao ha clube.

    Erros separados de proposito: "voce nao faz parte" e "voce e so jogador"
    sao problemas diferentes, e mandar a mesma frase nos dois casos faria o
    membro ficar procurando um convite que ele ja tem.
    """
    if not club_id:
        return None

    from ..models.club import CLUB_ROLES_GESTAO
    from ..repositories import clubs as clubs_repo

    clube = clubs_repo.get_club(db, club_id)
    if clube is None:
        raise HTTPException(status_code=404, detail="Clube não encontrado")
    membro = clubs_repo.get_member(db, clube.id, user.id)
    if membro is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Você não faz parte deste clube.",
        )
    if membro.role not in CLUB_ROLES_GESTAO:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Só o dono e os gerentes do clube podem marcar quadra em nome "
                "dele. Peça para alguém da gestão reservar."
            ),
        )
    return clube


def create_booking(
    db: Session,
    *,
    user,
    court_id,
    date: str | None = None,
    hora: str = "19:00",
    dur: int = 1,
    plan: str = PLAN_AVULSO,
    weekday: int | None = None,
    payment_method: str = "pix",
    club_id=None,
    idempotency_key: str | None = None,
) -> tuple[list[Booking], bool]:
    """Cria a reserva (ou o grupo mensalista) e retorna (bookings, replay)."""
    if idempotency_key:
        existing = repo.get_by_idempotency(db, idempotency_key)
        if existing is not None:
            return existing, True

    plan = PLAN_MENSALISTA if plan == PLAN_MENSALISTA else PLAN_AVULSO
    if plan == PLAN_MENSALISTA and weekday is None:
        raise HTTPException(status_code=422, detail="Mensalista exige o dia da semana (dia)")

    row = venues_repo.get_visible_court(db, court_id)
    if not row:
        raise HTTPException(status_code=404, detail="Quadra nao encontrada")
    court, arena = row

    dur = max(1, min(3, int(dur or 1)))
    start_at = _parse_start(date, hora, weekday if plan == PLAN_MENSALISTA else None)
    if start_at <= now_local():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Não é possível reservar um horário que já passou",
        )

    sessions = _sessions(start_at, dur, plan)
    repo.lock_court(db, court.id)  # serializa criacao por quadra (FOR UPDATE)
    _ensure_slots_free(db, court, sessions, dur)

    # MENSALIDADE NAO CADASTRADA NAO PODE DERRUBAR A RESERVA.
    #
    # `price_monthly_cents` e opcional no cadastro da quadra, e quando esta
    # vazio isto virava `compute_quote(None, ...)` -> TypeError -> 500. Toda
    # tentativa de virar mensalista numa quadra sem mensalidade explodia, e a
    # pessoa via "erro no servidor" sem nada dizendo o que faltava.
    #
    # O card do jogador ja mostrava `preco x 4` nesse caso, entao o valor
    # cobrado passa a ser o MESMO que ele leu antes de tocar em reservar —
    # cobrar diferente do que estava na tela seria pior do que o 500.
    # RESERVA EM NOME DO CLUBE: so quem manda nele.
    #
    # Marcar quadra e comprometer a turma inteira — data, horario e, no
    # mensalista, quatro semanas. Se qualquer membro pudesse fazer isso, o
    # clube viraria um canal por onde qualquer um convoca (e cobra) todo mundo.
    # Cargos ja existem no modelo: dono e admin mandam, membro so responde se
    # vai. A checagem e AQUI, no servico, e nao na tela — tela some, rota fica.
    clube = _clube_para_reserva(db, user, club_id)

    amounts = compute_quote(preco_base(court, plan), dur, plan=plan)
    group_id = uuid.uuid4() if plan == PLAN_MENSALISTA else None

    created: list[Booking] = []
    for index, start in enumerate(sessions):
        is_session = plan == PLAN_MENSALISTA and index > 0
        # Grava paredes UTC (sem tz) — colunas sao naive; `_as_local` re-fusiona.
        start_utc = start.astimezone(timezone.utc).replace(tzinfo=None)
        booking = Booking(
            id=uuid.uuid4(),
            code=_generate_code(db),
            arena_id=arena.id,
            court_id=court.id,
            user_id=user.id,
            status=STATUS_PENDING_PAYMENT,
            plan=plan,
            start_at=start_utc,
            end_at=start_utc + timedelta(hours=dur),
            duration_h=dur,
            weekday=weekday,
            subtotal_cents=0 if is_session else amounts["subtotal_cents"],
            service_fee_cents=0 if is_session else amounts["service_fee_cents"],
            total_cents=0 if is_session else amounts["total_cents"],
            payment_method=payment_method,
            quote_snapshot=amounts,
            group_id=group_id,
            club_id=clube.id if clube else None,
            is_session=is_session,
            idempotency_key=idempotency_key if index == 0 else None,
            source="app",
            created_by=user.id,
        )
        db.add(booking)
        db.flush()
        _record_event(
            db,
            booking,
            None,
            STATUS_PENDING_PAYMENT,
            user.id,
            ROLE_JOGADOR,
            None,
        )
        created.append(booking)

    try:
        db.commit()
    except IntegrityError:
        # Rede de protecao para a corrida que escapa do lock da court: o indice
        # parcial uq_booking_slot_ativo pega no banco. O cliente recebe o mesmo
        # 409 da checagem de sobreposicao, nunca um erro de banco cru.
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Horário já reservado para esta quadra",
        )
    return created, False


# --- Leitura ---------------------------------------------------------------

_STATUS_LABEL = {
    STATUS_PENDING_PAYMENT: "Aguardando pagamento",
    STATUS_PAYMENT_CONFIRMED: "Solicitada",
    STATUS_REQUESTED: "Solicitada",
    STATUS_CONFIRMED: "Confirmada",
    STATUS_COMPLETED: "Concluída",
    STATUS_REJECTED: "Não aceita pela arena",
    STATUS_EXPIRED: "Tempo expirado",
    STATUS_CANCELLED: "Cancelada",
    STATUS_PAYMENT_FAILED: "Pagamento falhou",
    STATUS_REFUNDED: "Reembolsada",
}

_STATUS_CLASS = {
    STATUS_PENDING_PAYMENT: "pendente",
    STATUS_PAYMENT_CONFIRMED: "pendente",
    STATUS_REQUESTED: "pendente",
    STATUS_CONFIRMED: "pago",
    STATUS_COMPLETED: "concluido",
    STATUS_REJECTED: "cancelado",
    STATUS_EXPIRED: "cancelado",
    STATUS_CANCELLED: "cancelado",
    STATUS_PAYMENT_FAILED: "cancelado",
    STATUS_REFUNDED: "cancelado",
}


def _date_label(dt: datetime) -> tuple[str, str]:
    local = _as_local(dt)
    return local.strftime("%d/%m/%Y"), local.strftime("%Y-%m-%d")


def _to_reservation(booking: Booking, court: Court, arena: Arena) -> dict:
    local = _as_local(booking.start_at)
    date_label, date_value = _date_label(booking.start_at)
    in_future = booking.status in ACTIVE_STATUSES and local > now_local()
    return {
        "id": str(booking.id),
        "code": booking.code,
        "venueId": str(court.id),
        "venueName": arena.name,
        "sport": court.sport,
        "neighborhood": bairro_da_arena(arena),
        "image": (court.photos or [""])[0],
        "date": date_label,
        "dateValue": date_value,
        "hour": local.strftime("%H:%M"),
        "endHour": _as_local(booking.end_at).strftime("%H:%M"),
        "duration": booking.duration_h,
        "plan": booking.plan,
        "weekday": booking.weekday,
        "subtotal": booking.subtotal_cents / 100,
        "serviceFee": booking.service_fee_cents / 100,
        "price": booking.total_cents / 100,
        "status": _STATUS_LABEL.get(booking.status, booking.status),
        "statusClass": _STATUS_CLASS.get(booking.status, "pendente"),
        "group": "proxima" if in_future else "historico",
        "statusAt": _as_local(booking.updated_at).isoformat() if booking.updated_at else None,
    }


def _player_reservations(db: Session, user) -> list[dict]:
    rows = repo.list_user_bookings(db, user.id)
    parents = [r for r in rows if not r[0].is_session]
    return [_to_reservation(b, c, a) for b, c, a in parents]


def list_for_player(db: Session, user) -> list[dict]:
    return _player_reservations(db, user)


def serialize(db: Session, booking: Booking) -> dict:
    row = repo.get_booking(db, booking.id)
    if not row:
        return {}
    booking, court, arena = row
    return _to_reservation(booking, court, arena)


def get_reservation(db: Session, user, booking_id) -> tuple[Booking, Court, Arena]:
    booking_id = _uuid_or_404(booking_id)
    row = repo.get_booking(db, booking_id)
    if not row:
        raise HTTPException(status_code=404, detail="Reserva nao encontrada")
    booking, court, arena = row
    _check_access(db, user, booking, arena)
    return booking, court, arena


def _check_access(db: Session, user, booking: Booking, arena: Arena) -> None:
    if user.role == ROLE_ADMIN:
        return
    if booking.user_id == user.id:
        return
    if user.role == ROLE_GERENTE and arena.owner_id == user.id:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN, detail="Acesso negado a esta reserva"
    )


def _notify_booking_update(db: Session, booking: Booking) -> None:
    """Publica `booking.updated` no socket do jogador e do dono da arena."""
    payload = serialize(db, booking)
    if not payload:
        return
    event = {"type": "booking.updated", "reserva": payload}
    publish_user_event(booking.user_id, event)
    arena = db.get(Arena, booking.arena_id)
    if arena is not None and arena.owner_id and arena.owner_id != booking.user_id:
        publish_user_event(arena.owner_id, event)


def manager_owns_arena(db: Session, manager, arena: Arena) -> None:
    if manager.role == ROLE_ADMIN:
        return
    if arena.owner_id != manager.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acesso restrito à sua arena",
        )


def get_events(db: Session, user, booking_id) -> list[dict]:
    booking, court, arena = get_reservation(db, user, booking_id)
    return [
        {
            "from": ev.from_status,
            "to": ev.to_status,
            "actorRole": ev.actor_role,
            "reason": ev.reason,
            "at": _as_local(ev.created_at).isoformat(),
        }
        for ev in repo.events_for_booking(db, booking.id)
    ]


# --- Transicoes de dominio -------------------------------------------------

def _provider_para_cobranca(db: Session, booking):
    """Quem cobra esta reserva, e com que valores.

    Com o split ligado, quem cobra e a ARENA: o Bearer leva o token dela e a
    Qadras retem `application_fee` na mesma transacao. Sem split, segue o
    caminho antigo de conta unica (o mock de dev cai aqui tambem).
    """
    amounts = {"total_cents": booking.total_cents}
    usa_split = (
        settings.mercadopago_split_enabled
        and settings.payment_provider.strip().lower() == "mercadopago"
    )
    if not usa_split:
        return get_provider(), amounts

    conexao = mp_oauth.connection_for_arena(db, booking.arena_id)
    if conexao is None:
        # 409 e nao 500: nao e defeito, e cadastro incompleto. A mensagem
        # precisa dizer de quem e a pendencia, senao o jogador leva a culpa
        # por algo que so o dono da arena resolve.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Esta arena ainda nao conectou a conta de recebimento e nao "
                "pode receber pagamentos. Avise o responsavel pela quadra."
            ),
        )

    # Rede de seguranca da task diaria: se o beat estiver parado ha dias, o
    # token pode estar perto de vencer. Falhar aqui NAO derruba a cobranca —
    # o token so vence de fato em `expires_at`, e ate la ele cobra.
    try:
        conexao = mp_oauth.refresh_if_needed(db, conexao)
    except mp_oauth.MercadoPagoOAuthError as erro:
        logger.warning(
            "renovacao preventiva falhou arena=%s: %s", booking.arena_id, erro
        )

    amounts.update(
        split_calc.calcular(
            booking.subtotal_cents, booking.total_cents, conexao.fee_rate
        )
    )
    return provider_para_conexao(conexao), amounts


def pay_booking(db: Session, user, booking_id) -> tuple[Booking, Payment, bool]:
    """Fase 5: cria o intent Pix no provider — nao transiciona na hora.

    A reserva so sai de pending_payment pelo webhook (confirm_payment),
    nunca pelo clique no botao. O retorno carrega o intent para o cliente.
    """
    booking, _, _ = get_reservation(db, user, booking_id)
    if booking.user_id != user.id and user.role != ROLE_ADMIN:
        raise HTTPException(status_code=403, detail="Acesso negado a esta reserva")
    if booking.is_session:
        raise HTTPException(
            status_code=409, detail="Sessão de mensalista não é cobrada à parte"
        )
    if booking.status != STATUS_PENDING_PAYMENT:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Reserva fora do estado de pagamento",
        )
    if now_local() - _as_local(booking.created_at) >= timedelta(
        minutes=settings.booking_payment_expire_minutes
    ):
        _transition_group(
            db,
            booking,
            STATUS_EXPIRED,
            actor_id=None,
            actor_role=ROLE_SISTEMA,
            reason="Prazo de pagamento expirado",
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Prazo de pagamento expirado"
        )

    existing = pay_repo.get_by_booking(db, booking.id)
    if existing is not None:
        if existing.status != PAYMENT_PENDING:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Pagamento já finalizado para esta reserva",
            )
        return booking, existing, True  # mesmo intent (replay)

    provider, amounts = _provider_para_cobranca(db, booking)
    try:
        intent = provider.create_payment(booking=booking, amounts=amounts)
    except MercadoPagoError as erro:
        # 409, E NAO 502, por um motivo pratico: o proxy do EasyPanel
        # substitui o corpo de respostas 5xx pela pagina de erro dele. O
        # motivo da recusa — a unica coisa util aqui — nunca chegava ao
        # cliente, e a correcao que tornou o erro visivel virava inutil em
        # producao. 4xx passa intacto.
        #
        # Semanticamente tambem se defende: a cobranca nao pode ser criada no
        # estado atual (conta do vendedor mal configurada, credencial de
        # ambiente trocado), e nao "a Qadras esta fora do ar".
        logger.warning("cobranca recusada reserva=%s: %s", booking.code, erro)
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(erro))
    payment = Payment(
        id=uuid.uuid4(),
        booking_id=booking.id,
        user_id=booking.user_id,
        provider=intent.provider,
        method=intent.method,
        amount_cents=intent.amount_cents,
        status=PAYMENT_PENDING,
        provider_ref=intent.provider_ref,
        payload=intent.payload,
        qr_code=intent.qr_code,
        qr_code_image=intent.qr_code_image,
        expires_at=(
            intent.expires_at.astimezone(timezone.utc).replace(tzinfo=None)
            if intent.expires_at
            else None
        ),
    )
    db.add(payment)
    db.commit()
    _notify_booking_update(db, booking)
    return booking, payment, False


def confirm_payment(
    db: Session,
    *,
    webhook_id: str,
    status: str,
    provider_ref: str | None = None,
    booking_id=None,
    amount_cents: int | None = None,
    payload: dict | None = None,
) -> tuple[Payment, bool]:
    """Webhook do provedor: confirma/recusa o pagamento de forma idempotente.

    webhook_id UNIQUE vira replay silencioso; IntegrityError nunca e devolvido
    ao provedor. Booking terminal (webhook atrasado) -> Payment refunded,
    sem transicionar estado terminal de volta.

    `amount_cents` e obrigatorio e precisa bater com o valor cobrado: o
    callback diz quanto entrou, e uma reserva so avanca se entrou o valor
    inteiro. Sem essa conferencia, um callback com 1 centavo confirmava uma
    reserva de R$ 130,80.
    """
    payment = None
    if provider_ref:
        payment = pay_repo.get_by_provider_ref(db, provider_ref)
    if payment is None and booking_id is not None:
        payment = pay_repo.get_by_booking(db, booking_id)
    if payment is None:
        raise HTTPException(status_code=404, detail="Pagamento não encontrado")

    if payment.status in (PAYMENT_CONFIRMED, PAYMENT_FAILED, PAYMENT_REFUNDED):
        return payment, True  # replay de callback

    if status == "confirmed":
        if amount_cents is None:
            raise HTTPException(
                status_code=400, detail="Callback sem o valor pago"
            )
        if int(amount_cents) != int(payment.amount_cents):
            raise HTTPException(
                status_code=400,
                detail="Valor do pagamento não confere com a cobrança",
            )

    if webhook_id:
        used = pay_repo.get_by_webhook_id(db, webhook_id)
        if used is not None and used.id != payment.id:
            return payment, True  # id ja consumido por outro intent

    booking = db.get(Booking, payment.booking_id)
    if booking is None:
        raise HTTPException(status_code=404, detail="Reserva não encontrada")

    payment.webhook_id = webhook_id
    payment.payload = {**(payload or {}), **(payment.payload or {})}

    if status == "confirmed":
        payment.status = PAYMENT_CONFIRMED
        payment.paid_at = utc_now()
        if booking.status == STATUS_PENDING_PAYMENT:
            _transition_booking(
                db, booking, STATUS_PAYMENT_CONFIRMED,
                actor_id=None, actor_role=ROLE_SISTEMA, reason="Pagamento confirmado",
            )
            _transition_booking(
                db, booking, STATUS_REQUESTED,
                actor_id=None, actor_role=ROLE_SISTEMA, reason="Pagamento confirmado",
            )
            # Fase 6: reserva paga => "Falar com a arena" liberado.
            ensure_conversation_for_booking(db, booking)
        elif booking.status in TERMINAL:
            payment.status = PAYMENT_REFUNDED
            payment.paid_at = None
            payment.payload = {
                **(payment.payload or {}),
                "refund": "Webhook após estado terminal",
            }
    elif status == "failed":
        payment.status = PAYMENT_FAILED
        if booking.status == STATUS_PENDING_PAYMENT:
            _transition_booking(
                db, booking, STATUS_PAYMENT_FAILED,
                actor_id=None, actor_role=ROLE_SISTEMA, reason="Pagamento recusado pelo provedor",
            )
    else:
        return payment, True  # evento nao reconhecido: ignora

    db.commit()
    _notify_booking_update(db, booking)
    if payment.status == PAYMENT_CONFIRMED and booking.status == STATUS_REQUESTED:
        notify_booking_event(db, booking, NOTIF_PAYMENT_CONFIRMED)
        _avisar_solicitacao(db, booking)
    return payment, False


def _avisar_solicitacao(db: Session, booking: Booking) -> None:
    """Avisa o DONO da arena que chegou uma solicitacao para decidir.

    Separado do `payment.confirmed` de proposito: aquele e o recibo, este e o
    pedido de decisao. O dono tem 15 minutos para aprovar antes da reserva
    expirar sozinha — se essa mensagem se misturar aos avisos de pagamento, a
    janela passa enquanto ele le contabilidade.

    Vai por TRES caminhos, e cada um cobre um buraco do outro:
      - linha in-app, que sobrevive ao fechamento do app;
      - push, para quando o painel nao esta aberto;
      - WebSocket, para o toast aparecer na hora em quem esta com a tela
        aberta no balcao.
    """
    arena = db.get(Arena, booking.arena_id)
    if arena is None or not arena.owner_id:
        return

    court = db.get(Court, booking.court_id)
    quando = _as_local(booking.start_at)
    quadra = court.name if court is not None else "sua quadra"
    corpo = (
        f"{quadra} · {quando.strftime('%d/%m')} às {quando.strftime('%H:%M')}"
        f" · {booking.code}"
    )
    dados = {
        "bookingId": str(booking.id),
        "bookingCode": booking.code,
        "arenaId": str(booking.arena_id),
        "courtName": quadra,
        "startAt": quando.isoformat(),
    }

    emit_notification(
        db, arena.owner_id,
        type=NOTIF_RESERVA_SOLICITADA,
        title="Nova solicitação de reserva",
        body=corpo,
        data=dados,
    )
    publish_user_event(arena.owner_id, {
        "type": NOTIF_RESERVA_SOLICITADA,
        "titulo": "Nova solicitação de reserva",
        "texto": corpo,
        "reservaId": str(booking.id),
        "codigo": booking.code,
    })


def get_payment_record(db: Session, user, payment_id) -> Payment:
    payment = pay_repo.get_payment(db, payment_id)
    if payment is None:
        raise HTTPException(status_code=404, detail="Pagamento não encontrado")
    if user.role != ROLE_ADMIN and payment.user_id != user.id:
        raise HTTPException(status_code=403, detail="Acesso negado a este pagamento")
    return payment


_PAYMENT_STATUS_LABEL = {
    PAYMENT_PENDING: "Aguardando pagamento",
    PAYMENT_CONFIRMED: "Pago",
    PAYMENT_FAILED: "Falhou",
    PAYMENT_REFUNDED: "Reembolsado",
}


def serialize_payment(payment: Payment) -> dict:
    return {
        "id": str(payment.id),
        "bookingId": str(payment.booking_id),
        "provider": payment.provider,
        "method": payment.method,
        "amount": payment.amount_cents / 100,
        "status": payment.status,
        "statusLabel": _PAYMENT_STATUS_LABEL.get(payment.status, payment.status),
        "qrCode": payment.qr_code,
        "qrCodeImage": payment.qr_code_image,
        "expiresAt": _as_local(payment.expires_at).isoformat() if payment.expires_at else None,
        "providerRef": payment.provider_ref,
    }


def approve_booking(db: Session, manager, booking_id) -> Booking:
    booking, _, arena = get_reservation(db, manager, booking_id)
    manager_owns_arena(db, manager, arena)
    _transition_booking(
        db, booking, STATUS_CONFIRMED, actor_id=manager.id, actor_role=ROLE_GERENTE
    )
    db.commit()
    _notify_booking_update(db, booking)
    notify_booking_event(db, booking, NOTIF_BOOKING_APPROVED)
    return booking


def _estornar_se_pago(db: Session, booking, motivo: str) -> bool:
    """Devolve o dinheiro quando uma reserva JA PAGA deixa de acontecer.

    O DEFEITO QUE ISTO CORRIGE. O estorno existia em um unico caminho — a
    arena ignorar a solicitacao ate o prazo vencer. Recusar ativamente, ou o
    jogador cancelar, apenas mudava o status da reserva e o dinheiro ficava
    onde estava. O incentivo saia invertido: ignorar devolvia, recusar nao.
    Passou meses sem aparecer porque com PAYMENT_PROVIDER=mock o `refund` da
    classe base devolve True sem fazer nada — nenhum teste podia pegar.

    Devolucao INTEGRAL, e a comissao da Qadras volta junto (decisao de
    2026-09-23): no split o Mercado Pago divide o estorno proporcionalmente
    entre vendedor e marketplace, entao basta pedir o estorno total.

    QUANDO O ESTORNO FALHA o Payment NAO e marcado como estornado. Marcar
    seria mentir no relatorio financeiro e esconder dinheiro presos: fica
    `confirmed` com `refund_falhou` no payload, e o log sai em ERROR para
    alguem agir. A reserva transiciona de qualquer forma — uma falha do
    adquirente nao pode impedir a arena de recusar.
    """
    pay = pay_repo.get_by_booking(db, booking.id)
    if pay is None or pay.status != PAYMENT_CONFIRMED:
        return False

    # O TOKEN TEM DE SER O DA ARENA.
    #
    # `get_provider` devolve o provider com o token GLOBAL da Qadras, e no
    # split a cobranca vive na conta da arena — o token global nao enxerga o
    # pagamento dela e o estorno volta 404. Mesmo cuidado do webhook e do
    # sincronizar; aqui passou batido na primeira versao, e o sintoma era o
    # pior possivel: a reserva recusada e o dinheiro ficando na arena, em
    # silencio.
    provedor = get_provider(pay.provider)
    if settings.mercadopago_split_enabled and pay.provider_ref:
        provedor = provider_do_pagamento(db, pay.provider_ref) or provedor

    try:
        ok = bool(provedor.refund(pay))
    except Exception as erro:  # adquirente fora do ar, token vencido, etc.
        logger.error(
            "ESTORNO FALHOU reserva=%s pagamento=%s: %s", booking.code, pay.id, erro
        )
        ok = False

    if ok:
        pay.status = PAYMENT_REFUNDED
        pay.payload = {**(pay.payload or {}), "refund": motivo}
    else:
        logger.error(
            "ESTORNO FALHOU reserva=%s pagamento=%s motivo=%s — dinheiro retido",
            booking.code, pay.id, motivo,
        )
        pay.payload = {**(pay.payload or {}), "refund_falhou": motivo}
    db.flush()
    return ok


def reject_booking(db: Session, manager, booking_id, reason: str | None = None) -> Booking:
    booking, _, arena = get_reservation(db, manager, booking_id)
    manager_owns_arena(db, manager, arena)
    # Grupo, nao a linha: a arena esta dizendo nao ao mensalista inteiro. Com
    # `_transition_booking` so o pai virava `rejected` e as tres sessoes
    # seguiam `pending_payment` — segurando a quadra por tres semanas para uma
    # reserva que ninguem aprovou, e sem nada na tela denunciando isso: o dono
    # ve "ocupado" e conclui que vendeu.
    _transition_group(
        db, booking, STATUS_REJECTED, actor_id=manager.id, actor_role=ROLE_GERENTE, reason=reason
    )
    # O jogador nao deu causa: devolucao integral.
    _estornar_se_pago(db, booking, reason or "Recusada pela arena")
    db.commit()
    _notify_booking_update(db, booking)
    notify_booking_event(db, booking, NOTIF_BOOKING_REJECTED)
    return booking


def cancel_booking(db: Session, user, booking_id, reason: str | None = None) -> Booking:
    booking, _, arena = get_reservation(db, user, booking_id)
    _transition_group(
        db,
        booking,
        STATUS_CANCELLED,
        actor_id=user.id,
        actor_role=user.role,
        reason=reason,
    )
    _estornar_se_pago(db, booking, reason or "Reserva cancelada")
    db.commit()
    _notify_booking_update(db, booking)
    notify_booking_event(db, booking, NOTIF_BOOKING_CANCELLED)
    return booking


# --- Sistema (Celery) ------------------------------------------------------

def expire_stale(db: Session, *, now: datetime | None = None) -> int:
    """Expira pending_payment vencidas e requested sem resposta da arena.

    A janela de aprovacao conta a partir do PAGAMENTO, nao da criacao: as duas
    janelas sao 15 min, entao contar de `created_at` daria a arena so o que
    sobrou do relogio do jogador — quem pagasse no minuto 14 deixaria 1 minuto
    para a arena responder, e a reserva morreria com o dinheiro ja retido.
    """
    now = now or now_local()
    targets = db.execute(
        select(Booking).where(
            Booking.status.in_([STATUS_PENDING_PAYMENT, STATUS_REQUESTED]),
            # Sessao de mensalista nao expira sozinha. Ela nao tem pagamento
            # proprio (total 0) e fica em `pending_payment` mesmo depois do pai
            # ser pago e aprovado — para a varredura isso parecia abandono, e
            # 15 min apos a criacao ela expirava LEVANDO O GRUPO, inclusive um
            # pai `confirmed`. Como confirmed -> expired nao existe no mapa, o
            # que saia dali era uma excecao no meio do laco de manutencao.
            # Quem manda na vida da sessao e o pai, via _transition_group.
            Booking.is_session.is_(False),
        )
    ).scalars().all()
    count = 0
    notified: list[Booking] = []
    for booking in targets:
        pay = pay_repo.get_by_booking(db, booking.id)
        if booking.status == STATUS_PENDING_PAYMENT:
            window = timedelta(minutes=settings.booking_payment_expire_minutes)
            inicio = _as_local(booking.created_at)
        else:
            window = timedelta(minutes=settings.booking_approval_expire_minutes)
            pago_em = pay.paid_at if pay is not None else None
            inicio = _as_local(pago_em or booking.created_at)
        if now - inicio >= window:
            _transition_group(
                db,
                booking,
                STATUS_EXPIRED,
                actor_id=None,
                actor_role=ROLE_SISTEMA,
                reason="Prazo de pagamento/aprovação expirado",
            )
            if pay is not None and pay.status == PAYMENT_PENDING:
                pay.status = PAYMENT_FAILED
                pay.payload = {**(pay.payload or {}), "expired": True}
            elif pay is not None and pay.status == PAYMENT_CONFIRMED:
                # O jogador pagou e a arena nao respondeu: o dinheiro volta.
                # Mesmo caminho da recusa e do cancelamento — a logica vive em
                # um lugar so para nao divergir de novo.
                _estornar_se_pago(db, booking, "Arena não respondeu no prazo")
            count += 1
            notified.append(booking)
            db.flush()
            _notify_booking_update(db, booking)
    db.commit()
    for booking in notified:
        notify_booking_event(db, booking, NOTIF_BOOKING_EXPIRED)
    return count


def complete_finished(db: Session, *, now: datetime | None = None) -> int:
    """Confirmadas cujo horario terminou -> completed.

    O SQLite grava datas naive em UTC; comparamos contra now convertido
    para UTC para nao depender do fuso do processo.
    """
    now = now or now_local()
    utc_now = (
        now.astimezone(timezone.utc).replace(tzinfo=None) if now.tzinfo else now
    )
    targets = db.execute(
        select(Booking).where(
            Booking.status == STATUS_CONFIRMED,
            Booking.end_at <= utc_now,
        )
    ).scalars().all()
    count = 0
    notified: list[Booking] = []
    for booking in targets:
        _transition_booking(
            db,
            booking,
            STATUS_COMPLETED,
            actor_id=None,
            actor_role=ROLE_SISTEMA,
            reason="Horário concluído",
        )
        count += 1
        notified.append(booking)
        db.flush()
        _notify_booking_update(db, booking)
    db.commit()
    for booking in notified:
        notify_booking_event(db, booking, NOTIF_BOOKING_COMPLETED)
    return count


# --- Avaliacao -------------------------------------------------------------

def create_review(db: Session, user, booking_id, rating: int, comment: str | None) -> Review:
    booking, court, arena = get_reservation(db, user, booking_id)
    if booking.user_id != user.id:
        raise HTTPException(status_code=403, detail="Acesso negado a esta reserva")
    if booking.status != STATUS_COMPLETED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Só é possível avaliar uma reserva concluída",
        )
    existing = db.execute(
        select(Review).where(Review.booking_id == booking.id)
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Reserva já avaliada"
        )
    rating = max(1, min(5, int(rating)))
    review = Review(
        id=uuid.uuid4(),
        booking_id=booking.id,
        arena_id=arena.id,
        user_id=user.id,
        rating=rating,
        comment=comment,
    )
    db.add(review)
    db.commit()
    return review


def provider_do_pagamento(db: Session, provider_ref: str):
    """Provider com o token da ARENA dona daquele pagamento, ou None.

    O webhook do Mercado Pago so traz o id do pagamento — nem o status, nem de
    quem ele e. Para perguntar o status e preciso o token de QUEM COBROU, e no
    split quem cobrou foi a arena. Consultar com o token global devolve 404, a
    rota trataria como evento desconhecido, e a reserva ficaria pendente para
    sempre com o dinheiro ja pago.
    """
    payment = pay_repo.get_by_provider_ref(db, provider_ref)
    if payment is None:
        return None
    booking = db.get(Booking, payment.booking_id)
    if booking is None:
        return None
    conexao = mp_oauth.connection_for_arena(db, booking.arena_id)
    if conexao is None or not conexao.access_token:
        return None
    return provider_para_conexao(conexao)
