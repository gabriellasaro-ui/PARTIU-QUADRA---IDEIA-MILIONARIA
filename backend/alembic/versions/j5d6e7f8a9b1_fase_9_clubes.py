"""Fase 9 — clubes, peladas e partidas (Game Day)

Revision ID: j5d6e7f8a9b1
Revises: i4c5d6e7f8a9
Create Date: 2026-08-11

Cria as 10 tabelas canonicas da fase: clubs, club_members, club_messages,
peladas, pelada_attendance, matches, match_teams, match_players, match_events
e match_media. Partida e unica por reserva (matches.booking_id unique) e a
pelada e idempotente por (source_booking_id, date_iso).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "j5d6e7f8a9b1"
down_revision: Union[str, None] = "i4c5d6e7f8a9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _uuid() -> postgresql.UUID:
    return postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    # ─── Clubes ────────────────────────────────────────────────────────────
    op.create_table(
        "clubs",
        sa.Column("id", _uuid(), nullable=False),
        sa.Column("name", sa.String(length=60), nullable=False),
        sa.Column("code", sa.String(length=6), nullable=False),
        sa.Column("sport", sa.String(length=60), nullable=False),
        sa.Column("city", sa.String(length=60), nullable=False),
        sa.Column("state", sa.String(length=2), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("photo", sa.String(length=500), nullable=True),
        sa.Column("owner_id", _uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code"),
    )
    op.create_index("ix_clubs_code", "clubs", ["code"])
    op.create_index("ix_clubs_owner_id", "clubs", ["owner_id"])

    op.create_table(
        "club_members",
        sa.Column("club_id", _uuid(), nullable=False),
        sa.Column("user_id", _uuid(), nullable=False),
        sa.Column("role", sa.String(length=10), server_default="membro", nullable=False),
        sa.Column("joined_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["club_id"], ["clubs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("club_id", "user_id"),
        sa.UniqueConstraint("club_id", "user_id"),
    )

    op.create_table(
        "club_messages",
        sa.Column("id", _uuid(), nullable=False),
        sa.Column("club_id", _uuid(), nullable=False),
        sa.Column("member_id", _uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["club_id"], ["clubs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["member_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_club_messages_club_id", "club_messages", ["club_id"])

    # ─── Peladas ───────────────────────────────────────────────────────────
    op.create_table(
        "peladas",
        sa.Column("id", _uuid(), nullable=False),
        sa.Column("club_id", _uuid(), nullable=True),
        sa.Column("source_booking_id", _uuid(), nullable=True),
        sa.Column("kind", sa.String(length=10), server_default="avulsa", nullable=False),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("arena_id", _uuid(), nullable=False),
        sa.Column("venue_name", sa.String(length=120), nullable=False),
        sa.Column("sport", sa.String(length=60), nullable=False),
        sa.Column("date_iso", sa.String(length=10), nullable=False),
        sa.Column("start_time", sa.String(length=5), nullable=False),
        sa.Column("duration_min", sa.Integer(), server_default="60", nullable=False),
        sa.Column("max_players", sa.Integer(), server_default="14", nullable=False),
        sa.Column("organizer_id", _uuid(), nullable=False),
        sa.Column("plan", sa.String(length=15), server_default="avulso", nullable=False),
        sa.Column("reservation_code", sa.String(length=20), nullable=True),
        sa.Column("status", sa.String(length=15), server_default="agendada", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["arena_id"], ["arenas.id"]),
        sa.ForeignKeyConstraint(["club_id"], ["clubs.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["organizer_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["source_booking_id"], ["bookings.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("source_booking_id", "date_iso", name="uq_pelada_booking_date"),
    )
    op.create_index("ix_peladas_club_id", "peladas", ["club_id"])
    op.create_index("ix_peladas_arena_id", "peladas", ["arena_id"])
    op.create_index("ix_peladas_source_booking_id", "peladas", ["source_booking_id"])
    op.create_index("ix_peladas_organizer_id", "peladas", ["organizer_id"])
    op.create_index("ix_peladas_status", "peladas", ["status"])

    op.create_table(
        "pelada_attendance",
        sa.Column("pelada_id", _uuid(), nullable=False),
        sa.Column("user_id", _uuid(), nullable=False),
        sa.Column("value", sa.String(length=10), server_default="sim", nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["pelada_id"], ["peladas.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("pelada_id", "user_id"),
    )

    # ─── Partidas (Game Day) ───────────────────────────────────────────────
    op.create_table(
        "matches",
        sa.Column("id", _uuid(), nullable=False),
        sa.Column("booking_id", _uuid(), nullable=False),
        sa.Column("pelada_id", _uuid(), nullable=True),
        sa.Column("arena_id", _uuid(), nullable=False),
        sa.Column("venue_name", sa.String(length=120), nullable=False),
        sa.Column("sport", sa.String(length=60), nullable=False),
        sa.Column("start_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("duration_min", sa.Integer(), server_default="60", nullable=False),
        sa.Column("status", sa.String(length=10), server_default="scheduled", nullable=False),
        sa.Column("score", postgresql.JSONB(), server_default=sa.text("'{}'"), nullable=False),
        sa.Column("teams", postgresql.JSONB(), nullable=True),
        sa.Column("ratings", postgresql.JSONB(), server_default=sa.text("'{}'"), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["arena_id"], ["arenas.id"]),
        sa.ForeignKeyConstraint(["booking_id"], ["bookings.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["pelada_id"], ["peladas.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("booking_id"),
    )
    op.create_index("ix_matches_pelada_id", "matches", ["pelada_id"])
    op.create_index("ix_matches_arena_id", "matches", ["arena_id"])
    op.create_index("ix_matches_status", "matches", ["status"])

    op.create_table(
        "match_teams",
        sa.Column("id", _uuid(), nullable=False),
        sa.Column("match_id", _uuid(), nullable=False),
        sa.Column("name", sa.String(length=40), nullable=False),
        sa.Column("color", sa.String(length=30), nullable=True),
        sa.Column("accent", sa.String(length=30), nullable=True),
        sa.Column("score", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["match_id"], ["matches.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_match_teams_match_id", "match_teams", ["match_id"])

    op.create_table(
        "match_players",
        sa.Column("match_id", _uuid(), nullable=False),
        sa.Column("user_id", _uuid(), nullable=False),
        sa.Column("team_id", _uuid(), nullable=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("position", sa.String(length=40), nullable=True),
        sa.Column("rating", sa.Float(), nullable=True),
        sa.Column("confirmed", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("delay_minutes", sa.Integer(), server_default="0", nullable=False),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["match_id"], ["matches.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["team_id"], ["match_teams.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("match_id", "user_id"),
        sa.UniqueConstraint("match_id", "user_id"),
    )

    op.create_table(
        "match_events",
        sa.Column("id", _uuid(), nullable=False),
        sa.Column("match_id", _uuid(), nullable=False),
        sa.Column("event_type", sa.String(length=10), nullable=False),
        sa.Column("team", sa.String(length=1), nullable=True),
        sa.Column("player_id", _uuid(), nullable=True),
        sa.Column("player_name", sa.String(length=120), nullable=True),
        sa.Column("text", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["match_id"], ["matches.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_match_events_match_id", "match_events", ["match_id"])

    op.create_table(
        "match_media",
        sa.Column("id", _uuid(), nullable=False),
        sa.Column("match_id", _uuid(), nullable=False),
        sa.Column("media_type", sa.String(length=10), nullable=False),
        sa.Column("url", sa.String(length=500), nullable=False),
        sa.Column("uploaded_by", _uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["match_id"], ["matches.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_match_media_match_id", "match_media", ["match_id"])


def downgrade() -> None:
    op.drop_index("ix_match_media_match_id", table_name="match_media")
    op.drop_table("match_media")
    op.drop_index("ix_match_events_match_id", table_name="match_events")
    op.drop_table("match_events")
    op.drop_table("match_players")
    op.drop_index("ix_match_teams_match_id", table_name="match_teams")
    op.drop_table("match_teams")
    op.drop_index("ix_matches_status", table_name="matches")
    op.drop_index("ix_matches_arena_id", table_name="matches")
    op.drop_index("ix_matches_pelada_id", table_name="matches")
    op.drop_table("matches")
    op.drop_table("pelada_attendance")
    op.drop_index("ix_peladas_status", table_name="peladas")
    op.drop_index("ix_peladas_organizer_id", table_name="peladas")
    op.drop_index("ix_peladas_source_booking_id", table_name="peladas")
    op.drop_index("ix_peladas_arena_id", table_name="peladas")
    op.drop_index("ix_peladas_club_id", table_name="peladas")
    op.drop_table("peladas")
    op.drop_index("ix_club_messages_club_id", table_name="club_messages")
    op.drop_table("club_messages")
    op.drop_table("club_members")
    op.drop_index("ix_clubs_owner_id", table_name="clubs")
    op.drop_index("ix_clubs_code", table_name="clubs")
    op.drop_table("clubs")
