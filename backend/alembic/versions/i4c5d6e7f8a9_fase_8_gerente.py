"""Fase 8 — gerente: settlements + coupons + reserva manual

Revision ID: i4c5d6e7f8a9
Revises: h3b4c5d6e7f8
Create Date: 2026-08-11

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "i4c5d6e7f8a9"
down_revision: Union[str, None] = "h3b4c5d6e7f8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Reserva manual: cliente pode nao ter conta; user_id vira opcional e
    # os campos client_* guardam quem esta do outro lado.
    op.add_column("bookings", sa.Column("client_name", sa.String(length=140), nullable=True))
    op.add_column("bookings", sa.Column("client_phone", sa.String(length=20), nullable=True))
    op.add_column("bookings", sa.Column("client_email", sa.String(length=255), nullable=True))
    op.alter_column("bookings", "user_id", existing_type=postgresql.UUID(as_uuid=True), nullable=True)
    op.alter_column("payments", "user_id", existing_type=postgresql.UUID(as_uuid=True), nullable=True)

    op.create_table(
        "settlements",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("arena_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("period_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("period_end", sa.DateTime(timezone=True), nullable=False),
        sa.Column("gross_cents", sa.Integer(), server_default="0", nullable=False),
        sa.Column("commission_cents", sa.Integer(), server_default="0", nullable=False),
        sa.Column("net_cents", sa.Integer(), server_default="0", nullable=False),
        sa.Column("bookings_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("status", sa.String(length=10), server_default="pending", nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("receipt_url", sa.String(length=500), nullable=True),
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
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_settlements_arena_id", "settlements", ["arena_id"])
    op.create_index("ix_settlements_status", "settlements", ["status"])
    op.create_index("ix_settlements_period_start", "settlements", ["period_start"])

    op.create_table(
        "coupons",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("arena_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("court_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("code", sa.String(length=30), nullable=False),
        sa.Column("discount_percent", sa.Integer(), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("max_uses", sa.Integer(), nullable=True),
        sa.Column("used_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["arena_id"], ["arenas.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code"),
    )
    op.create_index("ix_coupons_arena_id", "coupons", ["arena_id"])


def downgrade() -> None:
    op.drop_index("ix_coupons_arena_id", table_name="coupons")
    op.drop_table("coupons")
    op.drop_index("ix_settlements_period_start", table_name="settlements")
    op.drop_index("ix_settlements_status", table_name="settlements")
    op.drop_index("ix_settlements_arena_id", table_name="settlements")
    op.drop_table("settlements")
    op.alter_column("bookings", "user_id", existing_type=postgresql.UUID(as_uuid=True), nullable=False)
    op.alter_column("payments", "user_id", existing_type=postgresql.UUID(as_uuid=True), nullable=False)
    op.drop_column("bookings", "client_email")
    op.drop_column("bookings", "client_phone")
    op.drop_column("bookings", "client_name")
