"""Acesso a dados do painel do gerente (Fase 8).

Todo acesso parte da arena do gerente (`arenas.owner_id`). As queries usam
sempre a arena resolvida pelo token; nada aqui confia em arena_id vindo do
cliente.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..models import (
    ACTIVE_STATUSES,
    PLAN_MENSALISTA,
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
    limit: int = 200,
):
    """Reservas da arena com cliente (nome/telefone), mais recentes primeiro.

    `q` busca por cliente (nome/telefone), codigo ou quadra.
    """
    arena_id = _uuid(arena_id)
    if arena_id is None:
        return []
    stmt = _booking_rows_query(db, arena_id)
    if status:
        stmt = stmt.where(Booking.status == status)
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
    stmt = stmt.order_by(Booking.start_at.desc()).limit(limit)
    return list(db.execute(stmt).all())


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
