"""Acoes administrativas — Fase 10.

Cada escrita feita pelo admin (pausar/reativar arena, ...) gera uma linha de
auditoria: quem, o que, em qual entidade, com os detalhes e quando. O admin
enxerga a plataforma inteira por design; o registro existe para prestar contas
depois, nunca para guardar dado sensivel.
"""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base
from ._types import JSONVariant

ADMIN_ACTION_ARENA_PAUSE = "arena.pause"
ADMIN_ACTION_ARENA_REACTIVATE = "arena.reactivate"


class AdminAction(Base):
    __tablename__ = "admin_actions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    admin_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), index=True
    )
    action: Mapped[str] = mapped_column(String(40), index=True)
    entity_type: Mapped[str] = mapped_column(String(40))
    entity_id: Mapped[str] = mapped_column(String(40))
    payload: Mapped[dict | None] = mapped_column(JSONVariant)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
