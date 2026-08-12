"""Clubes, membros e mural — Fase 9.

Um clube e o grupo que organiza a pelada recorrente. Regras de produto do
frontend (venues.js / mobile.js):
- um usuario so participa de UM clube;
- o membro nasce do perfil (position/rating), nao de valor digitado a mao;
- sair sendo o ultimo apaga o clube; apagar so o dono e com clube vazio;
- o codigo de convite tem 6 caracteres do alfabeto que exclui I/L/O/0/1
  (pares que confundem falados), guardado SEM hifen — o hifen e formatacao
  de exibicao.

`club_messages` e o mural onde a pelada e combinada: o contrato do frontend
(clubId, memberId, name, text, time). Conversa jogador<->jogador fica para
depois — o SPA nao tem tela para ela hoje.
"""
import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base

CLUB_ROLE_DONO = "dono"
CLUB_ROLE_MEMBRO = "membro"

# Alfabeto do codigo de convite: 31^6 ~ 887 milhoes de combinacoes.
CLUB_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
CLUB_CODE_LENGTH = 6


class Club(Base):
    __tablename__ = "clubs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(60))
    code: Mapped[str] = mapped_column(String(6), unique=True, index=True)
    sport: Mapped[str] = mapped_column(String(60))
    city: Mapped[str] = mapped_column(String(60))
    state: Mapped[str | None] = mapped_column(String(2))
    description: Mapped[str | None] = mapped_column(Text)
    photo: Mapped[str | None] = mapped_column(String(500))
    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ClubMember(Base):
    __tablename__ = "club_members"
    __table_args__ = (UniqueConstraint("club_id", "user_id"),)

    club_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clubs.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True
    )
    role: Mapped[str] = mapped_column(String(10), default=CLUB_ROLE_MEMBRO)
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class ClubMessage(Base):
    __tablename__ = "club_messages"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    club_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clubs.id", ondelete="CASCADE"), index=True
    )
    member_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id")
    )
    name: Mapped[str] = mapped_column(String(120))
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
