"""Fase 21 — marca de convocacao na pelada

Uma coluna, nullable, sem backfill.

`peladas.chamada_em` registra quando a convocacao de faltantes foi disparada.
Existe para o aviso sair UMA vez por pelada: a tarefa roda em ciclo curto e,
sem marca, reavisaria as mesmas pessoas a cada volta ate a hora do jogo — o
jeito mais rapido de ensinar alguem a desligar as notificacoes do app.

NULL significa "ainda nao convocada", que e o certo para as peladas que ja
existem: as futuras ainda serao avisadas na hora devida, e as passadas nao
entram na consulta porque ela so olha para frente.

Revision ID: o0c2d3e4f5a6
Revises: n9b1c2d3e4f5
Create Date: 2026-08-21
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "o0c2d3e4f5a6"
down_revision: Union[str, None] = "n9b1c2d3e4f5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("peladas", sa.Column("chamada_em", sa.DateTime(timezone=True)))


def downgrade() -> None:
    op.drop_column("peladas", "chamada_em")
