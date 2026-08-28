"""Entrada de arena: solicitacao, triagem e verificacao de contato.

Ate aqui nao existia porta para uma arena nova: `auth/register` cravava
role=jogador e a unica construcao de `Arena(...)` no projeto estava no seed.
Esta migracao cria o terreno das tres pecas que faltavam.

`arena_applications` — a ficha que a Qadras analisa. Tabela separada de
`arenas` de proposito: o que o dono DECLARA (CNPJ, faturamento, a dor dele) nao
e o que a plataforma PUBLICA, e colunas nessas duas juntas viajariam em todo
`to_venue` ate um dia sairem numa resposta publica.

`verification_codes` — codigo de contato, com HASH. E credencial de curta vida:
quem ler o banco nao pode sair entrando nas contas.

`arenas.status` — triagem, que NAO e `is_active`. `is_active` e pausa
operacional (fechou para reforma); `status` diz se a Qadras aceitou a arena.
Arena aprovada e pausada existe; arena nunca aprovada nao pode aparecer para
jogador nenhum.

⚠️ `server_default='aprovada'` NAO e enfeite. As arenas que ja existem entraram
antes de haver triagem — sem o default elas nasceriam com status vazio e
sumiriam do app inteiro na primeira migracao.

Revision ID: v7d9e0f1a2b3
Revises: u6c8d9e0f1a2
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "v7d9e0f1a2b3"
down_revision = "u6c8d9e0f1a2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- arenas: triagem separada da pausa operacional ---------------------
    op.add_column(
        "arenas",
        sa.Column(
            "status",
            sa.String(length=20),
            nullable=False,
            server_default="aprovada",
        ),
    )
    op.create_index("ix_arenas_status", "arenas", ["status"])

    # --- users: quando o contato foi verificado ----------------------------
    # Data, e nao booleano: permite reexigir a verificacao depois (troca de
    # e-mail, politica nova) e responde "desde quando" numa disputa.
    op.add_column("users", sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("phone_verified_at", sa.DateTime(timezone=True), nullable=True))

    # --- a ficha -----------------------------------------------------------
    op.create_table(
        "arena_applications",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        # unique: uma pessoa toca um cadastro por vez, senao "retomar de onde
        # parou" nao saberia qual retomar.
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False, unique=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="rascunho"),
        sa.Column("step", sa.Integer(), nullable=False, server_default="1"),

        sa.Column("arena_name", sa.String(length=140)),
        sa.Column("legal_name", sa.String(length=180)),
        # So digitos: com mascara o mesmo CNPJ entra de duas formas e a
        # checagem de duplicado para de funcionar.
        sa.Column("cnpj", sa.String(length=14)),
        sa.Column("cnpj_cnae", sa.String(length=120)),
        sa.Column("cnpj_situacao", sa.String(length=40)),

        sa.Column("contact_name", sa.String(length=120)),
        sa.Column("contact_email", sa.String(length=255)),
        sa.Column("contact_phone", sa.String(length=20)),

        sa.Column("cep", sa.String(length=8)),
        sa.Column("address", sa.String(length=255)),
        sa.Column("number", sa.String(length=20)),
        sa.Column("complement", sa.String(length=120)),
        sa.Column("neighborhood", sa.String(length=120)),
        sa.Column("city", sa.String(length=120)),
        sa.Column("state", sa.String(length=2)),
        sa.Column("lat", sa.Float()),
        sa.Column("lng", sa.Float()),

        sa.Column("court_count", sa.Integer()),
        sa.Column("sports", sa.JSON()),
        sa.Column("opening_hours_note", sa.Text()),
        sa.Column("pains", sa.JSON()),
        sa.Column("revenue_range", sa.String(length=40)),
        # JSON e nao String: sao data URLs de base64, que nao cabem em
        # String(500) — mesmo defeito ja corrigido na logo da arena.
        sa.Column("photos", sa.JSON()),

        # Data + a taxa VIGENTE no aceite. A taxa vem da config e vai mudar;
        # sem o retrato ninguem consegue dizer com quanto a pessoa concordou.
        sa.Column("fee_accepted_at", sa.DateTime(timezone=True)),
        sa.Column("fee_rate_snapshot", sa.Float()),
        sa.Column("terms_accepted_at", sa.DateTime(timezone=True)),
        sa.Column("terms_version", sa.String(length=20)),

        sa.Column("submitted_at", sa.DateTime(timezone=True)),
        sa.Column("reviewed_at", sa.DateTime(timezone=True)),
        sa.Column("reviewed_by", UUID(as_uuid=True)),
        sa.Column("reject_reason", sa.Text()),
        sa.Column("arena_id", UUID(as_uuid=True)),

        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_arena_applications_status", "arena_applications", ["status"])
    op.create_index("ix_arena_applications_cnpj", "arena_applications", ["cnpj"])
    op.create_index("ix_arena_applications_arena_id", "arena_applications", ["arena_id"])

    # --- codigos de verificacao --------------------------------------------
    op.create_table(
        "verification_codes",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("channel", sa.String(length=20), nullable=False, server_default="email"),
        # Guardado porque a pessoa pode TROCAR o e-mail no meio do cadastro:
        # sem isto, um codigo enviado ao endereco antigo validaria o novo.
        sa.Column("destination", sa.String(length=255), nullable=False),
        sa.Column("code_hash", sa.String(length=255), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("consumed_at", sa.DateTime(timezone=True)),
        sa.Column("sent_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_verification_codes_user_id", "verification_codes", ["user_id"])
    # A busca e sempre "o codigo vivo desta pessoa neste canal".
    op.create_index("ix_verif_user_canal", "verification_codes", ["user_id", "channel"])


def downgrade() -> None:
    op.drop_index("ix_verif_user_canal", table_name="verification_codes")
    op.drop_index("ix_verification_codes_user_id", table_name="verification_codes")
    op.drop_table("verification_codes")

    op.drop_index("ix_arena_applications_arena_id", table_name="arena_applications")
    op.drop_index("ix_arena_applications_cnpj", table_name="arena_applications")
    op.drop_index("ix_arena_applications_status", table_name="arena_applications")
    op.drop_table("arena_applications")

    op.drop_column("users", "phone_verified_at")
    op.drop_column("users", "email_verified_at")
    op.drop_index("ix_arenas_status", table_name="arenas")
    op.drop_column("arenas", "status")
