"""Fase 18 — ate onde cada pessoa leu o mural do clube

Uma tabela nova, nada alterado.

`club_messages` nasceu como mural chapado: sem participantes e sem controle de
leitura. Sem saber o que ja foi lido nao ha badge nem aviso — "mensagem nova"
e uma comparacao, e faltava o outro lado dela.

Tabela separada, e nao uma coluna em `club_members`: leitura muda toda vez que
a tela abre, cargo e data de entrada quase nunca mudam. Misturar faria cada
leitura reescrever a linha de membro.

Sem backfill: quem nunca abriu o mural conta como nunca tendo lido, e a
contagem se resolve pela data de entrada no clube (ver unread_by_club) — quem
entrou ontem nao herda o historico de tres anos.

Revision ID: n9b1c2d3e4f5
Revises: m8a9b1c2d3e4
Create Date: 2026-08-21
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "n9b1c2d3e4f5"
down_revision: Union[str, None] = "m8a9b1c2d3e4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "club_message_reads",
        sa.Column(
            "club_id",
            UUID(as_uuid=True),
            sa.ForeignKey("clubs.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            primary_key=True,
        ),
        sa.Column(
            "last_read_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("last_read_message_id", UUID(as_uuid=True)),
    )


def downgrade() -> None:
    op.drop_table("club_message_reads")
