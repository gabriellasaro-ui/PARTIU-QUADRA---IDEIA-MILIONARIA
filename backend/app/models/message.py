"""Mensagens e conversas — Fase 6.

Conversa arena<->jogador ligada a uma reserva paga (kind='arena'). A
autorizacao de existencia vem do dominio: a conversa so existe a partir do
pagamento confirmado do booking. Clubes e jogador<->jogador entram na F9.

Participantes sao 2 (jogador + gerente/admin da arena); o last_read vira o
unread de cada lado. `messages` carrega sender_id e a serializacao deriva o
`from` ('player'/'venue') em relacao ao espectador.
"""
import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base

CONVERSATION_KIND_ARENA = "arena"
CONVERSATION_ACTIVE = "active"
CONVERSATION_ARCHIVED = "archived"
MESSAGE_TYPE_TEXT = "text"


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    kind: Mapped[str] = mapped_column(String(20), default=CONVERSATION_KIND_ARENA)
    arena_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("arenas.id"))
    player_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    booking_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("bookings.id"), unique=True
    )
    status: Mapped[str] = mapped_column(String(20), default=CONVERSATION_ACTIVE)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ConversationParticipant(Base):
    __tablename__ = "conversation_participants"
    __table_args__ = (UniqueConstraint("conversation_id", "user_id"),)

    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True
    )
    last_read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_read_message_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("messages.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), index=True
    )
    sender_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id")
    )
    content: Mapped[str] = mapped_column(Text)
    message_type: Mapped[str] = mapped_column(
        String(20), default=MESSAGE_TYPE_TEXT
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
