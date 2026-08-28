"""Acesso a dados do painel do gerente (Fase 8).

Todo acesso parte da arena do gerente (`arenas.owner_id`). As queries usam
sempre a arena resolvida pelo token; nada aqui confia em arena_id vindo do
cliente.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session

from ..models import (
    ACTIVE_STATUSES,
    PLAN_MENSALISTA,
    STATUS_REQUESTED,
    PAYMENT_CONFIRMED,
    Arena,
    Booking,
    Coupon,
    Court,
    Payment,
    Review,
    Settlement,
    User,
)
from .venues import _uuid


def _utc_naive(dt):
    """As colunas guardam paredes UTC (SQLite guarda naive). Alinha o bind."""
    if dt.tzinfo is None:
        return dt
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def manager_arena(db: Session, manager_id) -> Arena | None:
    """Arena que o gerente e dono. Retorna None se nao tiver arena."""
    manager_id = _uuid(manager_id)
    if manager_id is None:
        return None
    return db.execute(
        select(Arena).where(
            Arena.owner_id == manager_id,
            Arena.deleted_at.is_(None),
        )
    ).scalars().first()


def _booking_rows_query(db: Session, arena_id):
    return (
        select(Booking, Court, Arena, User)
        .join(Court, Court.id == Booking.court_id)
        .join(Arena, Arena.id == Booking.arena_id)
        .outerjoin(User, User.id == Booking.user_id)
        .where(Booking.arena_id == arena_id)
    )


def list_arena_bookings(
    db: Session,
    arena_id,
    *,
    status: str | None = None,
    q: str | None = None,
    plano: str | None = None,
    sem_sessoes: bool = False,
    de: datetime | None = None,
    ate: datetime | None = None,
    limit: int = 200,
    offset: int = 0,
    com_total: bool = False,
):
    """Reservas da arena com cliente (nome/telefone), mais recentes primeiro.

    `q` busca por cliente (nome/telefone), codigo ou quadra.

    PAGINACAO de verdade (limit + offset + total), e nao um teto de 200 linhas.
    Uma arena com um ano de operacao passa de 200 reservas em semanas, e o teto
    silencioso escondia as mais antigas sem dizer que existiam — a tela mostrava
    "todas" e faltavam. `com_total` faz a segunda consulta (COUNT) so quando
    alguem precisa numerar as paginas; o resto do app nao paga por isso.
    """
    arena_id = _uuid(arena_id)
    if arena_id is None:
        return ([], 0) if com_total else []
    stmt = _booking_rows_query(db, arena_id)
    if status:
        stmt = stmt.where(Booking.status == status)
    if plano:
        stmt = stmt.where(Booking.plan == plano)
    if sem_sessoes:
        # As 3 sessoes filhas do mensalista sao o MESMO compromisso da reserva
        # pai, ja listada. Sem este corte, um plano vira quatro linhas iguais e
        # a fila de decisao do dono fica ilegivel.
        stmt = stmt.where(Booking.is_session.is_(False))
    if de is not None:
        stmt = stmt.where(Booking.start_at >= _utc_naive(de))
    if ate is not None:
        stmt = stmt.where(Booking.start_at < _utc_naive(ate))
    if q:
        like = f"%{q.strip()}%"
        conds = [
            Booking.code.ilike(like),
            Booking.client_name.ilike(like),
            Booking.client_phone.ilike(like),
            Court.name.ilike(like),
            User.name.ilike(like),
            User.phone.ilike(like),
        ]
        bid = _uuid(q.strip())
        if bid is not None:
            conds.append(Booking.id == bid)
        stmt = stmt.where(or_(*conds))
    if com_total:
        # COUNT sobre a MESMA consulta filtrada, sem order_by/limit: contar a
        # lista ja paginada devolveria o tamanho da pagina, nao o do conjunto.
        total = db.execute(
            select(func.count()).select_from(stmt.order_by(None).subquery())
        ).scalar_one()

    # ORDEM DE CAIXA DE ENTRADA, e nao de calendario.
    #
    # Era `start_at desc`: a data do JOGO. Uma solicitacao que acabou de
    # chegar para jogar amanha aparecia DEPOIS de toda reserva marcada para
    # daqui a duas semanas — no meio da lista, sem nada distinguindo. O dono
    # abria a tela principal e nao via o pedido que estava esperando decisao
    # dele, com quinze minutos no relogio antes de expirar.
    #
    # Esta tela e a caixa de entrada da arena, entao ordena como caixa de
    # entrada: primeiro o que espera resposta, depois o que chegou por ultimo.
    # A data do jogo continua na linha, e quem quer ver por calendario tem a
    # Agenda, que e a tela feita para isso.
    stmt = stmt.order_by(
        case((Booking.status == STATUS_REQUESTED, 0), else_=1),
        Booking.created_at.desc(),
    ).limit(limit).offset(offset)
    linhas = list(db.execute(stmt).all())
    return (linhas, total) if com_total else linhas


def bookings_between(db: Session, arena_id, start: datetime, end: datetime):
    """Bookings da arena com inicio em [start, end) — alimenta stats/agenda."""
    arena_id = _uuid(arena_id)
    if arena_id is None:
        return []
    return list(
        db.execute(
            _booking_rows_query(db, arena_id)
            .where(
                Booking.start_at >= _utc_naive(start),
                Booking.start_at < _utc_naive(end),
            )
            .order_by(Booking.start_at)
        ).all()
    )


def clientes_anteriores(db: Session, arena_id, antes: datetime) -> set:
    """Quem ja tinha reservado nesta arena ANTES do inicio do periodo.

    E o que separa cliente novo de cliente que voltou. Sem isso, "recorrente"
    seria so quem reservou duas vezes DENTRO da janela — e um cliente fiel de
    tres anos que veio uma vez neste mes apareceria como novo.
    """
    arena_id = _uuid(arena_id)
    if arena_id is None:
        return set()
    linhas = db.execute(
        select(Booking.user_id)
        .where(
            Booking.arena_id == arena_id,
            Booking.user_id.is_not(None),
            Booking.start_at < _utc_naive(antes),
            Booking.status.in_(list(ACTIVE_STATUSES)),
        )
        .distinct()
    ).scalars().all()
    return {str(x) for x in linhas if x}


def mensalist_groups(db: Session, arena_id):
    """Bookings "pai" de mensalistas (plan=mensalista, nao sessao)."""
    arena_id = _uuid(arena_id)
    if arena_id is None:
        return []
    return list(
        db.execute(
            _booking_rows_query(db, arena_id)
            .where(
                Booking.plan == PLAN_MENSALISTA,
                Booking.is_session.is_(False),
                Booking.group_id.is_not(None),
            )
            .order_by(Booking.start_at.desc())
        ).all()
    )


def group_bookings(db: Session, group_id) -> list[Booking]:
    group_id = _uuid(group_id)
    if group_id is None:
        return []
    return db.execute(
        select(Booking)
        .where(Booking.group_id == group_id)
        .order_by(Booking.start_at)
    ).scalars().all()


def revenue_for_period(
    db: Session, arena_id, start: datetime, end: datetime
) -> tuple[int, int, int, int]:
    """(bruto, subtotal, comissao, count) dos payments confirmados no periodo.

    Usa o ledger (payments.status == confirmed) — nunca status visual do
    booking. Comissao Qadras = fee do jogador (9%) + 3% da arena (ambos sobre
    o subtotal); liquido = subtotal x 0.97.
    """
    arena_id = _uuid(arena_id)
    if arena_id is None:
        return (0, 0, 0, 0)
    row = db.execute(
        select(
            func.coalesce(func.sum(Payment.amount_cents), 0),
            func.coalesce(func.sum(Booking.subtotal_cents), 0),
            func.count(Payment.id),
        )
        .join(Booking, Booking.id == Payment.booking_id)
        .where(
            Payment.status == PAYMENT_CONFIRMED,
            Booking.arena_id == arena_id,
            Payment.paid_at >= _utc_naive(start),
            Payment.paid_at < _utc_naive(end),
        )
    ).one()
    gross, subtotal, count = int(row[0]), int(row[1]), int(row[2])
    return (gross, subtotal, gross - int(subtotal * 0.97), count)


def settlements_for_arena(db: Session, arena_id):
    arena_id = _uuid(arena_id)
    if arena_id is None:
        return []
    return db.execute(
        select(Settlement)
        .where(Settlement.arena_id == arena_id)
        .order_by(Settlement.period_start.desc())
    ).scalars().all()


def unpaid_settlement_for(db: Session, arena_id, period_start) -> Settlement | None:
    arena_id = _uuid(arena_id)
    if arena_id is None:
        return None
    return db.execute(
        select(Settlement).where(
            Settlement.arena_id == arena_id,
            Settlement.period_start == _utc_naive(period_start),
        )
    ).scalar_one_or_none()


def list_coupons(db: Session, arena_id):
    arena_id = _uuid(arena_id)
    if arena_id is None:
        return []
    return db.execute(
        select(Coupon)
        .where(Coupon.arena_id == arena_id)
        .order_by(Coupon.created_at.desc())
    ).scalars().all()


def get_coupon(db: Session, coupon_id, arena_id) -> Coupon | None:
    coupon_id = _uuid(coupon_id)
    arena_id = _uuid(arena_id)
    if coupon_id is None or arena_id is None:
        return None
    return db.execute(
        select(Coupon).where(
            Coupon.id == coupon_id,
            Coupon.arena_id == arena_id,
        )
    ).scalar_one_or_none()


def get_coupon_by_code(db: Session, code: str) -> Coupon | None:
    if not code:
        return None
    return db.execute(
        select(Coupon).where(Coupon.code == code.strip().upper())
    ).scalar_one_or_none()


def list_courts_for_arena(db: Session, arena_id):
    arena_id = _uuid(arena_id)
    if arena_id is None:
        return []
    return db.execute(
        select(Court).where(
            Court.arena_id == arena_id,
            Court.deleted_at.is_(None),
        )
    ).scalars().all()


def get_court_in_arena(db: Session, court_id, arena_id) -> Court | None:
    court_id = _uuid(court_id)
    arena_id = _uuid(arena_id)
    if court_id is None or arena_id is None:
        return None
    return db.execute(
        select(Court).where(Court.id == court_id, Court.arena_id == arena_id)
    ).scalar_one_or_none()


def reviews_for_arena_owner(db: Session, arena_id, limit: int = 50):
    from .venues import reviews_for_arena

    return reviews_for_arena(db, arena_id, limit=limit)


def review_distribution(db: Session, arena_id) -> list[dict]:
    arena_id = _uuid(arena_id)
    if arena_id is None:
        return []
    rows = db.execute(
        select(Review.rating, func.count(Review.id))
        .where(Review.arena_id == arena_id)
        .group_by(Review.rating)
    ).all()
    counts = {r[0]: r[1] for r in rows}
    return [{"n": n, "qtd": counts.get(n, 0)} for n in (5, 4, 3, 2, 1)]


def booked_slots_in_week(db: Session, arena_id, start: datetime, end: datetime) -> int:
    """Qtd de reservas ativas (nao sessoes) dentro da semana — p/ ocupacao."""
    arena_id = _uuid(arena_id)
    if arena_id is None:
        return 0
    return int(
        db.execute(
            select(func.count(Booking.id)).where(
                Booking.arena_id == arena_id,
                Booking.is_session.is_(False),
                Booking.status.in_(ACTIVE_STATUSES),
                Booking.start_at >= _utc_naive(start),
                Booking.start_at < _utc_naive(end),
            )
        ).scalar_one()
    )


def active_bookings_count(db: Session, arena_id, statuses: list[str]) -> int:
    arena_id = _uuid(arena_id)
    if arena_id is None:
        return 0
    return int(
        db.execute(
            select(func.count(Booking.id)).where(
                Booking.arena_id == arena_id,
                Booking.status.in_(statuses),
            )
        ).scalar_one()
    )


def next_bookings(db: Session, arena_id, start: datetime, limit: int = 8):
    arena_id = _uuid(arena_id)
    if arena_id is None:
        return []
    return list(
        db.execute(
            _booking_rows_query(db, arena_id)
            .where(
                Booking.status.in_(ACTIVE_STATUSES),
                Booking.start_at >= _utc_naive(start),
            )
            .order_by(Booking.start_at)
            .limit(limit)
        ).all()
    )


def demand_by_slot(db: Session, arena_id, start: datetime, end: datetime):
    """Procura por (dia da semana, hora) nas quadras da arena.

    O intervalo NAO filtra as linhas: `slot_demand` guarda um acumulado por
    slot, e nao um evento por visita — nao ha data para cortar. O intervalo
    entra na assinatura porque quem chama ja o tem em maos e porque o dia em
    que houver janelamento (uma linha por mes, por exemplo) a mudanca fica
    contida aqui.
    """
    from ..models import SlotDemand

    arena_id = _uuid(arena_id)
    if arena_id is None:
        return []
    quadras = select(Court.id).where(Court.arena_id == arena_id)
    linhas = db.execute(
        select(
            SlotDemand.day_of_week,
            SlotDemand.hour,
            func.sum(SlotDemand.views),
        )
        .where(SlotDemand.court_id.in_(quadras))
        .group_by(SlotDemand.day_of_week, SlotDemand.hour)
    ).all()
    return [(d, h, v or 0) for d, h, v in linhas]


def registrar_procura(db: Session, court_id, dia_semana: int, horas: list[int]) -> None:
    """Soma 1 na procura de cada hora olhada.

    Best-effort de proposito: se falhar, engole. Isto e telemetria de produto —
    derrubar a agenda de quem quer jogar porque o contador nao subiu seria
    trocar o essencial pelo acessorio.
    """
    from ..models import SlotDemand

    court_id = _uuid(court_id)
    if court_id is None or not horas:
        return
    try:
        existentes = {
            (r.day_of_week, r.hour): r
            for r in db.execute(
                select(SlotDemand).where(
                    SlotDemand.court_id == court_id,
                    SlotDemand.day_of_week == dia_semana,
                    SlotDemand.hour.in_(horas),
                )
            ).scalars()
        }
        for hora in horas:
            linha = existentes.get((dia_semana, hora))
            if linha is None:
                db.add(SlotDemand(
                    court_id=court_id, day_of_week=dia_semana, hour=hora, views=1
                ))
            else:
                linha.views = (linha.views or 0) + 1
        db.commit()
    except Exception:  # noqa: BLE001
        db.rollback()


def reviews_with_court(db: Session, arena_id, limit: int = 200):
    """Avaliacoes da arena com a quadra, quando da para saber qual foi.

    `reviews` guarda arena_id e, opcionalmente, booking_id — nao ha court_id.
    A quadra sai da reserva avaliada; avaliacao sem reserva (as semeadas, e as
    feitas sobre a arena em geral) fica sem quadra, e isso e devolvido como
    None em vez de chutada para a primeira quadra da lista. Atribuir a quadra
    errada a uma nota 2 seria pior que nao atribuir nenhuma.
    """
    from ..models import Review

    arena_id = _uuid(arena_id)
    if arena_id is None:
        return []
    autor = func.coalesce(User.name, "Cliente")
    return list(
        db.execute(
            select(Review, autor, Court.id, Court.name)
            .join(User, User.id == Review.user_id, isouter=True)
            .join(Booking, Booking.id == Review.booking_id, isouter=True)
            .join(Court, Court.id == Booking.court_id, isouter=True)
            .where(Review.arena_id == arena_id)
            .order_by(Review.created_at.desc())
            .limit(limit)
        ).all()
    )


def revenue_by_day(db: Session, arena_id, start: datetime, end: datetime):
    """Faturamento por DIA no intervalo, para o grafico da semana.

    O painel desenhava a semana a partir do total do mes dividido por sete e
    multiplicado por pesos escolhidos a mao — um grafico que parecia dado e nao
    era. Pior: as "oportunidades" ("terca e seu dia mais fraco") saiam dessa
    invencao, entao o painel dava conselho comercial baseado em nada.

    Aqui sai do ledger, agrupado por dia. Dia sem faturamento nao aparece na
    consulta; quem chama preenche com zero, porque buraco no meio de uma serie
    temporal desloca o grafico inteiro.
    """
    from ..models import Booking, PAYMENT_CONFIRMED, Payment

    arena_id = _uuid(arena_id)
    if arena_id is None:
        return []
    linhas = db.execute(
        select(
            func.date(Booking.start_at).label("dia"),
            func.sum(Payment.amount_cents),
            func.count(Payment.id),
        )
        .join(Booking, Booking.id == Payment.booking_id)
        .where(
            Booking.arena_id == arena_id,
            Payment.status == PAYMENT_CONFIRMED,
            Booking.start_at >= _utc_naive(start),
            Booking.start_at < _utc_naive(end),
        )
        .group_by(func.date(Booking.start_at))
        .order_by(func.date(Booking.start_at))
    ).all()
    return [(str(d), int(v or 0), int(c or 0)) for d, v, c in linhas]
