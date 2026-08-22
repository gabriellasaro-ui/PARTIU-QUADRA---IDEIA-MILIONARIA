"""Fase 24: dia FECHADO na grade da quadra.

Ate aqui "nao abrimos domingo" so podia ser dito APAGANDO a linha do domingo —
e `recurring_for_court` trata lista vazia como "usa o opening/closing padrao do
court". Apagar o domingo, portanto, fazia a quadra aparecer ABERTA no horario
padrao: o oposto do que o gerente quis, e ele so descobriria quando alguem
reservasse.

Com a coluna, ausencia e fechamento deixam de ser a mesma coisa:
    linha ausente  -> nao configurado, cai no padrao do court
    closed = True  -> o gerente disse que nao abre

Revision ID: r3f5a6b7c8d9
Revises: q2e4f5a6b7c8
"""
from alembic import op
import sqlalchemy as sa

revision = "r3f5a6b7c8d9"
down_revision = "q2e4f5a6b7c8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # server_default false: toda linha que ja existe representa um dia que
    # ABRE. A migracao nao pode fechar quadra de ninguem.
    op.add_column("court_recurring_availability", sa.Column(
        "closed", sa.Boolean(), nullable=False, server_default=sa.text("false")))


def downgrade() -> None:
    # Voltar atras reintroduz a ambiguidade: os dias marcados como fechados
    # passariam a ser lidos como "abre no horario padrao". Apagar as linhas e
    # o comportamento menos errado — pelo menos volta a "nao configurado", e
    # nao a "aberto sem que ninguem tenha dito isso".
    op.execute("DELETE FROM court_recurring_availability WHERE closed = true")
    op.drop_column("court_recurring_availability", "closed")
