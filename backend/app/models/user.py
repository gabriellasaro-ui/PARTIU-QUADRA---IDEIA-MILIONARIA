"""Usuario e identidade — modelo inicial da Fase 1.

Expandido na Fase 2 (auth) com sessoes, devices e preferencias.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, Date, DateTime, Float, Integer, String, Text, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base

ROLE_JOGADOR = "jogador"
ROLE_GERENTE = "gerente"
ROLE_ADMIN = "admin"

PROVIDER_PASSWORD = "password"
PROVIDER_GOOGLE = "google"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str | None] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(
        String(20), default=ROLE_JOGADOR, server_default=ROLE_JOGADOR
    )
    provider: Mapped[str] = mapped_column(
        String(20), default=PROVIDER_PASSWORD, server_default=PROVIDER_PASSWORD
    )
    phone: Mapped[str | None] = mapped_column(String(20))
    #: Data URL da imagem enviada pelo app (o front ja reduz para 512px
    #: JPEG). Nao cabe em String(500) — em Postgres isso truncaria ou
    #: estouraria; no SQLite passaria calado ate a producao.
    photo: Mapped[str | None] = mapped_column(Text)
    city: Mapped[str | None] = mapped_column(String(120))
    state: Mapped[str | None] = mapped_column(String(2))
    position: Mapped[str | None] = mapped_column(String(40))
    level: Mapped[str | None] = mapped_column(String(40))
    birth_date: Mapped[datetime | None] = mapped_column(Date)
    foot: Mapped[str | None] = mapped_column(String(10))
    favorite_sport: Mapped[str | None] = mapped_column(String(60))

    # --- Preferencias (tela de Configuracoes) -----------------------------
    #
    # A tela existia desde o inicio como `data-demo-form`: dizia "Configuracoes
    # salvas" e nao gravava nada. Trocar o esporte padrao, desligar um aviso ou
    # mudar a distancia nao sobrevivia a fechar o app.
    #
    # Sao colunas e nao um JSON solto porque cada uma tem consumidor proprio:
    # as tres de notificacao decidem se o push sai (o worker le), e as duas de
    # busca alimentam a Home e o mapa. Num blob, filtrar "quem aceita lembrete"
    # viraria varredura na tabela inteira.
    notify_booking: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("1")
    )
    notify_reminder: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("1")
    )
    notify_club: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("1")
    )
    #: Distancia padrao da busca, em km.
    search_radius: Mapped[int] = mapped_column(
        Integer, default=10, server_default=text("10")
    )
    rating: Mapped[float | None] = mapped_column(Float)
    onboarded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_active_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
