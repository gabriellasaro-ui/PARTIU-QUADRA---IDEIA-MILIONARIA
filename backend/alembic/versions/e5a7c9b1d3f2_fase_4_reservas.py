"""Fase 4 — reservas: bookings + booking_status_events

Revision ID: e5a7c9b1d3f2
Revises: d2b4f6a8c9e0
Create Date: 2026-08-06

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "e5a7c9b1d3f2"
down_revision: Union[str, None] = "d2b4f6a8c9e0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "bookings",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("code", sa.String(length=20), nullable=False),
        sa.Column("arena_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("court_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("plan", sa.String(length=15), server_default="avulso", nullable=False),
        sa.Column("start_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("duration_h", sa.Integer(), server_default="1", nullable=False),
        sa.Column("weekday", sa.Integer(), nullable=True),
        sa.Column("subtotal_cents", sa.Integer(), nullable=False),
        sa.Column("service_fee_cents", sa.Integer(), server_default="0", nullable=False),
        sa.Column("total_cents", sa.Integer(), nullable=False),
        sa.Column("payment_method", sa.String(length=20), server_default="pix", nullable=False),
        sa.Column("quote_snapshot", postgresql.JSONB(), nullable=True),
        sa.Column("coupon_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("group_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "is_session", sa.Boolean(), server_default="false", nullable=False
        ),
        sa.Column("idempotency_key", sa.String(length=120), nullable=True),
        sa.Column("source", sa.String(length=20), server_default="app", nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("payment_failed_reason", sa.String(length=255), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["arena_id"], ["arenas.id"]),
        sa.ForeignKeyConstraint(["court_id"], ["courts.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("court_id", "start_at", name="uq_booking_slot"),
        sa.UniqueConstraint("idempotency_key"),
    )
    op.create_index("ix_bookings_code", "bookings", ["code"], unique=True)
    op.create_index("ix_bookings_status", "bookings", ["status"])
    op.create_index("ix_bookings_start_at", "bookings", ["start_at"])
    op.create_index("ix_bookings_arena_id", "bookings", ["arena_id"])
    op.create_index("ix_bookings_court_id", "bookings", ["court_id"])
    op.create_index("ix_bookings_user_id", "bookings", ["user_id"])

    op.create_table(
        "booking_status_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("booking_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("from_status", sa.String(length=30), nullable=True),
        sa.Column("to_status", sa.String(length=30), nullable=False),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("actor_role", sa.String(length=20), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["booking_id"], ["bookings.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_booking_status_events_booking_id",
        "booking_status_events",
        ["booking_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_booking_status_events_booking_id", table_name="booking_status_events"
    )
    op.drop_table("booking_status_events")
    op.drop_index("ix_bookings_user_id", table_name="bookings")
    op.drop_index("ix_bookings_court_id", table_name="bookings")
    op.drop_index("ix_bookings_arena_id", table_name="bookings")
    op.drop_index("ix_bookings_start_at", table_name="bookings")
    op.drop_index("ix_bookings_status", table_name="bookings")
    op.drop_index("ix_bookings_code", table_name="bookings")
    op.drop_table("bookings")
