"""Usuario e identidade — modelo inicial da Fase 1.

Expandido na Fase 2 (auth) com sessoes, devices e preferencias.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import Date, DateTime, Float, String, func
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
    photo: Mapped[str | None] = mapped_column(String(500))
    city: Mapped[str | None] = mapped_column(String(120))
    state: Mapped[str | None] = mapped_column(String(2))
    position: Mapped[str | None] = mapped_column(String(40))
    level: Mapped[str | None] = mapped_column(String(40))
    birth_date: Mapped[datetime | None] = mapped_column(Date)
    foot: Mapped[str | None] = mapped_column(String(10))
    favorite_sport: Mapped[str | None] = mapped_column(String(60))
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
