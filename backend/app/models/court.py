"""Quadra (court) de uma arena, blocos de indisponibilidade e horarios fixos.

A disponibilidade publica e derivada de:
  - opening_time / closing_time (janela do dia)
  - court_recurring_availability (dia da semana)
  - court_blocks (manutencao/evento)
Reservas entram na Fase 4 e passam a ocupar slots a partir de UNIQUE(court_id,
start_at).
"""
import uuid
from datetime import datetime, time

from sqlalchemy import Boolean, DateTime, Integer, String, Text, Time, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base
from ._types import JSONVariant


class Court(Base):
    __tablename__ = "courts"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    arena_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), index=True
    )
    name: Mapped[str] = mapped_column(String(120))
    sport: Mapped[str] = mapped_column(String(60), index=True)
    description: Mapped[str | None] = mapped_column(Text)
    price_cents: Mapped[int] = mapped_column(Integer)
    price_monthly_cents: Mapped[int | None] = mapped_column(Integer)
    min_duration_h: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    opening_time: Mapped[time] = mapped_column(Time)
    closing_time: Mapped[time] = mapped_column(Time)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    is_visible: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    is_featured: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    photos: Mapped[list | None] = mapped_column(JSONVariant)
    amenities: Mapped[list | None] = mapped_column(JSONVariant)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class CourtBlock(Base):
    __tablename__ = "court_blocks"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    court_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), index=True
    )
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    reason: Mapped[str | None] = mapped_column(String(80))


class CourtRecurringAvailability(Base):
    __tablename__ = "court_recurring_availability"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    court_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), index=True
    )
    day_of_week: Mapped[int] = mapped_column(Integer)  # 0 = segunda, 6 = domingo
    start_time: Mapped[time] = mapped_column(Time)
    end_time: Mapped[time] = mapped_column(Time)
    #: FECHADO NESSE DIA, dito explicitamente pelo gerente.
    #:
    #: Antes, "nao abre domingo" so podia ser expresso APAGANDO a linha do
    #: domingo — e `recurring_for_court` trata lista vazia como "usa o
    #: opening/closing padrao do court". Ou seja: apagar o domingo fazia a
    #: quadra aparecer ABERTA no horario padrao, o oposto do que o gerente
    #: quis, e ele so descobriria quando alguem reservasse.
    #:
    #: Com a coluna, ausencia e fechamento deixam de ser a mesma coisa:
    #:   linha ausente  -> nao configurado, cai no padrao do court
    #:   closed = True  -> o gerente disse que nao abre
    closed: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("0"), nullable=False
    )
