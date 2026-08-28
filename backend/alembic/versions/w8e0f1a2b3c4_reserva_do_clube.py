"""Reserva feita em nome de um clube.

A pelada ja guardava `club_id`, mas ela so nasce DEPOIS de a arena aprovar — e
e na hora de aprovar que o dono da quadra precisa saber de quem e o jogo.
"Pelada do Bola Murcha, toda quinta" e uma decisao diferente de um nome solto
que ele nunca viu. Entao o clube passa a viajar com a RESERVA, do checkout ate
a fila do gerente; a pelada apenas herda dele depois.

Nullable: reserva de pessoa fisica continua sendo a maioria, e nao tem clube.

Revision ID: w8e0f1a2b3c4
Revises: v7d9e0f1a2b3
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "w8e0f1a2b3c4"
down_revision = "v7d9e0f1a2b3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("bookings", sa.Column("club_id", UUID(as_uuid=True), nullable=True))
    op.create_index("ix_bookings_club_id", "bookings", ["club_id"])


def downgrade() -> None:
    op.drop_index("ix_bookings_club_id", table_name="bookings")
    op.drop_column("bookings", "club_id")
