"""Notificacoes, dispositivos e push — Fase 7.

Tres tabelas:
- notifications: linha in-app (badge / central de notificacoes). read_at
  marcado pelo proprio usuario via API.
- user_devices: tokens de push do usuario (FCM). O token e trocado via
  upsert a cada login/abertura do app — o push sempre usa o token atual.
- push_logs: auditoria de entrega push (provider, status ok/errored). O
  provider mock grava aqui sem enviar rede; o FCM real grava o resultado.

Notificacoes de mensagem (message.new) NAO geram linha in-app — so push
+ WebSocket, pois o chat ja tem badge de nao-lidos.
"""
import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base
from ._types import JSONVariant

# Tipos de notificacao (eventos que geram linha in-app + push/WS)
NOTIF_PAYMENT_CONFIRMED = "payment.confirmed"
NOTIF_BOOKING_APPROVED = "booking.approved"
NOTIF_BOOKING_REJECTED = "booking.rejected"
NOTIF_BOOKING_CANCELLED = "booking.cancelled"
NOTIF_BOOKING_COMPLETED = "booking.completed"
NOTIF_BOOKING_EXPIRED = "booking.expired"

# Push da mensagem: NAO vira linha in-app
NOTIF_MESSAGE_NEW = "message.new"

# Fase 9 — clubes/peladas/partidas
NOTIF_CLUBE_ENTROU = "clube.entrou"
#: Alguem pediu para entrar num clube em modo solicitacao — vai para a gestao.
NOTIF_CLUBE_SOLICITACAO = "clube.solicitacao"
#: A gestao decidiu — vai para quem pediu.
NOTIF_CLUBE_APROVADO = "clube.aprovado"
NOTIF_CLUBE_RECUSADO = "clube.recusado"
#: Promovido a admin ou rebaixado a membro.
NOTIF_CLUBE_CARGO = "clube.cargo"
NOTIF_PELADA_CRIADA = "pelada.criada"
NOTIF_PELADA_PRESENCA = "pelada.presenca"
#: Falta gente e a pelada e amanha — vai so para quem ainda nao respondeu.
NOTIF_PELADA_FALTAM = "pelada.faltam"
NOTIF_PARTIDA_PRESENCA = "partida.presenca"
NOTIF_PARTIDA_ATRASO = "partida.atraso"
NOTIF_PARTIDA_ENCERRADA = "partida.encerrada"

PUSH_STATUS_OK = "ok"
PUSH_STATUS_ERRORED = "errored"


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notifications_user_id_read_at", "user_id", "read_at"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), index=True
    )
    type: Mapped[str] = mapped_column(String(30), index=True)
    title: Mapped[str] = mapped_column(String(160))
    body: Mapped[str | None] = mapped_column(Text)
    data: Mapped[dict | None] = mapped_column(JSONVariant)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )


class UserDevice(Base):
    __tablename__ = "user_devices"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), index=True
    )
    fcm_token: Mapped[str] = mapped_column(String(255), unique=True)
    platform: Mapped[str] = mapped_column(String(20), default="fcm")  # fcm | apns
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class PushLog(Base):
    __tablename__ = "push_logs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), index=True
    )
    notification_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("notifications.id"), index=True
    )
    provider: Mapped[str] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(10), default=PUSH_STATUS_OK)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
