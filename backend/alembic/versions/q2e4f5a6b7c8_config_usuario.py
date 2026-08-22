"""Fase 23: preferencias de notificacao e busca.

A tela de Configuracoes era `data-demo-form` — dizia "Configuracoes salvas" e
nao gravava nada. Estas colunas dao onde gravar, e `quer_receber()` as consulta
antes de despachar push: sem isso o interruptor mudaria um booleano e o aviso
continuaria chegando.

Colunas separadas, e nao um JSON: as tres de notificacao sao lidas pelo
despacho (que precisa filtrar "quem aceita lembrete" sem varrer a tabela) e as
de busca alimentam Home e mapa.

Revision ID: q2e4f5a6b7c8
Revises: p1d3e4f5a6b7
"""
from alembic import op
import sqlalchemy as sa

revision = "q2e4f5a6b7c8"
down_revision = "p1d3e4f5a6b7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # server_default obrigatorio: sem ele o NOT NULL estoura nas linhas que ja
    # existem. Todo mundo comeca com os avisos LIGADOS, que e como o app
    # sempre se comportou — a migracao nao pode silenciar ninguem.
    op.add_column("users", sa.Column(
        "notify_booking", sa.Boolean(), nullable=False, server_default=sa.text("true")))
    op.add_column("users", sa.Column(
        "notify_reminder", sa.Boolean(), nullable=False, server_default=sa.text("true")))
    op.add_column("users", sa.Column(
        "notify_club", sa.Boolean(), nullable=False, server_default=sa.text("true")))
    op.add_column("users", sa.Column(
        "search_radius", sa.Integer(), nullable=False, server_default=sa.text("10")))


def downgrade() -> None:
    op.drop_column("users", "search_radius")
    op.drop_column("users", "notify_club")
    op.drop_column("users", "notify_reminder")
    op.drop_column("users", "notify_booking")
