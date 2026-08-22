"""Fase 22: foto de perfil e escudo do clube em TEXT.

`users.photo` e `clubs.photo` eram String(500). O app envia a imagem como
data URL (ja reduzida a 512px JPEG), que passa de 40 mil caracteres — nao
cabe. No SQLite isso passaria calado, porque ele nao aplica o limite de
VARCHAR; no Postgres seria erro em producao, na primeira foto enviada.

Revision ID: p1d3e4f5a6b7
Revises: o0c2d3e4f5a6
"""
from alembic import op
import sqlalchemy as sa

revision = "p1d3e4f5a6b7"
down_revision = "o0c2d3e4f5a6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("users", "photo", type_=sa.Text(), existing_nullable=True)
    op.alter_column("clubs", "photo", type_=sa.Text(), existing_nullable=True)


def downgrade() -> None:
    # Volta a caber so o que tem ate 500 caracteres; qualquer foto enviada
    # pelo app seria truncada, entao a descida limpa o campo em vez de cortar
    # a imagem pela metade e deixar um src quebrado na tela.
    op.execute("UPDATE users SET photo = NULL WHERE length(photo) > 500")
    op.execute("UPDATE clubs SET photo = NULL WHERE length(photo) > 500")
    op.alter_column("users", "photo", type_=sa.String(500), existing_nullable=True)
    op.alter_column("clubs", "photo", type_=sa.String(500), existing_nullable=True)
