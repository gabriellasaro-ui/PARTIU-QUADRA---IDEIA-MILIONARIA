"""Clubes, membros e mural — Fase 9.

Um clube e o grupo que organiza a pelada recorrente — a guilda que faz a
pelada nao ficar vazia. Regras de produto:
- a pessoa participa de VARIOS clubes, ate um teto (Fase 16). Antes era um so,
  e quem jogava com dois grupos precisava sair de um para entrar no outro, o
  que esvaziava os dois;
- tres modos de entrada: aberto, solicitacao e privado;
- tres cargos: dono, admin e membro. Sem o cargo do meio, o dono vira gargalo:
  se ele some, ninguem mais entra no clube nem organiza pelada;
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
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base

CLUB_ROLE_DONO = "dono"
CLUB_ROLE_ADMIN = "admin"
CLUB_ROLE_MEMBRO = "membro"

#: Quem pode aprovar entrada, convidar, remover membro e mexer na configuracao.
#: O dono faz tudo isto e mais: apagar o clube e promover/rebaixar admin.
CLUB_ROLES_GESTAO = (CLUB_ROLE_DONO, CLUB_ROLE_ADMIN)

#: Modos de entrada.
#:   aberto      — entra na hora, sem pedir a ninguem
#:   solicitacao — pede, e a gestao aprova
#:   privado     — so com o codigo de convite; NAO aparece em busca nenhuma
CLUB_JOIN_ABERTO = "aberto"
CLUB_JOIN_SOLICITACAO = "solicitacao"
CLUB_JOIN_PRIVADO = "privado"
CLUB_JOIN_MODES = (CLUB_JOIN_ABERTO, CLUB_JOIN_SOLICITACAO, CLUB_JOIN_PRIVADO)

#: Estado de uma solicitacao de entrada.
JOIN_PENDENTE = "pendente"
JOIN_APROVADA = "aprovada"
JOIN_RECUSADA = "recusada"

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
    #: server_default porque a coluna entrou depois: sem ele, o NOT NULL
    #: estoura nas linhas que ja existem no banco.
    join_mode: Mapped[str] = mapped_column(
        String(12), default=CLUB_JOIN_ABERTO, server_default=CLUB_JOIN_ABERTO
    )
    max_members: Mapped[int] = mapped_column(
        Integer, default=30, server_default="30"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ClubJoinRequest(Base):
    """Pedido de entrada num clube em modo `solicitacao`.

    UNIQUE (club_id, user_id): um pedido por pessoa por clube. Pedir de novo
    reabre o mesmo registro em vez de empilhar uma fila de duplicatas para a
    gestao peneirar.
    """

    __tablename__ = "club_join_requests"
    __table_args__ = (UniqueConstraint("club_id", "user_id"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    club_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clubs.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), index=True
    )
    status: Mapped[str] = mapped_column(String(10), default=JOIN_PENDENTE, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    decided_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id")
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
