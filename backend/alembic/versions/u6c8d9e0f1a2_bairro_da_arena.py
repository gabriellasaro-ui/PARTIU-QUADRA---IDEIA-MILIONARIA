"""Fase 27: bairro da arena.

`arenas` guardava address (texto livre), city e state — e nao bairro. Mas
bairro e justamente o recorte que a pessoa usa: ninguem diz "quero jogar em
Belo Horizonte", diz "quero jogar no Savassi". Sem coluna propria, o bairro
caia dentro de `address` como texto solto e nao dava para filtrar, agrupar nem
exibir separado no cartao da quadra.

NULLABLE de proposito. As arenas ja cadastradas nao tem o dado, e inventar um
valor padrao ("Centro") seria pior do que o vazio: mandaria gente para o bairro
errado. O painel pede o campo no proximo salvamento do perfil.

Revision ID: u6c8d9e0f1a2
Revises: t5b7c8d9e0f1
"""
from alembic import op
import sqlalchemy as sa

revision = "u6c8d9e0f1a2"
down_revision = "t5b7c8d9e0f1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("arenas", sa.Column("neighborhood", sa.String(length=120), nullable=True))
    op.create_index("ix_arenas_neighborhood", "arenas", ["neighborhood"])


def downgrade() -> None:
    op.drop_index("ix_arenas_neighborhood", table_name="arenas")
    op.drop_column("arenas", "neighborhood")
