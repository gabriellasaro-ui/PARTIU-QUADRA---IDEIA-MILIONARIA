"""Split de pagamentos 1:1 — conexao OAuth da arena com o Mercado Pago.

Ate aqui a cobranca saia de UM token global da Qadras: o dinheiro caia na
conta da Qadras e o repasse a arena era problema de outro processo. No split
1:1 cada arena conecta a propria conta, a cobranca sai com o token DELA e a
Qadras retem so a comissao (`application_fee`) na mesma transacao.

Esta tabela guarda essa autorizacao. Uma linha por arena (UNIQUE): reconectar
sobrescreve, porque com duas linhas a cobranca teria de escolher entre dois
tokens — e escolheria errado em algum momento.

`expires_at` e indexado de proposito: o token do MP vale 180 dias e uma task
diaria pergunta "quem vence nos proximos N dias?". Sem indice isso e um full
scan por dia, para sempre.

Revision ID: x9f1a2b3c4d5
Revises: w8e0f1a2b3c4
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from app.models._types import JSONVariant

revision = "x9f1a2b3c4d5"
down_revision = "w8e0f1a2b3c4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mercadopago_connections",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("arena_id", UUID(as_uuid=True), nullable=False),
        # Text, e nao String(n): o MP nao documenta tamanho maximo de token, e
        # um token truncado so se revela como 401 na primeira cobranca real.
        sa.Column("access_token", sa.Text(), nullable=False),
        sa.Column("refresh_token", sa.Text()),
        sa.Column("mp_user_id", sa.String(length=60)),
        sa.Column("public_key", sa.Text()),
        sa.Column("token_type", sa.String(length=40)),
        sa.Column("scope", sa.String(length=120)),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
        sa.Column("fee_rate", sa.Float()),
        sa.Column("payment_methods", JSONVariant),
        sa.Column("connected_by", UUID(as_uuid=True)),
        sa.Column("connected_at", sa.DateTime(timezone=True)),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(["arena_id"], ["arenas.id"]),
        sa.ForeignKeyConstraint(["connected_by"], ["users.id"]),
        sa.UniqueConstraint("arena_id", name="uq_mercadopago_connections_arena"),
    )
    op.create_index(
        "ix_mercadopago_connections_arena_id", "mercadopago_connections", ["arena_id"]
    )
    op.create_index(
        "ix_mercadopago_connections_mp_user_id",
        "mercadopago_connections",
        ["mp_user_id"],
    )
    # O indice que sustenta a task de renovacao diaria.
    op.create_index(
        "ix_mercadopago_connections_expires_at",
        "mercadopago_connections",
        ["expires_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_mercadopago_connections_expires_at", table_name="mercadopago_connections"
    )
    op.drop_index(
        "ix_mercadopago_connections_mp_user_id", table_name="mercadopago_connections"
    )
    op.drop_index(
        "ix_mercadopago_connections_arena_id", table_name="mercadopago_connections"
    )
    op.drop_table("mercadopago_connections")
