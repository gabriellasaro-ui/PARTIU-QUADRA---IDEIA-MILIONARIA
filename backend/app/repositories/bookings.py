"""Acesso a dados de reservas (Fase 4).

O lock de slot e transacional: o servico trava a linha da court
(SELECT ... FOR UPDATE no Postgres) e valida sobreposicao com bookings ativas
antes de inserir. A garantia dura e UNIQUE(court_id, start_at) na tabela.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from ..models import (
    ACTIVE_STATUSES,
    Arena,
    Booking,
    BookingStatusEvent,
    Court,
)
from .venues import _uuid


def lock_court(db: Session, court_id):
    """Trava a linha da court para serializar criacao por quadra."""
    court_id = _uuid(court_id)
    if court_id is None:
        return None
    return db.execute(
        select(Court).where(Court.id == court_id).with_for_update()
    ).scalar_one_or_none()


def _utc_naive(dt: datetime) -> datetime:
    """As colunas guardam paredes UTC (SQLite guarda naive). Alinha o bind."""
    if dt.tzinfo is None:
        return dt
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def overlapping_bookings(
    db: Session, court_id, start: datetime, end: datetime
) -> list[Booking]:
    """Bookings ativas que cobrem [start, end). Ignora as terminais."""
    court_id = _uuid(court_id)
    if court_id is None:
        return []
    return db.execute(
        select(Booking).where(
            Booking.court_id == court_id,
            Booking.status.in_(ACTIVE_STATUSES),
            Booking.start_at < _utc_naive(end),
            Booking.end_at > _utc_naive(start),
        )
    ).scalars().all()


def active_bookings_for_court(
    db: Session, court_id, start: datetime, end: datetime
) -> list[Booking]:
    """Bookings ativas no intervalo — alimenta a disponibilidade (/horarios)."""
    return overlapping_bookings(db, court_id, start, end)


def _booking_query():
    return select(Booking, Court, Arena).join(Court, Court.id == Booking.court_id).join(
        Arena, Arena.id == Booking.arena_id
    )


def get_booking_by_code(db: Session, code: str) -> Booking | None:
    if not code:
        return None
    return db.execute(select(Booking).where(Booking.code == code)).scalar_one_or_none()


def get_booking(db: Session, booking_id) -> tuple[Booking, Court, Arena] | None:
    booking_id = _uuid(booking_id)
    if booking_id is None:
        return None
    return db.execute(_booking_query().where(Booking.id == booking_id)).one_or_none()


def list_user_bookings(
    db: Session, user_id, limit: int = 100, offset: int = 0
) -> list[tuple[Booking, Court, Arena]]:
    user_id = _uuid(user_id)
    if user_id is None:
        return []
    return db.execute(
        _booking_query()
        .where(Booking.user_id == user_id)
        .order_by(Booking.start_at.desc())
        .limit(limit)
        .offset(offset)
    ).all()


def events_for_booking(db: Session, booking_id) -> list[BookingStatusEvent]:
    booking_id = _uuid(booking_id)
    if booking_id is None:
        return []
    return db.execute(
        select(BookingStatusEvent)
        .where(BookingStatusEvent.booking_id == booking_id)
        .order_by(BookingStatusEvent.created_at)
    ).scalars().all()


def get_by_idempotency(db: Session, key: str) -> list[Booking] | None:
    """Retorna a(s) reserva(s) ja criada(s) com a mesma chave (replay)."""
    if not key:
        return None
    rows = db.execute(
        select(Booking)
        .where(Booking.idempotency_key == key)
        .order_by(Booking.start_at)
    ).scalars().all()
    if not rows:
        return None
    return list(rows)


def get_group(db: Session, group_id) -> list[Booking]:
    group_id = _uuid(group_id)
    if group_id is None:
        return []
    return db.execute(
        select(Booking).where(Booking.group_id == group_id).order_by(Booking.start_at)
    ).scalars().all()


def list_arena_bookings(db: Session, arena_id, limit: int = 100) -> list[tuple[Booking, Court, Arena]]:
    arena_id = _uuid(arena_id)
    if arena_id is None:
        return []
    return db.execute(
        _booking_query()
        .where(Booking.arena_id == arena_id)
        .order_by(Booking.start_at.desc())
        .limit(limit)
    ).all()
