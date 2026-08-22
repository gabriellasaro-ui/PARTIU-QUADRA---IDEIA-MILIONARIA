"""Fase 25: procura por horario (mapa de calor do painel).

O painel mostra ocupacao media, e ela nao responde a pergunta que o dono faz:
QUANDO a quadra enche. "2% de ocupacao" nao diz se o problema e a terca de
manha ou o domingo inteiro.

A camada de reservas do mapa sai de `bookings`. Esta tabela existe para a
outra: quantas vezes alguem escolheu um horario e nao reservou — a demanda que
a arena esta perdendo. Sem ela, horario vazio e ambiguo: ninguem quer, ou
ninguem conseguiu?

Uma linha por (quadra, dia da semana, hora) com contador, e nao uma linha por
evento: granularidade de evento nao acrescenta nada a um mapa de calor e faria
a tabela crescer sem limite. Sem user_id e sem IP — para "quantas pessoas
querem sabado as 20h" a identidade e irrelevante, e guardar identidade sem
necessidade cria um dever de protege-la que nao precisamos ter.

Revision ID: s4a6b7c8d9e0
Revises: r3f5a6b7c8d9
"""
from alembic import op
import sqlalchemy as sa

revision = "s4a6b7c8d9e0"
down_revision = "r3f5a6b7c8d9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "slot_demand",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("court_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("day_of_week", sa.Integer(), nullable=False),
        sa.Column("hour", sa.Integer(), nullable=False),
        sa.Column("views", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
        # Sem a restricao, duas visitas simultaneas criariam duas linhas para o
        # mesmo slot e o mapa somaria errado.
        sa.UniqueConstraint("court_id", "day_of_week", "hour", name="uq_slot_demand"),
    )
    op.create_index("ix_slot_demand_court_id", "slot_demand", ["court_id"])


def downgrade() -> None:
    op.drop_index("ix_slot_demand_court_id", table_name="slot_demand")
    op.drop_table("slot_demand")
