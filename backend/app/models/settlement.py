"""Repasse (settlement) semanal da arena — Fase 8.

O financeiro e construido a partir do ledger de pagamentos confirmados, nunca
de status visual. A task semanal agrupa os payments confirmados do periodo por
arena e grava um settlement: bruto (total pago pelo jogador), comissao da
plataforma (9% do jogador + 3% da arena, ambos sobre o subtotal) e liquido
(repassado a arena = subtotal x 0.97). Ciclo: pending -> paid (com
comprovante) | failed.
"""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base

SETTLEMENT_PENDING = "pending"
SETTLEMENT_PAID = "paid"
SETTLEMENT_FAILED = "failed"


class Settlement(Base):
    __tablename__ = "settlements"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    arena_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("arenas.id"), index=True
    )
    period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    period_end: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    gross_cents: Mapped[int] = mapped_column(Integer, default=0)
    commission_cents: Mapped[int] = mapped_column(Integer, default=0)
    net_cents: Mapped[int] = mapped_column(Integer, default=0)
    bookings_count: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(
        String(10), default=SETTLEMENT_PENDING, index=True
    )
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    receipt_url: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
