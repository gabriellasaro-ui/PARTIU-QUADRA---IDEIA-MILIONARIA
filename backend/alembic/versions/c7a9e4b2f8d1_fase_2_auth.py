"""Fase 2 — user_sessions + preferencias do perfil no users

Revision ID: c7a9e4b2f8d1
Revises: b2e5a1c3d4f6
Create Date: 2026-08-05

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "c7a9e4b2f8d1"
down_revision: Union[str, None] = "b2e5a1c3d4f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("birth_date", sa.Date(), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("foot", sa.String(length=10), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("favorite_sport", sa.String(length=60), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("rating", sa.Float(), nullable=True),
    )

    op.create_table(
        "user_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("access_jti", sa.String(length=64), nullable=True),
        sa.Column("refresh_token_hash", sa.String(length=64), nullable=False),
        sa.Column("device_info", sa.String(length=255), nullable=True),
        sa.Column("ip", sa.String(length=45), nullable=True),
        sa.Column("user_agent", sa.String(length=255), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("refresh_token_hash"),
    )
    op.create_index("ix_user_sessions_user_id", "user_sessions", ["user_id"])
    op.create_index("ix_user_sessions_access_jti", "user_sessions", ["access_jti"])


def downgrade() -> None:
    op.drop_index("ix_user_sessions_access_jti", table_name="user_sessions")
    op.drop_index("ix_user_sessions_user_id", table_name="user_sessions")
    op.drop_table("user_sessions")
    op.drop_column("users", "rating")
    op.drop_column("users", "favorite_sport")
    op.drop_column("users", "foot")
    op.drop_column("users", "birth_date")
