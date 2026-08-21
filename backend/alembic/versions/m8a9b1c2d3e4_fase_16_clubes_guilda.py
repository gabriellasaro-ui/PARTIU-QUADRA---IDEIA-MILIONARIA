"""Fase 16 — clube vira guilda: modo de entrada, limite e solicitacoes

Tres adicoes, nenhuma remocao — nada do que ja existe muda de forma.

`clubs.join_mode` e `clubs.max_members` entram COM server_default. Sem ele, o
ALTER quebra nas linhas que ja existem: coluna NOT NULL sem valor padrao nao
tem o que gravar nos clubes ja criados. O padrao "aberto" tambem e a escolha
certa de produto para o acervo antigo — clube que nasceu sem modo de entrada
sempre aceitou todo mundo, e mudar isso na migracao trancaria as portas de
grupos existentes sem ninguem pedir.

`club_join_requests` guarda o pedido de entrada nos clubes em modo
solicitacao. UNIQUE (club_id, user_id) porque pedir de novo tem de reabrir o
mesmo registro, e nao empilhar duplicatas na fila da gestao.

O cargo `admin` nao aparece aqui: `club_members.role` ja e String(10) e
"admin" cabe. Migracao de dados tambem nao ha — quem e dono continua dono, e
ninguem vira admin sem alguem promover.

Revision ID: m8a9b1c2d3e4
Revises: l7f8a9b1c2d3
Create Date: 2026-08-21
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "m8a9b1c2d3e4"
down_revision: Union[str, None] = "l7f8a9b1c2d3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "clubs",
        sa.Column(
            "join_mode",
            sa.String(length=12),
            nullable=False,
            server_default="aberto",
        ),
    )
    op.add_column(
        "clubs",
        sa.Column(
            "max_members",
            sa.Integer(),
            nullable=False,
            server_default="30",
        ),
    )

    op.create_table(
        "club_join_requests",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "club_id",
            UUID(as_uuid=True),
            sa.ForeignKey("clubs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column("status", sa.String(length=10), nullable=False, server_default="pendente"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("decided_at", sa.DateTime(timezone=True)),
        sa.Column("decided_by", UUID(as_uuid=True), sa.ForeignKey("users.id")),
        sa.UniqueConstraint("club_id", "user_id", name="uq_club_join_request"),
    )
    op.create_index("ix_club_join_requests_club_id", "club_join_requests", ["club_id"])
    op.create_index("ix_club_join_requests_user_id", "club_join_requests", ["user_id"])
    op.create_index("ix_club_join_requests_status", "club_join_requests", ["status"])


def downgrade() -> None:
    op.drop_index("ix_club_join_requests_status", table_name="club_join_requests")
    op.drop_index("ix_club_join_requests_user_id", table_name="club_join_requests")
    op.drop_index("ix_club_join_requests_club_id", table_name="club_join_requests")
    op.drop_table("club_join_requests")
    op.drop_column("clubs", "max_members")
    op.drop_column("clubs", "join_mode")
