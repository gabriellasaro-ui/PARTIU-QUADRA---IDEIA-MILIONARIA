"""Fase 26: bloqueio de pessoa pela arena, e a logo cabendo no banco.

BLOQUEIO. Encerrar conversa resolve UM atendimento; nao resolve quando o
problema e a pessoa — encerrada uma, a proxima reserva abre outra e a arena
volta ao mesmo lugar sem ferramenta nenhuma.

Por ARENA e nao global: quem foi barrado numa quadra continua jogando nas
outras. Banir da plataforma e decisao de quem a opera, e a arena tem interesse
proprio no assunto.

LOGO. `arenas.logo` era String(500) e o painel envia data URL, que passa de 40
mil caracteres. Em Postgres truncaria ou estouraria; no SQLite passaria calado
ate a producao. Terceira coluna com o mesmo defeito (users.photo e clubs.photo
foram as outras) — vale conferir o tipo antes de guardar imagem em coluna nova.

Revision ID: t5b7c8d9e0f1
Revises: s4a6b7c8d9e0
"""
from alembic import op
import sqlalchemy as sa

revision = "t5b7c8d9e0f1"
down_revision = "s4a6b7c8d9e0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "arena_blocks",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("arena_id", sa.dialects.postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("arenas.id"), nullable=False),
        sa.Column("user_id", sa.dialects.postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id"), nullable=False),
        sa.Column("motivo", sa.String(280)),
        # Quem bloqueou: numa arena com varios gerentes, "a arena bloqueou" nao
        # responde a quem perguntar seis meses depois.
        sa.Column("blocked_by", sa.dialects.postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id")),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.UniqueConstraint("arena_id", "user_id", name="uq_arena_block"),
    )
    op.create_index("ix_arena_blocks_arena_id", "arena_blocks", ["arena_id"])
    op.create_index("ix_arena_blocks_user_id", "arena_blocks", ["user_id"])

    op.alter_column("arenas", "logo", type_=sa.Text(), existing_nullable=True)


def downgrade() -> None:
    # Mesma regra das outras colunas de imagem: cortar pela metade deixaria um
    # src quebrado na tela, entao a descida limpa o que nao couber.
    op.execute("UPDATE arenas SET logo = NULL WHERE length(logo) > 500")
    op.alter_column("arenas", "logo", type_=sa.String(500), existing_nullable=True)
    op.drop_index("ix_arena_blocks_user_id", table_name="arena_blocks")
    op.drop_index("ix_arena_blocks_arena_id", table_name="arena_blocks")
    op.drop_table("arena_blocks")
