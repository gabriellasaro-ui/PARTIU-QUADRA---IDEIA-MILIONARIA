"""Fase 3 — catalogo: arenas, courts, blocks, disponibilidade, reviews, favoritos

Revision ID: d2b4f6a8c9e0
Revises: c7a9e4b2f8d1
Create Date: 2026-08-05

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "d2b4f6a8c9e0"
down_revision: Union[str, None] = "c7a9e4b2f8d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "arenas",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("name", sa.String(length=140), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("logo", sa.String(length=500), nullable=True),
        sa.Column("phone", sa.String(length=20), nullable=True),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("pix_key", sa.String(length=200), nullable=True),
        sa.Column("address", sa.String(length=255), nullable=True),
        sa.Column("city", sa.String(length=120), nullable=True),
        sa.Column("state", sa.String(length=2), nullable=True),
        sa.Column("lat", sa.Float(), nullable=True),
        sa.Column("lng", sa.Float(), nullable=True),
        sa.Column(
            "is_active", sa.Boolean(), server_default="true", nullable=False
        ),
        sa.Column("boosted_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("settings", postgresql.JSONB(), nullable=True),
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
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_arenas_name", "arenas", ["name"])
    op.create_index("ix_arenas_city", "arenas", ["city"])
    op.create_index("ix_arenas_owner_id", "arenas", ["owner_id"])

    op.create_table(
        "courts",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("arena_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("sport", sa.String(length=60), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("price_cents", sa.Integer(), nullable=False),
        sa.Column("price_monthly_cents", sa.Integer(), nullable=True),
        sa.Column("min_duration_h", sa.Integer(), server_default="1", nullable=False),
        sa.Column("opening_time", sa.Time(), nullable=False),
        sa.Column("closing_time", sa.Time(), nullable=False),
        sa.Column(
            "is_active", sa.Boolean(), server_default="true", nullable=False
        ),
        sa.Column(
            "is_visible", sa.Boolean(), server_default="true", nullable=False
        ),
        sa.Column(
            "is_featured", sa.Boolean(), server_default="false", nullable=False
        ),
        sa.Column("photos", postgresql.JSONB(), nullable=True),
        sa.Column("amenities", postgresql.JSONB(), nullable=True),
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
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_courts_arena_id", "courts", ["arena_id"])
    op.create_index("ix_courts_sport", "courts", ["sport"])

    op.create_table(
        "court_blocks",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("court_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("start_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reason", sa.String(length=80), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_court_blocks_court_id", "court_blocks", ["court_id"])
    op.create_index("ix_court_blocks_start_at", "court_blocks", ["start_at"])

    op.create_table(
        "court_recurring_availability",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("court_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("day_of_week", sa.Integer(), nullable=False),
        sa.Column("start_time", sa.Time(), nullable=False),
        sa.Column("end_time", sa.Time(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_court_rec_avail_court_id",
        "court_recurring_availability",
        ["court_id"],
    )

    op.create_table(
        "reviews",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("booking_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("arena_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("rating", sa.Integer(), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("reply", sa.Text(), nullable=True),
        sa.Column("replied_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("replied_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["arena_id"], ["arenas.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_reviews_arena_id", "reviews", ["arena_id"])
    op.create_index("ix_reviews_booking_id", "reviews", ["booking_id"])
    op.create_index("ix_reviews_user_id", "reviews", ["user_id"])

    op.create_table(
        "user_favorites",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("arena_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["arena_id"], ["arenas.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "arena_id"),
    )


def downgrade() -> None:
    op.drop_table("user_favorites")
    op.drop_index("ix_reviews_user_id", table_name="reviews")
    op.drop_index("ix_reviews_booking_id", table_name="reviews")
    op.drop_index("ix_reviews_arena_id", table_name="reviews")
    op.drop_table("reviews")
    op.drop_index(
        "ix_court_rec_avail_court_id", table_name="court_recurring_availability"
    )
    op.drop_table("court_recurring_availability")
    op.drop_index("ix_court_blocks_start_at", table_name="court_blocks")
    op.drop_index("ix_court_blocks_court_id", table_name="court_blocks")
    op.drop_table("court_blocks")
    op.drop_index("ix_courts_sport", table_name="courts")
    op.drop_index("ix_courts_arena_id", table_name="courts")
    op.drop_table("courts")
    op.drop_index("ix_arenas_owner_id", table_name="arenas")
    op.drop_index("ix_arenas_city", table_name="arenas")
    op.drop_index("ix_arenas_name", table_name="arenas")
    op.drop_table("arenas")
