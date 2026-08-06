"""Acesso a dados de notificacoes e dispositivos (Fase 7)."""
import uuid
from datetime import datetime

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from ..models import Notification, PushLog, UserDevice
from .venues import _uuid


def get_notification(db: Session, notification_id) -> Notification | None:
    notification_id = _uuid(notification_id)
    if notification_id is None:
        return None
    return db.get(Notification, notification_id)


def create_notification(
    db: Session,
    *,
    user_id,
    type: str,
    title: str,
    body: str | None = None,
    data: dict | None = None,
) -> Notification:
    user_id = _uuid(user_id)
    if user_id is None:
        raise ValueError("user_id inválido")
    row = Notification(
        user_id=user_id, type=type, title=title, body=body, data=data
    )
    db.add(row)
    return row


def list_notifications(db: Session, user_id, limit: int = 50, offset: int = 0) -> list:
    user_id = _uuid(user_id)
    if user_id is None:
        return []
    return (
        db.execute(
            select(Notification)
            .where(Notification.user_id == user_id)
            .order_by(Notification.created_at.desc(), Notification.id.desc())
            .limit(limit)
            .offset(offset)
        )
        .scalars()
        .all()
    )


def unread_count(db: Session, user_id) -> int:
    user_id = _uuid(user_id)
    if user_id is None:
        return 0
    return (
        db.execute(
            select(func.count())
            .select_from(Notification)
            .where(Notification.user_id == user_id, Notification.read_at.is_(None))
        ).scalar()
        or 0
    )


def mark_read(db: Session, notification_id, user_id) -> Notification | None:
    """Marca como lida apenas a notificacao do proprio usuario."""
    row = get_notification(db, notification_id)
    if row is None or row.user_id != _uuid(user_id):
        return None
    if row.read_at is None:
        row.read_at = datetime.now()
    return row


def mark_all_read(db: Session, user_id) -> int:
    user_id = _uuid(user_id)
    if user_id is None:
        return 0
    result = db.execute(
        update(Notification)
        .where(Notification.user_id == user_id, Notification.read_at.is_(None))
        .values(read_at=datetime.now())
    )
    return result.rowcount or 0


def list_devices(db: Session, user_id) -> list[UserDevice]:
    user_id = _uuid(user_id)
    if user_id is None:
        return []
    return (
        db.execute(
            select(UserDevice)
            .where(UserDevice.user_id == user_id, UserDevice.is_active.is_(True))
            .order_by(UserDevice.updated_at.desc())
        )
        .scalars()
        .all()
    )


def upsert_device(db: Session, user_id, fcm_token: str, platform: str = "fcm") -> UserDevice:
    """Registra/atualiza o token do dispositivo.

    Um token so pertence a um usuario: se o mesmo token vier de outro
    usuario (relogin em outro aparelho/telefone emprestado), ele e
    transferido para o dono atual.
    """
    user_id = _uuid(user_id)
    if user_id is None:
        raise ValueError("user_id inválido")
    existing = db.execute(
        select(UserDevice).where(UserDevice.fcm_token == fcm_token)
    ).scalar_one_or_none()
    if existing is None:
        row = UserDevice(user_id=user_id, fcm_token=fcm_token, platform=platform)
        db.add(row)
        return row
    if existing.user_id != user_id:
        existing.user_id = user_id
    existing.platform = platform
    existing.is_active = True
    return existing


def add_push_log(
    db: Session,
    *,
    user_id,
    notification_id,
    provider: str,
    status: str,
    error: str | None = None,
) -> PushLog:
    row = PushLog(
        user_id=_uuid(user_id),
        notification_id=_uuid(notification_id) if notification_id else None,
        provider=provider,
        status=status,
        error=error,
    )
    db.add(row)
    return row
