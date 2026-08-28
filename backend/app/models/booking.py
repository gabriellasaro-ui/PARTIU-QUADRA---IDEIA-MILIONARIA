"""Reserva (booking) e eventos de status — Fase 4.

Maquina de estados (decisao: paga primeiro, conforme doc §9.1):

  pending_payment -> payment_confirmed -> requested -> confirmed -> completed

Saidas: payment_failed, rejected, cancelled, expired, refunded.

O slot e garantido por um indice unico PARCIAL sobre (court_id, start_at) que
vale so para os status ativos (uq_booking_slot_ativo), mais a validacao de
sobreposicao dentro de transacao com lock da court (SELECT ... FOR UPDATE no
Postgres). O indice precisa ser parcial: um unique cru sobre (court_id,
start_at) faria uma reserva cancelada/expirada bloquear aquele horario para
sempre, mesmo o codigo considerando o slot livre.
O servidor calcula preco/fee/total e grava o snapshot; o cliente nunca envia
valores de dinheiro.
"""
import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base
from ._types import JSONVariant

PLAN_AVULSO = "avulso"
PLAN_MENSALISTA = "mensalista"

STATUS_PENDING_PAYMENT = "pending_payment"
STATUS_PAYMENT_CONFIRMED = "payment_confirmed"
STATUS_REQUESTED = "requested"
STATUS_CONFIRMED = "confirmed"
STATUS_COMPLETED = "completed"
STATUS_PAYMENT_FAILED = "payment_failed"
STATUS_REJECTED = "rejected"
STATUS_CANCELLED = "cancelled"
STATUS_EXPIRED = "expired"
STATUS_REFUNDED = "refunded"

# Status que "ocupam" o slot (afetam disponibilidade e bloqueiam reuso).
ACTIVE_STATUSES = {
    STATUS_PENDING_PAYMENT,
    STATUS_PAYMENT_CONFIRMED,
    STATUS_REQUESTED,
    STATUS_CONFIRMED,
    STATUS_COMPLETED,
}


# WHERE do indice parcial de slot, montado a partir de ACTIVE_STATUSES para que
# banco e codigo (repositories.bookings.overlapping_bookings) nunca discordem
# sobre o que ocupa um horario. `sorted` mantem o DDL estavel entre execucoes.
_SLOT_OCUPADO = "status IN (%s)" % ", ".join(f"'{s}'" for s in sorted(ACTIVE_STATUSES))


class Booking(Base):
    __tablename__ = "bookings"
    __table_args__ = (
        Index(
            "uq_booking_slot_ativo",
            "court_id",
            "start_at",
            unique=True,
            postgresql_where=text(_SLOT_OCUPADO),
            sqlite_where=text(_SLOT_OCUPADO),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    code: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    arena_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("arenas.id"), index=True
    )
    court_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("courts.id"), index=True
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), index=True
    )
    # Reserva manual do gerente (Fase 8): cliente pode nao ter conta no app.
    # client_* guarda o identificador; user_id fica nulo nesse caso.
    client_name: Mapped[str | None] = mapped_column(String(140))
    client_phone: Mapped[str | None] = mapped_column(String(20))
    client_email: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(30), default=STATUS_PENDING_PAYMENT, index=True)
    plan: Mapped[str] = mapped_column(
        String(15), default=PLAN_AVULSO, server_default=PLAN_AVULSO
    )
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    duration_h: Mapped[int] = mapped_column(Integer, default=1)
    weekday: Mapped[int | None] = mapped_column(Integer)  # mensalista: 0=segunda

    subtotal_cents: Mapped[int] = mapped_column(Integer)
    service_fee_cents: Mapped[int] = mapped_column(Integer, default=0)
    total_cents: Mapped[int] = mapped_column(Integer)
    payment_method: Mapped[str] = mapped_column(String(20), default="pix")
    quote_snapshot: Mapped[dict | None] = mapped_column(JSONVariant)
    coupon_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    group_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))  # mensalista
    #: Clube que esta por tras desta reserva, quando ha um.
    #:
    #: A pelada ja tinha `club_id`, mas ela so NASCE depois da arena aprovar —
    #: e e justamente NA HORA DE APROVAR que o dono da quadra precisa saber de
    #: quem e o jogo. "Pelada do Bola Murcha, toda quinta" e uma decisao
    #: diferente de um nome solto que ele nunca viu.
    #:
    #: Por isso o clube viaja com a RESERVA, do checkout ate a fila do gerente,
    #: e a pelada apenas herda dele depois.
    club_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), index=True)
    # Sessao filha de mensalista: reserva as semanas 2-4 (total_cents = 0),
    # segura o slot e nao aparece sozinha na lista do jogador.
    is_session: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    idempotency_key: Mapped[str | None] = mapped_column(String(120), unique=True)
    source: Mapped[str] = mapped_column(String(20), default="app", server_default="app")
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    payment_failed_reason: Mapped[str | None] = mapped_column(String(255))

    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class BookingStatusEvent(Base):
    __tablename__ = "booking_status_events"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    booking_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("bookings.id", ondelete="CASCADE"), index=True
    )
    from_status: Mapped[str | None] = mapped_column(String(30))
    to_status: Mapped[str] = mapped_column(String(30))
    actor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    actor_role: Mapped[str | None] = mapped_column(String(20))
    reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
