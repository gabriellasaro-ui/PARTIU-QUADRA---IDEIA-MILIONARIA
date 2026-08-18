"""Dominio de notificacoes — in-app, WebSocket e push (Fase 7).

Regra de produto: notificacoes de reserva geram linha in-app + `notification.new`
no WS + push via Celery. Notificacoes de mensagem (message.new) sao push + o
`message.new` que o chat ja emite — nao geram linha in-app (badge do chat
cobre isso).

Emissao direta: o mutator chama `notify_booking_event` APOS o commit — a linha
ja esta persistida quando o dispatch enfileira o push, entao `push_logs` pode
referenciar a notification com seguranca.
"""
import logging

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from ..core.celery_app import celery_app
from ..core.ws import publish_user_event
from ..models import (
    NOTIF_BOOKING_APPROVED,
    NOTIF_BOOKING_CANCELLED,
    NOTIF_BOOKING_COMPLETED,
    NOTIF_BOOKING_EXPIRED,
    NOTIF_BOOKING_REJECTED,
    NOTIF_PAYMENT_CONFIRMED,
    Arena,
    Booking,
    Notification,
)
from ..repositories import notifications as repo
from .catalog import _as_local

logger = logging.getLogger(__name__)

_PUSH_TASK = "app.workers.tasks.enviar_notificacao_push"

# Evento -> titulo, quem recebe (player = dono da reserva; owner = dono da arena).
_BOOKING_NOTIFS: dict[str, dict] = {
    NOTIF_PAYMENT_CONFIRMED: {
        "title": "Pagamento confirmado",
        "recipients": ("player", "owner"),
    },
    NOTIF_BOOKING_APPROVED: {
        "title": "Reserva confirmada",
        "recipients": ("player",),
    },
    NOTIF_BOOKING_REJECTED: {
        "title": "Reserva não aceita",
        "recipients": ("player",),
    },
    NOTIF_BOOKING_CANCELLED: {
        "title": "Reserva cancelada",
        "recipients": ("player", "owner"),
    },
    NOTIF_BOOKING_COMPLETED: {
        "title": "Reserva concluída",
        "recipients": ("player",),
    },
    NOTIF_BOOKING_EXPIRED: {
        "title": "Reserva expirada",
        "recipients": ("player",),
    },
}

_BOOKING_BODIES: dict[str, str] = {
    NOTIF_PAYMENT_CONFIRMED: "Sua reserva {code} em {arena} foi paga e enviada à arena.",
    NOTIF_BOOKING_APPROVED: "Sua reserva {code} em {arena} foi confirmada pela arena.",
    NOTIF_BOOKING_REJECTED: "A arena não aceitou sua reserva {code} em {arena}.",
    NOTIF_BOOKING_CANCELLED: "A reserva {code} em {arena} foi cancelada.",
    NOTIF_BOOKING_COMPLETED: "Sua reserva {code} em {arena} foi concluída. Avalie sua experiência!",
    NOTIF_BOOKING_EXPIRED: "O prazo da reserva {code} em {arena} expirou.",
}


def _notif_dict(n: Notification) -> dict:
    return {
        "id": str(n.id),
        "type": n.type,
        "title": n.title,
        "body": n.body,
        "data": n.data,
        "readAt": _as_local(n.read_at).isoformat() if n.read_at else None,
        "createdAt": _as_local(n.created_at).isoformat() if n.created_at else None,
    }


def list_notifications(db: Session, user, limit: int = 50, offset: int = 0) -> list[dict]:
    return [_notif_dict(n) for n in repo.list_notifications(db, user.id, limit, offset)]


def unread_count(db: Session, user) -> int:
    return repo.unread_count(db, user.id)


def mark_read(db: Session, user, notification_id) -> dict:
    row = repo.mark_read(db, notification_id, user.id)
    if row is None:
        raise HTTPException(status_code=404, detail="Notificação não encontrada")
    db.commit()
    return _notif_dict(row)


def mark_all_read(db: Session, user) -> int:
    count = repo.mark_all_read(db, user.id)
    db.commit()
    return count


# --- Emissao ---------------------------------------------------------------

def notify_user(
    db: Session, user_id, *, type: str, title: str, body: str | None = None,
    data: dict | None = None,
) -> Notification:
    """Cria a linha in-app (sem commit nem dispatch — o chamador decide)."""
    return repo.create_notification(
        db, user_id=user_id, type=type, title=title, body=body, data=data
    )


def dispatch_notification(n: Notification) -> None:
    """Pos-commit: WS `notification.new` + push via Celery (fail-open)."""
    publish_user_event(
        n.user_id, {"type": "notification.new", "notificacao": _notif_dict(n)}
    )
    try:
        celery_app.send_task(
            _PUSH_TASK,
            args=[
                str(n.user_id),
                str(n.id),
                n.type,
                n.title,
                n.body or "",
                n.data or {},
            ],
            ignore_result=True,
            # Sem isso o kombu reconecta com backoff e segura o request do
            # usuario esperando uma fila que pode estar fora.
            retry=False,
        )
    except Exception:  # noqa: BLE001 — fila indisponivel nao derruba o request
        logger.warning("push nao enfileirado (fila indisponivel)", exc_info=True)


def emit_notification(
    db: Session, user_id, *, type: str, title: str, body: str | None = None,
    data: dict | None = None,
) -> Notification:
    """Cria, commita e despacha. So deve ser chamado fora de transacao aberta
    (pos-commit no mutator), para o push enxergar a linha persistida."""
    n = notify_user(db, user_id, type=type, title=title, body=body, data=data)
    db.commit()
    dispatch_notification(n)
    return n


def notify_booking_event(db: Session, booking: Booking, event_type: str) -> None:
    """Hook pos-commit dos mutators de reserva (confirm_payment, approve, ...)."""
    cfg = _BOOKING_NOTIFS.get(event_type)
    if cfg is None:
        logger.warning("evento de notificacao desconhecido: %s", event_type)
        return
    arena = db.get(Arena, booking.arena_id)
    arena_name = arena.name if arena else ""
    recipients: set = set()
    for who in cfg["recipients"]:
        uid = booking.user_id if who == "player" else (arena.owner_id if arena else None)
        if uid:
            recipients.add(uid)
    data = {
        "bookingId": str(booking.id),
        "bookingCode": booking.code,
        "arenaId": str(booking.arena_id),
        "arenaName": arena_name,
        "event": event_type,
    }
    body = _BOOKING_BODIES.get(event_type, "").format(code=booking.code, arena=arena_name)
    for uid in recipients:
        emit_notification(
            db, uid, type=event_type, title=cfg["title"], body=body, data=data
        )


def notify_message_new(
    user_id, *, title: str, body: str, data: dict | None = None
) -> None:
    """Push da mensagem nova — sem linha in-app (o chat tem badge proprio).
    O WS `message.new` ja e emitido pelo dominio de mensagens."""
    try:
        celery_app.send_task(
            _PUSH_TASK,
            args=[str(user_id), None, "message.new", title, body, data or {}],
            ignore_result=True,
        )
    except Exception:  # noqa: BLE001
        logger.warning("push de mensagem nao enfileirado (fila indisponivel)", exc_info=True)
