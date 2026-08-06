"""Arena — unidade de negocio dona das quadras.

Uma arena pode ter varias quadras (courts) de esportes diferentes. A busca
publica de quadras flata arena + court no contrato do app (um item por court).
"""
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base
from ._types import JSONVariant


class Arena(Base):
    __tablename__ = "arenas"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    owner_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), index=True
    )
    name: Mapped[str] = mapped_column(String(140), index=True)
    description: Mapped[str | None] = mapped_column(Text)
    logo: Mapped[str | None] = mapped_column(String(500))
    phone: Mapped[str | None] = mapped_column(String(20))
    email: Mapped[str | None] = mapped_column(String(255))
    pix_key: Mapped[str | None] = mapped_column(String(200))

    address: Mapped[str | None] = mapped_column(String(255))
    city: Mapped[str | None] = mapped_column(String(120), index=True)
    state: Mapped[str | None] = mapped_column(String(2))
    lat: Mapped[float | None] = mapped_column(Float)
    lng: Mapped[float | None] = mapped_column(Float)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    boosted_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    settings: Mapped[dict | None] = mapped_column(JSONVariant)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
