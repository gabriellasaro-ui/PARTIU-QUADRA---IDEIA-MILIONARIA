"""Peladas e presenca — Fase 9.

Uma pelada e o "jogo agendado" que nasce de uma reserva (doc §9.5): nunca
duplica a reserva — referencia `source_booking_id` e e criada de forma
idempotente por (booking, dateISO). Mensalista gera 4 peladas com +7 dias;
avulsa gera 1 na data da reserva.

`pelada_attendance` guarda o voto do participante (sim/talvez/nao). O membro
nasce do perfil; peladas avulsas tem participacao livre.
"""
import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base

PELADA_KIND_CLUBE = "clube"
PELADA_KIND_AVULSA = "avulsa"

PELADA_STATUS_AGENDADA = "agendada"
PELADA_STATUS_CANCELADA = "cancelada"
PELADA_STATUS_CONCLUIDA = "concluida"

ATTENDANCE_SIM = "sim"
ATTENDANCE_TALVEZ = "talvez"
ATTENDANCE_NAO = "nao"
ATTENDANCE_VALUES = (ATTENDANCE_SIM, ATTENDANCE_TALVEZ, ATTENDANCE_NAO)


class Pelada(Base):
    __tablename__ = "peladas"
    __table_args__ = (
        # Idempotencia: a mesma reserva nao cria a pelada da mesma data 2x.
        UniqueConstraint("source_booking_id", "date_iso", name="uq_pelada_booking_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    club_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clubs.id", ondelete="SET NULL"), index=True
    )
    source_booking_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("bookings.id", ondelete="SET NULL"), index=True
    )
    kind: Mapped[str] = mapped_column(String(10), default=PELADA_KIND_AVULSA)
    title: Mapped[str] = mapped_column(String(120))
    arena_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("arenas.id"), index=True
    )
    venue_name: Mapped[str] = mapped_column(String(120))
    sport: Mapped[str] = mapped_column(String(60))
    date_iso: Mapped[str] = mapped_column(String(10))
    start_time: Mapped[str] = mapped_column(String(5))
    duration_min: Mapped[int] = mapped_column(Integer, default=60)
    max_players: Mapped[int] = mapped_column(Integer, default=14)
    organizer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), index=True
    )
    plan: Mapped[str] = mapped_column(String(15), default="avulso")
    reservation_code: Mapped[str | None] = mapped_column(String(20))
    #: Quando a convocacao de faltantes foi disparada. Existe para o aviso sair
    #: UMA vez por pelada: a tarefa roda em ciclo curto, e sem marca ela
    #: reavisaria as mesmas pessoas a cada volta ate a hora do jogo — o jeito
    #: mais rapido de ensinar alguem a ignorar as notificacoes do app.
    chamada_em: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    status: Mapped[str] = mapped_column(
        String(15), default=PELADA_STATUS_AGENDADA, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class PeladaAttendance(Base):
    __tablename__ = "pelada_attendance"

    pelada_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("peladas.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True
    )
    value: Mapped[str] = mapped_column(String(10), default=ATTENDANCE_SIM)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
