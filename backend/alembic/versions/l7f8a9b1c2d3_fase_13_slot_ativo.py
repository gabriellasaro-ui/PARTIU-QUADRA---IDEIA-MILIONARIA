"""Fase 13 — slot bloqueado so por reserva viva

Troca UNIQUE(court_id, start_at) por um indice unico PARCIAL restrito aos
status ativos.

Motivo: a restricao antiga nao distinguia reserva viva de reserva morta. Uma
reserva cancelada, expirada, recusada ou com pagamento falho continuava
ocupando a linha (court_id, start_at), entao aquele horario nunca mais podia
ser vendido — `overlapping_bookings` dizia "livre" (ela ignora status
terminais) e o INSERT estourava IntegrityError, virando HTTP 500. O gatilho
mais comum era abandono de checkout: reserva nao paga expira em 15 min e
matava o horario para sempre.

A lista de status aqui e literal (congelada nesta revisao) e corresponde a
ACTIVE_STATUSES no momento da migracao. O model monta o mesmo WHERE a partir
da constante.

Revision ID: l7f8a9b1c2d3
Revises: k6e7f8a9b1c2
Create Date: 2026-08-17

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "l7f8a9b1c2d3"
down_revision: Union[str, None] = "k6e7f8a9b1c2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_ATIVOS = (
    "status IN ('completed', 'confirmed', 'payment_confirmed', "
    "'pending_payment', 'requested')"
)


def upgrade() -> None:
    op.drop_constraint("uq_booking_slot", "bookings", type_="unique")
    op.create_index(
        "uq_booking_slot_ativo",
        "bookings",
        ["court_id", "start_at"],
        unique=True,
        postgresql_where=sa.text(_ATIVOS),
        sqlite_where=sa.text(_ATIVOS),
    )


def downgrade() -> None:
    # Pode falhar se ja existirem duplicatas com status terminal no mesmo slot
    # — que e exatamente o que esta revisao passa a permitir. Limpar antes de
    # voltar, se for o caso.
    op.drop_index("uq_booking_slot_ativo", table_name="bookings")
    op.create_unique_constraint(
        "uq_booking_slot", "bookings", ["court_id", "start_at"]
    )
