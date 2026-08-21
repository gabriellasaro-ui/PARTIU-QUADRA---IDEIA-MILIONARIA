"""Pagamento de uma reserva — Fase 5.

O provider (Mercado Pago em producao; mock em desenvolvimento) cria um intent
(Pix/cartao) e o webhook confirma. O booking so sai de pending_payment via
pagamento confirmado — nunca por clique no botao.

webhook_id UNIQUE garante idempotencia do webhook: um callback repetido e
tratado como replay, sem transicao dupla nem duplicacao.
"""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base
from ._types import JSONVariant

PAYMENT_PENDING = "pending"
PAYMENT_CONFIRMED = "confirmed"
PAYMENT_FAILED = "failed"
PAYMENT_REFUNDED = "refunded"


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    booking_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("bookings.id"), unique=True
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), index=True
    )
    provider: Mapped[str] = mapped_column(String(20), default="mock")
    method: Mapped[str] = mapped_column(String(20), default="pix")  # pix | card
    amount_cents: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20), default=PAYMENT_PENDING, index=True)
    provider_ref: Mapped[str | None] = mapped_column(String(120))
    webhook_id: Mapped[str | None] = mapped_column(String(120), unique=True)
    payload: Mapped[dict | None] = mapped_column(JSONVariant)
    qr_code: Mapped[str | None] = mapped_column(Text)
    qr_code_image: Mapped[str | None] = mapped_column(Text)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
