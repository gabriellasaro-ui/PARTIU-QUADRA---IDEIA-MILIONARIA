"""Acesso a dados de mensagens (Fase 6)."""
import uuid

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from ..models import (
    STATUS_REQUESTED,
    Arena,
    Booking,
    Conversation,
    ConversationParticipant,
    Court,
    Message,
)
from .venues import _uuid


def get_conversation(db: Session, conversation_id) -> Conversation | None:
    conversation_id = _uuid(conversation_id)
    if conversation_id is None:
        return None
    return db.get(Conversation, conversation_id)


def get_by_booking(db: Session, booking_id) -> Conversation | None:
    booking_id = _uuid(booking_id)
    if booking_id is None:
        return None
    return db.execute(
        select(Conversation).where(Conversation.booking_id == booking_id)
    ).scalar_one_or_none()


def _conversation_rows(db: Session, where) -> list:
    return db.execute(
        # O CONTEXTO DA RESERVA vem junto, e nao por consulta extra depois.
        #
        # A conversa da arena existe por causa de UM jogo, e a pergunta que
        # chega e sempre sobre ele ("posso chegar 15 min atrasado?"). Sem
        # quadra, dia e hora ao lado, o dono tinha de abrir Reservas e procurar
        # o codigo para responder. Carregar aqui evita um N+1 no `_to_conv`,
        # que roda uma vez por conversa da lista.
        select(
            Conversation, Arena.name, Booking.court_id, Booking.code,
            Booking.start_at, Booking.end_at, Booking.status,
            Booking.subtotal_cents, Court.name,
        )
        .join(Arena, Arena.id == Conversation.arena_id)
        .join(Booking, Booking.id == Conversation.booking_id)
        .join(Court, Court.id == Booking.court_id)
        .where(where)
        .order_by(Conversation.updated_at.desc())
    ).all()


def list_for_player(db: Session, user_id) -> list:
    user_id = _uuid(user_id)
    if user_id is None:
        return []
    return _conversation_rows(db, Conversation.player_id == user_id)


def list_all(db: Session) -> list:
    return _conversation_rows(db, True)


def list_for_manager(db: Session, arena_ids: list) -> list:
    arena_ids = [a for a in (a.id if isinstance(a, Arena) else a for a in arena_ids) if a]
    if not arena_ids:
        return []
    return _conversation_rows(db, Conversation.arena_id.in_(arena_ids))


def list_messages(db: Session, conversation_id) -> list[Message]:
    conversation_id = _uuid(conversation_id)
    if conversation_id is None:
        return []
    return db.execute(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at, Message.id)
    ).scalars().all()


def get_participant(db: Session, conversation_id, user_id) -> ConversationParticipant | None:
    return db.get(ConversationParticipant, (conversation_id, user_id))


def count_newer_messages(db: Session, conversation_id, user_id) -> int:
    """Mensagens apos o ultimo read do participante (todas, se nunca leu)."""
    user_id = _uuid(user_id)
    if user_id is None:
        return 0
    participant = db.get(ConversationParticipant, (conversation_id, user_id))
    if participant is None:
        return 0
    q = select(func.count()).select_from(Message).where(
        Message.conversation_id == conversation_id
    )
    if participant.last_read_at is not None:
        q = q.where(Message.created_at > participant.last_read_at)
    return db.execute(q).scalar() or 0


def last_message(db: Session, conversation_id) -> Message | None:
    conversation_id = _uuid(conversation_id)
    if conversation_id is None:
        return None
    return db.execute(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.desc(), Message.id.desc())
    ).scalars().first()


def add_participant(
    db: Session, conversation_id, user_id, last_read_at=None
) -> ConversationParticipant:
    p = ConversationParticipant(
        conversation_id=conversation_id, user_id=user_id, last_read_at=last_read_at
    )
    db.add(p)
    return p


def unread_conversation_count(db: Session, user_id) -> int:
    """Conversas do usuario com mensagem apos o ultimo read (ou nunca lidas)."""
    user_id = _uuid(user_id)
    if user_id is None:
        return 0
    P = ConversationParticipant
    M = Message
    any_msg = (
        select(func.count())
        .select_from(M)
        .where(M.conversation_id == Conversation.id)
        .correlate(Conversation)
        .scalar_subquery()
    )
    newer = (
        select(func.count())
        .select_from(M)
        .where(M.conversation_id == Conversation.id, M.created_at > P.last_read_at)
        .correlate(Conversation, P)
        .scalar_subquery()
    )
    q = (
        select(func.count(Conversation.id))
        .join(P, and_(P.conversation_id == Conversation.id, P.user_id == user_id))
        .where(
            or_(
                P.last_read_at.is_(None) & (any_msg > 0),
                P.last_read_at.isnot(None) & (newer > 0),
            )
        )
    )
    return db.execute(q).scalar() or 0


def requested_count(db: Session, arena_ids: list) -> int:
    arena_ids = [a for a in arena_ids if a]
    if not arena_ids:
        return 0
    return (
        db.execute(
            select(func.count())
            .select_from(Booking)
            .where(Booking.arena_id.in_(arena_ids), Booking.status == STATUS_REQUESTED)
        ).scalar()
        or 0
    )
