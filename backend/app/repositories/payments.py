"""Acesso a dados de pagamentos (Fase 5)."""
import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Payment
from .venues import _uuid


def get_payment(db: Session, payment_id) -> Payment | None:
    payment_id = _uuid(payment_id)
    if payment_id is None:
        return None
    return db.get(Payment, payment_id)


def get_by_booking(db: Session, booking_id) -> Payment | None:
    booking_id = _uuid(booking_id)
    if booking_id is None:
        return None
    return db.execute(
        select(Payment).where(Payment.booking_id == booking_id)
    ).scalar_one_or_none()


def get_by_webhook_id(db: Session, webhook_id: str) -> Payment | None:
    if not webhook_id:
        return None
    return db.execute(
        select(Payment).where(Payment.webhook_id == webhook_id)
    ).scalar_one_or_none()


def get_by_provider_ref(db: Session, provider_ref: str) -> Payment | None:
    if not provider_ref:
        return None
    return db.execute(
        select(Payment).where(Payment.provider_ref == provider_ref)
    ).scalar_one_or_none()


def list_pending_mock(db: Session, cutoff: datetime) -> list[Payment]:
    """Payments mock pendentes criados ha mais que `cutoff` (auto-confirmar).

    `cutoff` deve ser naive em UTC (colunas guardam paredes UTC).
    """
    return db.execute(
        select(Payment).where(
            Payment.status == "pending",
            Payment.provider == "mock",
            Payment.created_at <= cutoff,
        )
    ).scalars().all()
