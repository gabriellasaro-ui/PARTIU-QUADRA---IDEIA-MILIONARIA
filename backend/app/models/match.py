"""Partidas (Game Day) — Fase 9.

A partida e o dia de jogo de uma reserva confirmada: `matches.booking_id` e
unico (uma reserva = um Game Day). A fase (pre/during/post) e derivada dos
timestamps na serializacao, como o frontend faz com `matchPhaseNow`; a linha
em `matches` e materializada sob demanda no `GET /api/partidas/ativa` para dar
id estavel para as mutacoes.

Sao persistidos apenas os dados autoritativos: placar (`score`), times
sorteados (`teams` snapshot + `match_teams`), presenca/atraso
(`match_players`), gols/cartoes (`match_events`), midia (URLs,
`match_media`) e avaliacao (`ratings`). Rodadas/fila/winner-stays do app
continuam efemeros no cliente.
"""
import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base
from ._types import JSONVariant

MATCH_STATUS_SCHEDULED = "scheduled"
MATCH_STATUS_LIVE = "live"
MATCH_STATUS_ENDED = "ended"

MATCH_PHASE_PRE_GAME = "pre-game"
MATCH_PHASE_DURING_GAME = "during-game"
MATCH_PHASE_POST_GAME = "post-game"

MATCH_EVENT_GOAL = "goal"
MATCH_EVENT_YELLOW = "yellow"
MATCH_EVENT_RED = "red"
MATCH_EVENT_TYPES = (MATCH_EVENT_GOAL, MATCH_EVENT_YELLOW, MATCH_EVENT_RED)


class Match(Base):
    __tablename__ = "matches"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    booking_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("bookings.id", ondelete="CASCADE"), unique=True
    )
    pelada_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("peladas.id", ondelete="SET NULL"), index=True
    )
    arena_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("arenas.id"), index=True
    )
    venue_name: Mapped[str] = mapped_column(String(120))
    sport: Mapped[str] = mapped_column(String(60))
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    duration_min: Mapped[int] = mapped_column(Integer, default=60)
    status: Mapped[str] = mapped_column(
        String(10), default=MATCH_STATUS_SCHEDULED, index=True
    )
    score: Mapped[dict] = mapped_column(JSONVariant, default=dict)
    teams: Mapped[dict | None] = mapped_column(JSONVariant)
    ratings: Mapped[dict] = mapped_column(JSONVariant, default=dict)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class MatchTeam(Base):
    __tablename__ = "match_teams"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    match_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("matches.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(40))
    color: Mapped[str | None] = mapped_column(String(30))
    accent: Mapped[str | None] = mapped_column(String(30))
    score: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class MatchPlayer(Base):
    __tablename__ = "match_players"
    __table_args__ = (UniqueConstraint("match_id", "user_id"),)

    match_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("matches.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True
    )
    team_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("match_teams.id", ondelete="SET NULL")
    )
    name: Mapped[str] = mapped_column(String(120))
    position: Mapped[str | None] = mapped_column(String(40))
    rating: Mapped[float | None] = mapped_column(Float)
    confirmed: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    delay_minutes: Mapped[int] = mapped_column(Integer, default=0)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class MatchEvent(Base):
    __tablename__ = "match_events"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    match_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("matches.id", ondelete="CASCADE"), index=True
    )
    event_type: Mapped[str] = mapped_column(String(10))
    team: Mapped[str | None] = mapped_column(String(1))  # 'A' | 'B'
    player_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    player_name: Mapped[str | None] = mapped_column(String(120))
    text: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class MatchMedia(Base):
    __tablename__ = "match_media"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    match_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("matches.id", ondelete="CASCADE"), index=True
    )
    media_type: Mapped[str] = mapped_column(String(10))  # photo | video
    url: Mapped[str] = mapped_column(String(500))
    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
