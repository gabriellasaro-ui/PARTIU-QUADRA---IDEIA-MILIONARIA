"""Casos de uso do painel do gerente — Fase 8.

Todo endpoint resolve a arena do gerente pelo token e opera nela. O
financeiro usa o ledger de payments confirmados (nunca status visual).
Reserva manual cria Booking(source="manual", created_by=manager) + Payment
(provider="manual") para a arena ser ressarcida pelo mesmo fluxo do app.
"""
import uuid
from datetime import datetime, time, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import delete
from sqlalchemy.orm import Session

from ..core.config import settings
from ..core.cache import bump_catalog_version
from ..core.timezone import TZ, now_local, utc_now
from ..models import (
    ACTIVE_STATUSES,
    Arena,
    Booking,
    BookingStatusEvent,
    Coupon,
    Court,
    CourtRecurringAvailability,
    Payment,
    PLAN_AVULSO,
    PLAN_MENSALISTA,
    Review,
    ROLE_GERENTE,
    Settlement,
    SETTLEMENT_PENDING,
    STATUS_CANCELLED,
    STATUS_COMPLETED,
    STATUS_CONFIRMED,
    STATUS_EXPIRED,
    STATUS_PAYMENT_CONFIRMED,
    STATUS_PAYMENT_FAILED,
    STATUS_PENDING_PAYMENT,
    STATUS_REJECTED,
    STATUS_REQUESTED,
)
from ..repositories import bookings as bookings_repo
from ..repositories import gerente as repo
from ..repositories import venues as venues_repo
from .bookings import (
    _STATUS_CLASS,
    _STATUS_LABEL,
    _blocked,
    _ensure_slots_free,
    _generate_code,
    _record_event,
    _sessions,
    compute_quote,
)
from .catalog import _as_local, _day_window

PAYMENT_MANUAL = "manual"


# --- Helpers --------------------------------------------------------------

def manager_arena_or_404(db: Session, manager) -> Arena:
    arena = repo.manager_arena(db, manager.id)
    if arena is None:
        raise HTTPException(
            status_code=404, detail="Arena não encontrada para este gerente"
        )
    return arena


def _price_cents(value: float | None) -> int:
    if value is None:
        raise HTTPException(status_code=422, detail="Valor inválido")
    try:
        cents = int(round(float(value) * 100))
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail="Valor inválido")
    if cents < 1:
        raise HTTPException(status_code=422, detail="Valor deve ser maior que zero")
    return cents


def _time_field(value: str, default="08:00") -> time:
    try:
        h, m = str(value).split(":")
        return time(int(h), int(m))
    except (ValueError, TypeError):
        return time(*[int(p) for p in default.split(":")])


def _client_name(booking: Booking, user) -> str:
    if booking.client_name:
        return booking.client_name
    return user.name if user else (booking.user_id and str(booking.user_id)) or ""


def _client_phone(booking: Booking, user) -> str:
    if booking.client_phone:
        return booking.client_phone
    return getattr(user, "phone", None) or ""


# Nomes na forma que a frase pede: "toda quinta", "todo sabado".
_DIAS_SEMANA = [
    "toda segunda", "toda terça", "toda quarta", "toda quinta",
    "toda sexta", "todo sábado", "todo domingo",
]


# Um mensalista trava um horario por semana: quatro sessoes no mes. O mesmo
# numero que services/bookings.py usa para criar as sessoes.
SESSOES_NO_MES = 4


def serialize_booking(booking: Booking, court: Court, arena: Arena, user, sessoes=None) -> dict:
    local = _as_local(booking.start_at)
    local_end = _as_local(booking.end_at)

    """SESSAO DE MENSALISTA NAO E R$ 0,00 — ela esta inclusa no mes.

    O plano e cobrado UMA vez: a reserva-pai leva o valor do mes e as tres
    sessoes seguintes ficam com subtotal zero no banco. Isso e correto para a
    contabilidade e ILEGIVEL na tela: em "Proximas reservas" o dono via
    "05/09 R$ 480,00", "12/09 R$ 0,00", "19/09 R$ 0,00" — tres jogos que
    parecem de graca, ou um sistema que perdeu o valor.

    Aqui a sessao passa a mostrar quanto ela vale DENTRO do plano. O numero e
    de exibicao e nao muda nada do que foi cobrado: os totais do financeiro
    somam `subtotal_cents` direto do banco (repo.revenue_for_period), sem
    passar por este serializer. E a fila de Reservas do painel esconde as
    sessoes (`semSessoes`), entao nao ha risco de somar o mes duas vezes.
    """
    valor = booking.subtotal_cents / 100
    total = booking.total_cents / 100
    if booking.plan == PLAN_MENSALISTA and booking.is_session and not booking.subtotal_cents:
        # A parcela sai da QUADRA, que o serializer ja recebe: a mensalidade
        # dividida pelas sessoes do mes. Sem mensalidade cadastrada vale a
        # mesma regra do resto do sistema — o preco da hora.
        mensal = (court.price_monthly_cents or (court.price_cents * SESSOES_NO_MES)) if court else 0
        valor = round(mensal / SESSOES_NO_MES / 100, 2)
        total = valor

    return {
        "id": str(booking.id),
        "code": booking.code,
        "cliente": _client_name(booking, user),
        "telefone": _client_phone(booking, user),
        "quadra": court.name,
        "esporte": court.sport,
        "data": local.strftime("%d/%m/%Y"),
        "dataValue": local.strftime("%Y-%m-%d"),
        "hora": f"{local.strftime('%H:%M')} – {local_end.strftime('%H:%M')}",
        "valor": valor,
        "total": total,
        "repasse": round(booking.subtotal_cents * (1 - settings.arena_fee_rate) / 100, 2),
        "status": _STATUS_LABEL.get(booking.status, booking.status),
        "statusClass": _STATUS_CLASS.get(booking.status, "pendente"),
        "statusAt": _as_local(booking.updated_at).isoformat() if booking.updated_at else None,
        "plan": booking.plan,
        # COMO ESTE COMPROMISSO SE REPETE.
        #
        # A tela do dono mostrava so a data — "03/09/2026 · 18:00 – 20:00" —
        # e um mensalista de toda quinta era indistinguivel de um avulso de um
        # dia so. O dono aprovava sem saber que estava cedendo o horario por
        # quatro semanas.
        "recorrencia": (
            _DIAS_SEMANA[booking.weekday]
            if booking.plan == PLAN_MENSALISTA and booking.weekday is not None
            else None
        ),
        # OS DIAS QUE ELE ESTA PEDINDO.
        #
        # "toda quinta" diz o padrao, nao o compromisso: o dono aprova quatro
        # datas concretas e precisa ver quais sao antes de dizer sim. Sem elas,
        # descobrir que uma cai num feriado ou num torneio so acontece depois.
        "sessoes": sessoes or [],
        "source": booking.source,
    }


def serialize_court(court: Court) -> dict:
    return {
        "id": str(court.id),
        "nome": court.name,
        "esporte": court.sport,
        "descricao": court.description,
        "preco": court.price_cents / 100,
        "precoMensalista": (court.price_monthly_cents / 100) if court.price_monthly_cents else None,
        "duracaoMinima": court.min_duration_h,
        "abertura": court.opening_time.strftime("%H:%M") if court.opening_time else "08:00",
        "fechamento": court.closing_time.strftime("%H:%M") if court.closing_time else "23:00",
        "ativa": court.is_active,
        "visivel": court.is_visible,
        "destaque": court.is_featured,
        "fotos": court.photos or [],
        "comodidades": court.amenities or [],
    }


def _serialize_settlement(s: object) -> dict:
    label, cls = "Em aberto", "pendente"
    if s.status == "paid":
        label, cls = "Pago", "pago"
    elif s.status == "failed":
        label, cls = "Falhou", "falhou"
    return {
        "id": str(s.id),
        "periodo": f"{_as_local(s.period_start).strftime('%d/%m')} a {_as_local(s.period_end).strftime('%d/%m')}",
        "reservas": s.bookings_count,
        "bruto": s.gross_cents / 100,
        "comissao": s.commission_cents / 100,
        "liquido": s.net_cents / 100,
        "status": label,
        "cls": cls,
        "vencimento": _as_local(s.due_at).strftime("%d/%m/%Y") if s.due_at else None,
        "comprovante": s.receipt_url,
    }


def _serialize_coupon(c: Coupon, arena) -> dict:
    return {
        "id": str(c.id),
        "codigo": c.code,
        "desconto": c.discount_percent,
        "courtId": str(c.court_id) if c.court_id else None,
        "quadra": None if not c.court_id else "Todas as quadras",
        "ativo": c.active,
        "expiraEm": _as_local(c.expires_at).strftime("%Y-%m-%d") if c.expires_at else None,
        "maxUsos": c.max_uses,
        "usos": c.used_count,
    }


# --- Dashboard ------------------------------------------------------------

def _week_bounds(day=None) -> tuple[datetime, datetime]:
    day = day or now_local().date()
    start = datetime.combine(day - timedelta(days=day.weekday()), time.min, tzinfo=TZ)
    return start, start + timedelta(days=7)


def _day_bounds() -> tuple[datetime, datetime]:
    today = now_local().date()
    start = datetime.combine(today, time.min, tzinfo=TZ)
    return start, start + timedelta(days=1)


def dashboard(db: Session, manager) -> dict:
    arena = manager_arena_or_404(db, manager)
    day_start, day_end = _day_bounds()
    week_start, week_end = _week_bounds()
    month_start = now_local() - timedelta(days=30)

    gross_today, _, _, cnt_today = repo.revenue_for_period(db, arena.id, day_start, day_end)
    gross_week, sub_week, com_week, cnt_week = repo.revenue_for_period(db, arena.id, week_start, week_end)
    gross_month, sub_month, com_month, cnt_month = repo.revenue_for_period(db, arena.id, month_start, day_end)

    courts = repo.list_courts_for_arena(db, arena.id)
    booked_week = repo.booked_slots_in_week(db, arena.id, week_start, week_end)
    total_slots = len(courts) * 15 * 7 or 1
    ocupacao = min(100, round(booked_week * 100 / total_slots))

    requested = repo.active_bookings_count(db, arena.id, [STATUS_REQUESTED])
    pending_pay = repo.active_bookings_count(db, arena.id, [STATUS_PENDING_PAYMENT])
    reservas_hoje = repo.booked_slots_in_week(db, arena.id, day_start, day_end)

    prox_rows = repo.next_bookings(db, arena.id, now_local())
    proximas = [serialize_booking(b, c, a, u) for b, c, a, u in prox_rows]

    return {
        "arena": {"id": str(arena.id), "name": arena.name, "visible": arena.is_active},
        "kpis": [
            {"rotulo": "Faturamento hoje", "valor": gross_today / 100, "cls": "hoje"},
            {"rotulo": "Faturamento semana", "valor": gross_week / 100, "cls": "semana"},
            {"rotulo": "Reservas da semana", "valor": booked_week, "cls": "reservas"},
            {"rotulo": "Ocupação", "valor": f"{ocupacao}%", "cls": "ocupacao"},
        ],
        "bruto": gross_month / 100,
        "comissao": com_month / 100,
        "repasse": (sub_month - round(sub_month * settings.arena_fee_rate)) / 100,
        "ticket_medio": round(gross_month / cnt_month, 2) if cnt_month else 0,
        "ocupacao": ocupacao,
        "reservas_semana": booked_week,
        "reservas_hoje": reservas_hoje,
        "solicitacoes_pendentes": requested,
        "aguardando_pagamento": pending_pay,
        "proximas": proximas,
        "data_hoje": now_local().strftime("%d/%m/%Y"),
    }


# --- Agenda ---------------------------------------------------------------

def agenda(db: Session, manager, semana: str | None = None) -> dict:
    arena = manager_arena_or_404(db, manager)
    if semana:
        try:
            day = datetime.strptime(semana, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=422, detail="Data inválida (use YYYY-MM-DD)")
    else:
        day = now_local().date()
    start, end = _week_bounds(day)

    rows = repo.bookings_between(db, arena.id, start, end)
    eventos = []
    for booking, court, arena_row, user in rows:
        # A AGENDA MOSTRA O QUE OCUPA A QUADRA.
        #
        # A consulta traz a semana inteira sem filtrar status, entao recusada,
        # cancelada e expirada vinham desenhadas como bloco na grade. O dono
        # olhava sabado 17h, via um retangulo e concluia que estava vendido —
        # quando o horario esta livre e ele pode vende-lo agora.
        #
        # Elas nao somem do sistema: continuam em Reservas, com o status, que e
        # onde se pergunta "o que aconteceu com aquele pedido". Aqui a pergunta
        # e outra — "o que a minha quadra esta fazendo nesta semana".
        if booking.status not in ACTIVE_STATUSES:
            continue
        local = _as_local(booking.start_at)
        eventos.append({
            "id": str(booking.id),
            "code": booking.code,
            "quadraId": str(court.id),
            "quadra": court.name,
            "dia": local.strftime("%Y-%m-%d"),
            "inicio": local.strftime("%H:%M"),
            "fim": _as_local(booking.end_at).strftime("%H:%M"),
            "cliente": _client_name(booking, user),
            "telefone": _client_phone(booking, user),
            "valor": booking.subtotal_cents / 100,
            "status": _STATUS_LABEL.get(booking.status, booking.status),
            "statusClass": _STATUS_CLASS.get(booking.status, "pendente"),
        })

    cortes = repo.list_courts_for_arena(db, arena.id)
    colunas = []
    for i in range(7):
        d = start.date() + timedelta(days=i)
        colunas.append({"dia": d.strftime("%Y-%m-%d"), "rotulo": d.strftime("%a, %d/%m")})
    quadras = [serialize_court(c) for c in cortes]

    return {
        "semana": start.date().strftime("%Y-%m-%d"),
        "colunas": colunas,
        "quadras": quadras,
        "horas": list(range(8, 24)),
        "eventos": eventos,
        # O EXPEDIENTE, por quadra e por dia.
        #
        # A grade so desenhava RESERVAS, e espaco vazio nao dizia nada: aquele
        # buraco na terca de manha e horario livre esperando cliente, ou a
        # quadra nem abre nesse dia? As duas coisas pediam acoes opostas do
        # dono, e ele nao tinha como distinguir olhando.
        "expediente": _expediente_da_semana(db, cortes, start),
    }


def _expediente_da_semana(db: Session, courts, start: datetime) -> dict:
    """{quadraId: {"AAAA-MM-DD": [[abre, fecha], ...]}}, faixas em horas.

    Lista vazia = FECHADO naquele dia. `_day_window` ja concentra as tres
    regras (linha ausente cai no padrao, linha com horario abre, closed fecha),
    entao ler `court_recurring_availability` direto aqui refaria o bug que a
    coluna `closed` veio corrigir.
    """
    mapa: dict = {}
    for court in courts:
        por_dia: dict = {}
        for i in range(7):
            dia = start + timedelta(days=i)
            faixas = _day_window(db, court, dia)
            por_dia[dia.date().strftime("%Y-%m-%d")] = [
                [abre.hour + abre.minute / 60, fecha.hour + fecha.minute / 60]
                for abre, fecha in faixas
            ]
        mapa[str(court.id)] = por_dia
    return mapa


# --- Reservas -------------------------------------------------------------

def _intervalo(de: str | None, ate: str | None, *, padrao_dias: int = 30):
    """Converte o intervalo escolhido na tela em datetimes locais.

    Os filtros fixos ("hoje / 7d / 30d") nao serviam a quem fecha o mes: o dono
    quer "1 a 31 de julho", e nao "os ultimos 30 dias a partir de agora". Aqui
    `de` e `ate` sao datas ISO (AAAA-MM-DD) e `ate` e INCLUSIVO — quem digita
    31/07 espera o dia 31 inteiro dentro da conta, nao ate a meia-noite dele.
    """
    fim = now_local()
    if ate:
        try:
            d = datetime.strptime(ate, "%Y-%m-%d").date()
            fim = datetime.combine(d, time.min, tzinfo=TZ) + timedelta(days=1)
        except ValueError:
            raise HTTPException(status_code=422, detail="Data final invalida (use AAAA-MM-DD)")

    inicio = fim - timedelta(days=padrao_dias)
    if de:
        try:
            d = datetime.strptime(de, "%Y-%m-%d").date()
            inicio = datetime.combine(d, time.min, tzinfo=TZ)
        except ValueError:
            raise HTTPException(status_code=422, detail="Data inicial invalida (use AAAA-MM-DD)")

    if inicio >= fim:
        raise HTTPException(status_code=422, detail="A data inicial precisa vir antes da final")
    return inicio, fim


def list_reservas(
    db: Session,
    manager,
    *,
    status_filtro: str | None = None,
    q: str | None = None,
    plano: str | None = None,
    sem_sessoes: bool = False,
    de: str | None = None,
    ate: str | None = None,
    pagina: int = 1,
    por_pagina: int = 20,
) -> dict:
    """Reservas paginadas.

    Devolvia uma LISTA cortada em 200 linhas sem dizer que havia corte: a tela
    mostrava o que coubesse e o dono nao tinha como saber que faltava. Agora
    devolve o total e a pagina, e quem chama consegue numerar.
    """
    arena = manager_arena_or_404(db, manager)
    pagina = max(1, int(pagina or 1))
    por_pagina = max(1, min(100, int(por_pagina or 20)))

    inicio = fim = None
    if de or ate:
        inicio, fim = _intervalo(de, ate)

    linhas, total = repo.list_arena_bookings(
        db, arena.id,
        status=status_filtro or None,
        q=q or None,
        plano=plano or None,
        sem_sessoes=sem_sessoes,
        de=inicio, ate=fim,
        limit=por_pagina,
        offset=(pagina - 1) * por_pagina,
        com_total=True,
    )
    """As datas do mensalista vem em UMA consulta para a pagina inteira.

    Buscar por reserva daria uma consulta por linha — 20 idas ao banco para
    desenhar uma tela. Aqui os grupos da pagina sao pedidos de uma vez."""
    grupos = [b.group_id for b, _, _, _ in linhas
              if b.plan == PLAN_MENSALISTA and not b.is_session and b.group_id]
    datas_por_grupo: dict = {}
    if grupos:
        for grupo in set(grupos):
            datas_por_grupo[grupo] = [
                _as_local(x.start_at).strftime("%d/%m")
                for x in repo.group_bookings(db, grupo)
            ]

    return {
        "reservas": [
            serialize_booking(b, c, a, u, sessoes=datas_por_grupo.get(b.group_id))
            for b, c, a, u in linhas
        ],
        "total": total,
        "pagina": pagina,
        "porPagina": por_pagina,
        "paginas": max(1, -(-total // por_pagina)),  # teto da divisao
    }


def create_manual_booking(db: Session, manager, body) -> Booking:
    """Reserva criada pelo gerente para um cliente (source=manual).

    Nasce `confirmed` (o gerente ja atendeu no balcao) e gera Payment
    provider="manual" confirmado — a arena e ressarcida pelo mesmo fluxo do
    ledger. Preco vem do court por padrao; `valor` pode sobrescrever.
    """
    arena = manager_arena_or_404(db, manager)
    court = repo.get_court_in_arena(db, body.courtId, arena.id)
    if court is None:
        raise HTTPException(status_code=404, detail="Quadra não encontrada")

    dur = max(1, min(3, int(body.dur or 1)))
    start_at = _parse_start(body.date, body.hora)
    if start_at <= now_local():
        raise HTTPException(status_code=409, detail="Não é possível reservar um horário que já passou")

    bookings_repo.lock_court(db, court.id)
    _ensure_slots_free(db, court, [start_at], dur)

    if body.valor is not None:
        subtotal = _price_cents(body.valor)
    else:
        subtotal = court.price_cents * dur
    booking = Booking(
        id=uuid.uuid4(),
        code=_generate_code(db),
        arena_id=arena.id,
        court_id=court.id,
        user_id=None,
        client_name=body.clientName or "",
        client_phone=body.clientPhone or "",
        client_email=body.clientEmail or "",
        status=STATUS_CONFIRMED,
        plan=PLAN_AVULSO,
        start_at=start_at.astimezone(timezone.utc).replace(tzinfo=None),
        end_at=(start_at + timedelta(hours=dur)).astimezone(timezone.utc).replace(tzinfo=None),
        duration_h=dur,
        subtotal_cents=subtotal,
        service_fee_cents=0,
        total_cents=subtotal,
        payment_method="pix",
        quote_snapshot={"subtotal_cents": subtotal, "service_fee_cents": 0, "total_cents": subtotal},
        source="manual",
        created_by=manager.id,
    )
    db.add(booking)
    db.flush()
    _record_event(db, booking, None, STATUS_CONFIRMED, manager.id, ROLE_GERENTE, "Reserva manual")
    db.add(Payment(
        id=uuid.uuid4(),
        booking_id=booking.id,
        user_id=None,
        provider=PAYMENT_MANUAL,
        method="pix",
        amount_cents=subtotal,
        status="confirmed",
        paid_at=utc_now(),
    ))
    db.commit()
    return booking


def create_manual_mensalista(db: Session, manager, body) -> list[Booking]:
    """Mensalista criado pelo gerente: 4 sessoes semanais + Payment manual."""
    arena = manager_arena_or_404(db, manager)
    court = repo.get_court_in_arena(db, body.courtId, arena.id)
    if court is None:
        raise HTTPException(status_code=404, detail="Quadra não encontrada")

    dur = max(1, min(3, int(body.dur or 1)))
    start_at = _parse_start(body.date, body.hora)
    sessions = _sessions(start_at, dur, PLAN_MENSALISTA)

    bookings_repo.lock_court(db, court.id)
    _ensure_slots_free(db, court, sessions, dur)

    subtotal = court.price_monthly_cents or court.price_cents * dur
    group_id = uuid.uuid4()
    created: list[Booking] = []
    for index, start in enumerate(sessions):
        is_session = index > 0
        booking = Booking(
            id=uuid.uuid4(),
            code=_generate_code(db),
            arena_id=arena.id,
            court_id=court.id,
            user_id=None,
            client_name=body.clientName or "",
            client_phone=body.clientPhone or "",
            client_email=body.clientEmail or "",
            status=STATUS_CONFIRMED,
            plan=PLAN_MENSALISTA,
            start_at=start.astimezone(timezone.utc).replace(tzinfo=None),
            end_at=(start + timedelta(hours=dur)).astimezone(timezone.utc).replace(tzinfo=None),
            duration_h=dur,
            weekday=body.dia,
            subtotal_cents=0 if is_session else subtotal,
            service_fee_cents=0,
            total_cents=0 if is_session else subtotal,
            payment_method="pix",
            quote_snapshot={"subtotal_cents": subtotal, "service_fee_cents": 0, "total_cents": subtotal},
            group_id=group_id,
            is_session=is_session,
            source="manual",
            created_by=manager.id,
        )
        db.add(booking)
        db.flush()
        _record_event(db, booking, None, STATUS_CONFIRMED, manager.id, ROLE_GERENTE, "Mensalista manual")
        created.append(booking)
    db.add(Payment(
        id=uuid.uuid4(),
        booking_id=created[0].id,
        user_id=None,
        provider=PAYMENT_MANUAL,
        method="pix",
        amount_cents=subtotal,
        status="confirmed",
        paid_at=utc_now(),
    ))
    db.commit()
    return created


def _parse_start(date_str: str, hora: str) -> datetime:
    try:
        day = datetime.strptime(date_str, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail="Data inválida (use YYYY-MM-DD)")
    try:
        hour = int(str(hora).split(":")[0])
    except (ValueError, TypeError):
        hour = 19
    hour = max(0, min(23, hour))
    return datetime.combine(day, time(hour, 0), tzinfo=TZ).astimezone(timezone.utc).astimezone(TZ)


# --- Mensalistas ----------------------------------------------------------

def list_mensalistas(db: Session, manager) -> list[dict]:
    arena = manager_arena_or_404(db, manager)
    out = []
    for booking, court, arena_row, user in repo.mensalist_groups(db, arena.id):
        local = _as_local(booking.start_at)
        out.append({
            "id": str(booking.id),
            "cliente": _client_name(booking, user),
            "telefone": _client_phone(booking, user),
            "quadra": court.name,
            "dia": local.strftime("%A"),
            "hora": local.strftime("%H:%M"),
            "preco": booking.subtotal_cents / 100,
            "status": "ativo" if booking.status not in (STATUS_CANCELLED, STATUS_REJECTED, STATUS_EXPIRED) else "cancelado",
            "group_id": str(booking.group_id) if booking.group_id else "",
        })
    return out


def mensalista_sessions(db: Session, manager, booking_id) -> list[dict]:
    arena = manager_arena_or_404(db, manager)
    booking, court, _, _ = _get_arena_booking(db, arena, booking_id)
    if booking.plan != PLAN_MENSALISTA or not booking.group_id:
        raise HTTPException(status_code=404, detail="Mensalista não encontrado")
    grupo = repo.group_bookings(db, booking.group_id)

    """R$ 0,00 NAS SESSOES ERA VERDADE NO BANCO E MENTIRA NA TELA.

    O mensalista e cobrado UMA vez, no mes: a primeira reserva do grupo leva o
    valor inteiro e as outras tres ficam com subtotal zero. A tela mostrava
    isso cru — "R$ 480,00" na primeira linha e "R$ 0,00" nas seguintes — e
    lido de fora parece que tres jogos sairam de graca, ou que o sistema
    perdeu o valor. O dono abriu o plano e viu exatamente isso.

    As sessoes nao sao gratis: estao incluidas no mes. Entao cada linha passa a
    mostrar QUANTO ELA VALE DENTRO DO PLANO — o total dividido pelas sessoes —
    e a soma da coluna volta a bater com o que foi cobrado. `valorPlano` vai
    junto para a tela poder dizer de onde sai o numero, em vez de o dono ter de
    adivinhar por que a conta fecha.
    """
    total_cents = sum(b.subtotal_cents or 0 for b in grupo)
    por_sessao = round(total_cents / len(grupo) / 100, 2) if grupo else 0.0
    valor_plano = round(total_cents / 100, 2)

    sessions = []
    for s in grupo:
        local = _as_local(s.start_at)
        sessions.append({
            "id": str(s.id),
            "data": local.strftime("%d/%m/%Y"),
            "dataValue": local.strftime("%Y-%m-%d"),
            "hora": f"{local.strftime('%H:%M')} – {_as_local(s.end_at).strftime('%H:%M')}",
            "valor": por_sessao,
            "valorPlano": valor_plano,
            "status": _STATUS_LABEL.get(s.status, s.status),
            "statusClass": _STATUS_CLASS.get(s.status, "pendente"),
        })
    return sessions


def cancel_mensalista(db: Session, manager, booking_id) -> dict:
    arena = manager_arena_or_404(db, manager)
    booking, _, _, _ = _get_arena_booking(db, arena, booking_id)
    if booking.plan != PLAN_MENSALISTA or not booking.group_id:
        raise HTTPException(status_code=404, detail="Mensalista não encontrado")
    ids = {b.id for b in repo.group_bookings(db, booking.group_id)}
    targets = db.execute(
        select_booking().where(Booking.id.in_(ids))
    ).scalars().all()
    from .bookings import _transition_booking as _trans

    count = 0
    for target in targets:
        if target.status not in _TERMINAL_STATUSES and target.status != STATUS_CANCELLED:
            _trans(db, target, STATUS_CANCELLED, actor_id=manager.id, actor_role=ROLE_GERENTE, reason="Mensalista cancelado pelo gerente")
            count += 1
    db.commit()
    return {"ok": True, "canceladas": count}


# --- Financeiro -----------------------------------------------------------

def _serie_diaria(db: Session, arena_id, start: datetime, end: datetime) -> list[dict]:
    """Um ponto por dia do intervalo, INCLUSIVE os dias sem faturamento.

    A consulta so devolve dias com movimento. Se o grafico usasse isso direto,
    uma terca vazia simplesmente sumiria e a sexta apareceria colada na
    segunda — a serie ficaria mais curta e o desenho, mentiroso. Zero e um
    dado; ausencia nao e.
    """
    porta = {d: (v, c) for d, v, c in repo.revenue_by_day(db, arena_id, start, end)}
    pontos = []
    dia = start.date()
    ultimo = (end - timedelta(seconds=1)).date()
    while dia <= ultimo:
        chave = dia.isoformat()
        valor, qtd = porta.get(chave, (0, 0))
        pontos.append({
            "dia": chave,
            "rotulo": ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"][dia.weekday()],
            "valor": valor / 100,
            "reservas": qtd,
        })
        dia += timedelta(days=1)
    return pontos


def _indicadores(db: Session, arena, start: datetime, end: datetime) -> dict:
    """Os quatro indicadores de comportamento do Financeiro.

    Todos saem das reservas do periodo — nenhum inventa numero. Onde nao ha
    base para a conta (zero reservas, zero solicitacoes), devolve None em vez de
    zero: "0% de retorno" e uma afirmacao sobre os clientes, e sem cliente
    nenhum ela e falsa. A tela mostra travessao.
    """
    linhas = repo.bookings_between(db, arena.id, start, end)

    # ── Clientes que voltaram ─────────────────────────────────────────────
    #
    # Recorrente e quem JA TINHA reservado antes desta janela. Contar so quem
    # apareceu duas vezes dentro dela trataria um cliente de tres anos, que veio
    # uma vez neste mes, como novo.
    anteriores = repo.clientes_anteriores(db, arena.id, start)
    do_periodo = {
        str(b.user_id) for b, *_ in linhas
        if b.user_id and b.status in ACTIVE_STATUSES
    }
    recorrentes = do_periodo & anteriores
    novos = do_periodo - anteriores

    # ── Conversao de solicitacoes ─────────────────────────────────────────
    #
    # So conta quem PASSOU por solicitacao: reserva paga direto pelo app nunca
    # esperou decisao do dono, e incluir infla a taxa para perto de 100%.
    aceitas = recusadas = expiradas = 0
    for booking, *_ in linhas:
        if booking.status == STATUS_REJECTED:
            recusadas += 1
        elif booking.status == STATUS_EXPIRED:
            expiradas += 1
        elif booking.status in (STATUS_CONFIRMED, STATUS_COMPLETED, STATUS_PAYMENT_CONFIRMED):
            aceitas += 1
    decididas = aceitas + recusadas + expiradas

    # ── Onde esta o dinheiro ──────────────────────────────────────────────
    por_quadra: dict[str, int] = {}
    por_faixa = {"Manhã": 0, "Tarde": 0, "Noite": 0}
    for booking, court, _arena, _user in linhas:
        if booking.status not in ACTIVE_STATUSES:
            continue
        cents = booking.subtotal_cents or 0
        por_quadra[court.name] = por_quadra.get(court.name, 0) + cents
        hora = _as_local(booking.start_at).hour
        faixa = "Manhã" if hora < 12 else ("Tarde" if hora < 18 else "Noite")
        por_faixa[faixa] += cents

    melhor_quadra = max(por_quadra.items(), key=lambda x: x[1], default=None)
    melhor_faixa = max(por_faixa.items(), key=lambda x: x[1], default=None)

    # ── Perdas ────────────────────────────────────────────────────────────
    #
    # Separadas porque pedem acoes diferentes: cancelada e cliente que desistiu
    # depois de fechar; expirada e pedido que o dono nao respondeu a tempo — a
    # segunda esta sob o controle dele.
    cancelado = sum(
        (b.subtotal_cents or 0) for b, *_ in linhas if b.status == STATUS_CANCELLED
    )
    expirado = sum(
        (b.subtotal_cents or 0) for b, *_ in linhas if b.status == STATUS_EXPIRED
    )
    total_reservas = sum(1 for b, *_ in linhas if b.status in ACTIVE_STATUSES)
    canceladas_qtd = sum(1 for b, *_ in linhas if b.status == STATUS_CANCELLED)
    base_cancel = total_reservas + canceladas_qtd

    return {
        "clientes": {
            "total": len(do_periodo),
            "novos": len(novos),
            "recorrentes": len(recorrentes),
            "taxaRetorno": round(len(recorrentes) * 100 / len(do_periodo)) if do_periodo else None,
        },
        "conversao": {
            "aceitas": aceitas,
            "recusadas": recusadas,
            "expiradas": expiradas,
            "taxa": round(aceitas * 100 / decididas) if decididas else None,
        },
        "ranking": {
            "quadra": {"nome": melhor_quadra[0], "valor": melhor_quadra[1] / 100} if melhor_quadra and melhor_quadra[1] else None,
            "faixa": {"nome": melhor_faixa[0], "valor": melhor_faixa[1] / 100} if melhor_faixa and melhor_faixa[1] else None,
            # A reparticao inteira, e nao so o pico: saber que a noite lidera
            # nao diz se a tarde e fraca ou inexistente.
            "faixas": {k: v / 100 for k, v in por_faixa.items()},
        },
        "perdas": {
            "canceladoValor": cancelado / 100,
            "expiradoValor": expirado / 100,
            "taxaCancelamento": round(canceladas_qtd * 100 / base_cancel) if base_cancel else None,
        },
    }


def financeiro(
    db: Session,
    manager,
    periodo: str = "30d",
    *,
    de: str | None = None,
    ate: str | None = None,
) -> dict:
    """Financeiro do periodo.

    `de`/`ate` mandam quando vierem: quem fecha o mes quer "1 a 31 de julho", e
    nao "os ultimos 30 dias a partir de agora". Os atalhos fixos continuam
    existindo para o uso do dia a dia, mas deixaram de ser a unica opcao.
    """
    arena = manager_arena_or_404(db, manager)
    if de or ate:
        start, end = _intervalo(de, ate)
        periodo = "custom"
    else:
        # DIAS INTEIROS, e nao uma janela rolante de 7x24h.
        #
        # `now - 7 dias` comeca no meio de um sabado e termina no meio do
        # sabado seguinte: a serie diaria caia em OITO baldes, dois deles
        # parciais, e o grafico desenhava "Sáb Dom Seg Ter Qua Qui Sex Sáb" —
        # o mesmo dia da semana nas duas pontas, debaixo do rotulo "ultimos 7
        # dias". Quem compara dias precisa de dias completos; meio sabado no
        # inicio e meio no fim nao se comparam com nada.
        today = now_local().date()
        if periodo == "today":
            start = datetime.combine(today, time.min, tzinfo=TZ)
        elif periodo == "7d":
            start = datetime.combine(today - timedelta(days=6), time.min, tzinfo=TZ)
        else:
            start = datetime.combine(today - timedelta(days=29), time.min, tzinfo=TZ)
        end = now_local()

    gross, subtotal, com, cnt = repo.revenue_for_period(db, arena.id, start, end)
    liquido = subtotal - round(subtotal * settings.arena_fee_rate)
    settlements = repo.settlements_for_arena(db, arena.id)

    return {
        "periodo": periodo,
        # A tela precisa saber QUAL intervalo respondeu, senao nao ha como
        # mostrar "1 a 31 de julho" no cabecalho do relatorio.
        "de": start.date().isoformat(),
        "ate": (end - timedelta(seconds=1)).date().isoformat(),
        # Serie diaria REAL, para o grafico parar de ser desenhado a partir do
        # total dividido por sete com pesos escolhidos a mao.
        "serie": _serie_diaria(db, arena.id, start, end),
        "bruto": gross / 100,
        "subtotal": subtotal / 100,
        "comissao": com / 100,
        "liquido": liquido / 100,
        "reservas": cnt,
        # EM REAIS, como todos os campos ao lado. `gross` esta em CENTAVOS
        # (os vizinhos dividem por 100 aqui mesmo) e este ficou sem a divisao:
        # a tela mostrava "ticket medio R$ 23.184,00" ao lado de "faturamento
        # R$ 695,52" — cem vezes maior, num painel onde o dono decide preco.
        "ticket_medio": round(gross / cnt / 100, 2) if cnt else 0,
        # Comportamento do cliente: retorno, conversao, onde entra o dinheiro e
        # o que escorreu. Ver `_indicadores`.
        "indicadores": _indicadores(db, arena, start, end),
        "repasses": [_serialize_settlement(s) for s in settlements],
    }


def generate_settlements(db: Session, *, now: datetime | None = None) -> int:
    """Task semanal: cria settlements pending por arena a partir do ledger.

    Usa o periodo fechado (semana anterior) e nunca duplica: um settlement ja
    existe para aquele arena+period_start.
    """
    now = now or now_local()
    week_start, week_end = _week_bounds((now - timedelta(days=7)).date())
    arenas = db.execute(select_arena().where(Arena.deleted_at.is_(None))).scalars().all()
    created = 0
    for arena in arenas:
        gross, subtotal, com, cnt = repo.revenue_for_period(db, arena.id, week_start, week_end)
        if cnt == 0:
            continue
        if repo.unpaid_settlement_for(db, arena.id, week_start):
            continue
        db.add(Settlement(
            id=uuid.uuid4(),
            arena_id=arena.id,
            period_start=week_start.astimezone(timezone.utc).replace(tzinfo=None),
            period_end=week_end.astimezone(timezone.utc).replace(tzinfo=None),
            gross_cents=gross,
            commission_cents=com,
            net_cents=subtotal - round(subtotal * settings.arena_fee_rate),
            bookings_count=cnt,
            status=SETTLEMENT_PENDING,
            due_at=(now_local() + timedelta(days=7)),
        ))
        created += 1
    db.commit()
    return created


# --- Quadras --------------------------------------------------------------

def list_quadras(db: Session, manager) -> dict:
    """Quadras da arena + os numeros REAIS da vitrine.

    O painel mostrava "1.284 visualizacoes em 30 dias" e "9,8% de conversao" —
    duas constantes escritas a mao em manager-data.js. Nao eram estimativa nem
    aproximacao: eram invencao apresentada como medicao, e o dono decidiria
    pagar por destaque olhando para elas.

    Agora saem de `slot_demand` (quantas vezes alguem escolheu um horario desta
    arena sem reservar) e das reservas de fato. E o rotulo mudou junto: nao ha
    "em 30 dias" porque a tabela guarda acumulado por slot, sem data — dizer
    30 dias seria trocar uma invencao por outra menor.
    """
    arena = manager_arena_or_404(db, manager)
    courts = repo.list_courts_for_arena(db, arena.id)

    procura = sum(v for _, _, v in repo.demand_by_slot(db, arena.id, now_local(), now_local()))
    reservas = repo.active_bookings_count(db, arena.id, list(ACTIVE_STATUSES))
    # Conversao so existe se houve procura: 0 procuras e 0 reservas nao dao
    # "0%", dao "ainda nao da para dizer".
    conversao = round(reservas * 100 / procura, 1) if procura else None

    return {
        "quadras": [serialize_court(c) for c in courts],
        "arena": arena.name,
        "vitrine": {
            "procura": procura,
            "reservas": reservas,
            "conversao": conversao,
        },
    }


def create_quadra(db: Session, manager, body) -> Court:
    arena = manager_arena_or_404(db, manager)
    court = Court(
        id=uuid.uuid4(),
        arena_id=arena.id,
        name=body.nome,
        sport=body.esporte,
        description=body.descricao,
        price_cents=_price_cents(body.preco),
        price_monthly_cents=_price_cents(body.precoMensalista) if body.precoMensalista is not None else None,
        min_duration_h=max(1, int(body.duracaoMinima or 1)),
        opening_time=_time_field(body.abertura, "08:00"),
        closing_time=_time_field(body.fechamento, "23:00"),
        photos=body.fotos or [],
        amenities=body.comodidades or [],
        is_active=True,
        is_visible=True,
    )
    db.add(court)
    db.commit()
    return court


def update_quadra(db: Session, manager, court_id, body) -> Court:
    arena = manager_arena_or_404(db, manager)
    court = repo.get_court_in_arena(db, court_id, arena.id)
    if court is None:
        raise HTTPException(status_code=404, detail="Quadra não encontrada")
    if body.nome is not None:
        court.name = body.nome
    if body.esporte is not None:
        court.sport = body.esporte
    if body.descricao is not None:
        court.description = body.descricao
    if body.preco is not None:
        court.price_cents = _price_cents(body.preco)
    if body.precoMensalista is not None:
        court.price_monthly_cents = _price_cents(body.precoMensalista)
    if body.duracaoMinima is not None:
        court.min_duration_h = max(1, int(body.duracaoMinima))
    if body.abertura is not None:
        court.opening_time = _time_field(body.abertura, "08:00")
    if body.fechamento is not None:
        court.closing_time = _time_field(body.fechamento, "23:00")
    if body.fotos is not None:
        court.photos = body.fotos
    if body.comodidades is not None:
        court.amenities = body.comodidades
    if body.ativa is not None:
        court.is_active = body.ativa
    if body.visivel is not None:
        court.is_visible = body.visivel
    if body.destaque is not None:
        court.is_featured = body.destaque
    db.commit()
    return court


def _court_da_arena(db: Session, arena, court_id) -> Court:
    """A quadra tem de ser DESTA arena. Sem a checagem, o id no caminho da URL
    deixaria um gerente ler e reescrever o expediente da quadra de outro."""
    court = repo.get_court_in_arena(db, court_id, arena.id)
    if court is None:
        raise HTTPException(status_code=404, detail="Quadra não encontrada")
    return court


# --- Expediente da quadra -------------------------------------------------

DIAS_SEMANA = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"]


def expediente_quadra(db: Session, manager, court_id) -> dict:
    """Os sete dias da quadra, sempre os sete.

    `court_recurring_availability` existe desde a fase 1 com dia da semana,
    faixa e a coluna `closed` — e nunca teve rota no painel. O gerente tinha um
    unico par "abre as / fecha as" valendo para a semana inteira, entao arena
    que fecha mais cedo no domingo ou nao abre segunda nao tinha como dizer.
    Era o que o Gabriel pediu com "pegue de referencia o Google Meu Negocio".

    Devolve os SETE dias mesmo quando nao ha linha nenhuma no banco, com o
    horario padrao da quadra preenchido: um editor que comeca vazio obriga o
    dono a digitar catorze horarios antes de mudar um. E `configurado` diz se
    aquele dia ja foi decidido ou se ainda esta herdando o padrao — a diferenca
    entre "nao abre" e "ninguem configurou" foi justamente o que a coluna
    `closed` veio resolver.
    """
    arena = manager_arena_or_404(db, manager)
    court = _court_da_arena(db, arena, court_id)

    dias = []
    for dow in range(7):
        linhas = venues_repo.recurring_for_court(db, court.id, dow)
        fechado = any(getattr(r, "closed", False) for r in linhas)
        faixa = next((r for r in linhas if not getattr(r, "closed", False)), None)
        dias.append({
            "dia": dow,
            "rotulo": DIAS_SEMANA[dow],
            "configurado": bool(linhas),
            "fechado": fechado,
            "abre": (faixa.start_time if faixa else court.opening_time).strftime("%H:%M"),
            "fecha": (faixa.end_time if faixa else court.closing_time).strftime("%H:%M"),
        })
    return {"quadraId": str(court.id), "quadra": court.name, "dias": dias}


def salvar_expediente(db: Session, manager, court_id, dias: list) -> dict:
    """Reescreve a semana inteira da quadra.

    Apaga e regrava em vez de casar linha a linha: o editor manda sempre os
    sete dias, entao um diff aqui seria trabalho para chegar ao mesmo estado
    com mais chance de erro.

    FECHADO GRAVA LINHA, e nao apaga. Sem linha, `_day_window` cai no horario
    padrao da quadra e o dia volta a aparecer ABERTO — o oposto do que o dono
    acabou de pedir, e ele so descobriria quando alguem reservasse.
    """
    arena = manager_arena_or_404(db, manager)
    court = _court_da_arena(db, arena, court_id)

    vistos = set()
    novos = []
    for item in dias:
        dow = int(item.get("dia", -1))
        if dow < 0 or dow > 6:
            raise HTTPException(status_code=422, detail="Dia da semana inválido")
        if dow in vistos:
            raise HTTPException(status_code=422, detail="Dia da semana repetido")
        vistos.add(dow)

        fechado = bool(item.get("fechado"))
        if fechado:
            novos.append((dow, time(0, 0), time(0, 0), True))
            continue
        try:
            abre = datetime.strptime(str(item.get("abre", "")), "%H:%M").time()
            fecha = datetime.strptime(str(item.get("fecha", "")), "%H:%M").time()
        except ValueError:
            raise HTTPException(status_code=422, detail="Horário inválido (use HH:MM)")
        # Fecha antes de abrir nao e virada de dia: e engano de digitacao. Aceitar
        # produziria um dia sem nenhum horario reservavel, sem dizer por que.
        if fecha <= abre:
            raise HTTPException(
                status_code=422,
                detail=f"{DIAS_SEMANA[dow]}: o fechamento precisa ser depois da abertura",
            )
        novos.append((dow, abre, fecha, False))

    db.execute(
        delete(CourtRecurringAvailability).where(
            CourtRecurringAvailability.court_id == court.id
        )
    )
    for dow, abre, fecha, fechado in novos:
        db.add(CourtRecurringAvailability(
            id=uuid.uuid4(),
            court_id=court.id,
            day_of_week=dow,
            start_time=abre,
            end_time=fecha,
            closed=fechado,
        ))
    db.commit()
    bump_catalog_version()
    return expediente_quadra(db, manager, court_id)


# --- Avaliacoes -----------------------------------------------------------

def list_avaliacoes(db: Session, manager, *, quadra: str | None = None) -> dict:
    """Avaliacoes da arena, agora sabendo QUAL QUADRA cada uma avaliou.

    Uma arena com quatro quadras via uma media so, e ela nao ajuda em nada: se
    a quadra 3 esta com o piso ruim, a nota dela dilui nas outras tres e o dono
    nunca descobre onde esta o problema. Cada quadra tem sua nota e sua
    distribuicao.

    Avaliacao sem reserva vinculada fica em "quadra desconhecida" em vez de ser
    atribuida a alguma: chutar a quadra errada numa nota 2 e pior que nao
    atribuir nenhuma.
    """
    arena = manager_arena_or_404(db, manager)

    avaliacoes = []
    por_quadra: dict[str, dict] = {}
    for review, author, court_id, court_name in repo.reviews_with_court(db, arena.id):
        cid = str(court_id) if court_id else ""
        item = {
            "id": str(review.id),
            "cliente": author,
            "nota": review.rating,
            "quando": _relative(review.created_at),
            "texto": review.comment or "",
            "resposta": review.reply,
            "quadraId": cid,
            "quadraNome": court_name or "Sem quadra identificada",
        }
        avaliacoes.append(item)

        grupo = por_quadra.setdefault(cid, {
            "quadraId": cid,
            "quadraNome": item["quadraNome"],
            "total": 0,
            "soma": 0,
            "dist": {5: 0, 4: 0, 3: 0, 2: 0, 1: 0},
        })
        grupo["total"] += 1
        grupo["soma"] += review.rating or 0
        if review.rating in grupo["dist"]:
            grupo["dist"][review.rating] += 1

    quadras = [
        {
            "quadraId": g["quadraId"],
            "quadraNome": g["quadraNome"],
            "total": g["total"],
            "media": round(g["soma"] / g["total"], 1) if g["total"] else 0,
            "dist": [{"n": n, "qtd": g["dist"][n]} for n in (5, 4, 3, 2, 1)],
        }
        # A pior media primeiro: e onde o dono precisa olhar, e a lista existe
        # para ele agir, nao para se parabenizar.
        for g in sorted(
            por_quadra.values(),
            key=lambda x: (x["soma"] / x["total"]) if x["total"] else 99,
        )
    ]

    if quadra:
        avaliacoes = [a for a in avaliacoes if a["quadraId"] == quadra]

    dist = repo.review_distribution(db, arena.id)
    total = sum(d["qtd"] for d in dist)
    media = round(sum(d["n"] * d["qtd"] for d in dist) / total, 1) if total else 0
    return {
        "avaliacoes": avaliacoes,
        "dist": dist,
        "total": total,
        "media": media,
        "quadras": quadras,
        "filtroQuadra": quadra or "",
    }


def reply_avaliacao(db: Session, manager, review_id, resposta: str) -> dict:
    arena = manager_arena_or_404(db, manager)
    review = db.get(Review, _uuid_or_404(review_id))
    if review is None or review.arena_id != arena.id:
        raise HTTPException(status_code=404, detail="Avaliação não encontrada")
    review.reply = resposta
    review.replied_by = manager.id
    review.replied_at = now_local()
    db.commit()
    return {"ok": True, "reviewId": str(review.id)}


# --- Cupons ---------------------------------------------------------------

def list_cupons(db: Session, manager) -> list[dict]:
    arena = manager_arena_or_404(db, manager)
    return [_serialize_coupon(c, arena) for c in repo.list_coupons(db, arena.id)]


def create_cupom(db: Session, manager, body) -> Coupon:
    arena = manager_arena_or_404(db, manager)
    code = body.codigo.strip().upper()
    if repo.get_coupon_by_code(db, code):
        raise HTTPException(status_code=409, detail="Código de cupom já existe")
    court_id = _uuid_or_none(body.courtId) if body.courtId else None
    if court_id:
        court = repo.get_court_in_arena(db, court_id, arena.id)
        if court is None:
            raise HTTPException(status_code=404, detail="Quadra não encontrada")
    expires = None
    if body.expiraEm:
        try:
            expires = datetime.strptime(body.expiraEm, "%Y-%m-%d").replace(tzinfo=TZ)
        except ValueError:
            raise HTTPException(status_code=422, detail="Data de expiração inválida")
    coupon = Coupon(
        id=uuid.uuid4(),
        arena_id=arena.id,
        court_id=court_id,
        code=code,
        discount_percent=max(1, min(100, int(body.descontoPercent))),
        expires_at=expires,
        max_uses=body.maxUsos,
    )
    db.add(coupon)
    db.commit()
    return coupon


def delete_cupom(db: Session, manager, coupon_id) -> dict:
    arena = manager_arena_or_404(db, manager)
    coupon = repo.get_coupon(db, coupon_id, arena.id)
    if coupon is None:
        raise HTTPException(status_code=404, detail="Cupom não encontrado")
    db.delete(coupon)
    db.commit()
    return {"ok": True}


# --- Perfil / config / desativacao ----------------------------------------

def _validar_logo(bruto: str | None) -> str | None:
    """Mesma regra da foto de perfil e do escudo do clube.

    O conteudo vem do painel e termina num `src` na tela do jogador: so passa
    data URL de imagem ou http(s). String vazia remove a logo.
    """
    if bruto is None:
        return None
    valor = bruto.strip()
    if not valor:
        return None
    if not (valor.startswith("data:image/") or valor.startswith(("http://", "https://"))):
        raise HTTPException(status_code=422, detail="Formato de imagem invalido")
    if len(valor) > 1_400_000:
        raise HTTPException(status_code=413, detail="Imagem muito grande")
    return valor


def arena_profile(db: Session, manager) -> dict:
    arena = manager_arena_or_404(db, manager)
    return {
        "nome": arena.name,
        "descricao": arena.description or "",
        "endereco": arena.address or "",
        "bairro": arena.neighborhood or "",
        "cidade": arena.city or "",
        "estado": arena.state or "",
        "telefone": arena.phone or "",
        "email": arena.email or "",
        "pixChave": arena.pix_key or "",
        "ativo": arena.is_active,
        # A logo nao era nem lida nem gravada: o painel tinha o botao "Trocar
        # logo" e nada acontecia. Mesma falha que parece sucesso da ficha do
        # jogador.
        "logo": arena.logo or "",
    }


def update_arena_profile(db: Session, manager, body) -> dict:
    arena = manager_arena_or_404(db, manager)
    if body.nome is not None:
        arena.name = body.nome
    if body.descricao is not None:
        arena.description = body.descricao
    if body.endereco is not None:
        arena.address = body.endereco
    if body.bairro is not None:
        arena.neighborhood = body.bairro
    if body.cidade is not None:
        arena.city = body.cidade
    if body.estado is not None:
        arena.state = body.estado
    if body.telefone is not None:
        arena.phone = body.telefone
    if body.email is not None:
        arena.email = body.email
    if body.logo is not None:
        arena.logo = _validar_logo(body.logo)
    if body.pixChave is not None:
        arena.pix_key = body.pixChave
    db.commit()
    return arena_profile(db, manager)


def arena_config(db: Session, manager) -> dict:
    arena = manager_arena_or_404(db, manager)
    notif = (arena.settings or {}).get("notifications", {})
    return {
        "notificaReserva": notif.get("reserva", True),
        "notificaPagamento": notif.get("pagamento", True),
        "notificaAvaliacao": notif.get("avaliacao", False),
        "notificaResumo": notif.get("resumo", True),
        # ARENA PAUSADA sai de `is_active`, a MESMA coluna que a busca e o mapa
        # ja consultam (repositories/venues.VISIBLE). O interruptor existia na
        # tela e gravava so no localStorage do navegador: o dono desligava, via
        # o botao virar, e a arena continuava aparecendo no app para todo mundo.
        "pausada": not arena.is_active,
    }


def update_arena_config(db: Session, manager, body) -> dict:
    arena = manager_arena_or_404(db, manager)
    settings_ = dict(arena.settings or {})
    notif = dict((settings_.get("notifications") or {}))
    if body.notificaReserva is not None:
        notif["reserva"] = body.notificaReserva
    if body.notificaPagamento is not None:
        notif["pagamento"] = body.notificaPagamento
    if body.notificaAvaliacao is not None:
        notif["avaliacao"] = body.notificaAvaliacao
    if body.notificaResumo is not None:
        notif["resumo"] = body.notificaResumo
    settings_["notifications"] = notif
    arena.settings = settings_

    if body.pausada is not None:
        # PAUSAR nao cancela nada. E o interruptor do dia a dia — "hoje nao
        # abro" — e tem de ser reversivel sem consequencia: a arena some da
        # busca e do mapa, e para de receber reserva nova, mas quem ja pagou
        # continua com o horario. Cancelar reserva paga e o que DESATIVAR faz,
        # com aviso e confirmacao, e sao coisas diferentes de proposito.
        arena.is_active = not body.pausada

    db.commit()
    return arena_config(db, manager)


def desativar_arena(db: Session, manager, motivo: str, periodo: str | None) -> dict:
    arena = manager_arena_or_404(db, manager)
    settings_ = dict(arena.settings or {})
    settings_["deactivation"] = {"motivo": motivo, "periodo": periodo, "desativada_em": now_local().isoformat()}
    arena.settings = settings_
    arena.is_active = False
    cancelled = _cancel_future_bookings(db, arena)
    db.commit()
    return {"ok": True, "canceladas": cancelled}


def _cancel_future_bookings(db: Session, arena: Arena) -> int:
    from .bookings import _transition_booking as _trans

    now_utc = now_local().astimezone(timezone.utc).replace(tzinfo=None)
    targets = db.execute(
        select_booking().where(
            Booking.arena_id == arena.id,
            Booking.status.in_(ACTIVE_STATUSES),
            Booking.start_at >= now_utc,
        )
    ).scalars().all()
    count = 0
    for b in targets:
        if b.status != STATUS_CANCELLED:
            _trans(db, b, STATUS_CANCELLED, actor_id=arena.owner_id, actor_role=ROLE_GERENTE, reason="Arena desativada")
            count += 1
    return count


# --- Internos -------------------------------------------------------------

_TERMINAL_STATUSES = {
    STATUS_PAYMENT_FAILED, STATUS_REJECTED, STATUS_CANCELLED, STATUS_EXPIRED,
}


def _uuid_or_404(value) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError):
        raise HTTPException(status_code=404, detail="Registro não encontrado")


def _uuid_or_none(value):
    if not value:
        return None
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError):
        return None


def select_booking():
    from ..models import Booking as _B
    from sqlalchemy import select as _select
    return _select(_B)


def select_arena():
    from sqlalchemy import select as _select
    return _select(Arena)


def _get_arena_booking(db: Session, arena: Arena, booking_id):
    row = bookings_repo.get_booking(db, booking_id)
    if not row:
        raise HTTPException(status_code=404, detail="Reserva não encontrada")
    booking, court, arena_row = row
    if arena_row.id != arena.id:
        raise HTTPException(status_code=403, detail="Acesso restrito à sua arena")
    return booking, court, arena_row, None


def _relative(value) -> str:
    from .catalog import _relative_date

    return _relative_date(value)


# --- Ritmo da agenda (mapa de calor) ---------------------------------------

def ritmo_agenda(db: Session, manager, *, de: str | None = None, ate: str | None = None) -> dict:
    """Mapa de calor da demanda: dia da semana x hora.

    Responde a pergunta que o dono faz o tempo todo e que nenhum numero isolado
    respondia: QUANDO a quadra enche. "Ocupacao media 2%" nao diz se o problema
    e a terca de manha ou o domingo inteiro; o mapa diz.

    Duas camadas na mesma grade, e elas nao sao a mesma coisa:

      reservas — o que virou reserva de fato.
      procura  — quantas vezes alguem ABRIU aquela quadra naquele dia/hora sem
                 reservar. E a demanda que a arena esta perdendo, e e o unico
                 numero aqui que sugere ACAO (abrir horario, baixar preco).

    Sem a segunda camada, um horario vazio e ambiguo: ninguem quer, ou ninguem
    achou? A distincao muda o que o dono faz.
    """
    arena = manager_arena_or_404(db, manager)
    inicio, fim = _intervalo(de, ate, padrao_dias=90)

    # Grade 7x24 zerada: a tela desenha a grade inteira, e buraco no meio de um
    # mapa de calor le como "zero", nao como "sem dado".
    reservas = [[0] * 24 for _ in range(7)]
    total_reservas = 0

    for booking, court, _arena, _user in repo.bookings_between(db, arena.id, inicio, fim):
        if booking.status in (STATUS_CANCELLED, STATUS_EXPIRED, STATUS_REJECTED):
            continue
        local = _as_local(booking.start_at)
        # Python: segunda = 0. A tela do Brasil comeca no domingo, entao a
        # conversao mora aqui e nao em cada lugar que desenha a grade.
        dia = (local.weekday() + 1) % 7
        reservas[dia][local.hour] += 1
        total_reservas += 1

    procura = [[0] * 24 for _ in range(7)]
    total_procura = 0
    for dia_semana, hora, quantas in repo.demand_by_slot(db, arena.id, inicio, fim):
        if dia_semana is None or hora is None:
            continue
        procura[int(dia_semana)][int(hora)] = int(quantas)
        total_procura += int(quantas)

    # Os picos, para a tela nao ter de recalcular nem inventar o texto.
    def maior(grade):
        melhor = (0, 0, 0)
        for d, linha in enumerate(grade):
            for h, v in enumerate(linha):
                if v > melhor[2]:
                    melhor = (d, h, v)
        return {"dia": melhor[0], "hora": melhor[1], "total": melhor[2]}

    return {
        "de": inicio.date().isoformat(),
        "ate": (fim - timedelta(seconds=1)).date().isoformat(),
        "dias": ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"],
        "reservas": reservas,
        "procura": procura,
        "totalReservas": total_reservas,
        "totalProcura": total_procura,
        "picoReservas": maior(reservas),
        "picoProcura": maior(procura),
    }
