"""Dominio de mensagens — conversas arena<->jogador (Fase 6).

A conversa nasce no pagamento confirmado (`ensure_conversation_for_booking`,
chamado por `confirm_payment`) e so existe ligada a reserva paga. A
autorizacao e por token: participante e o jogador dono da reserva ou o
gerente/admin dono da arena — `role`/`de` vindos do cliente sao ignorados.

Serializacao no shape do SPA (mobile.js `renderMessages`): {id, venueId,
venue, subject, messages:[{from:'player'|'venue', text, time}], unread}.
`from` e relativo ao espectador (quem escreveu = 'player'). O `de` livre do
legado nao existe mais no contrato.
"""
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..core.timezone import utc_now
from ..core.ws import publish_user_event
from ..models import (
    ROLE_ADMIN,
    ROLE_GERENTE,
    ROLE_JOGADOR,
    CONVERSATION_ACTIVE,
    CONVERSATION_ARCHIVED,
    CONVERSATION_KIND_ARENA,
    MESSAGE_TYPE_TEXT,
    Arena,
    ArenaBlock,
    Booking,
    Conversation,
    Message,
    User,
)
from ..repositories import messages as repo
from .catalog import _as_local
from .notifications import notify_message_new

MAX_TEXT = 500


def _utc_naive() -> datetime:
    return utc_now().replace(tzinfo=None)


def _conv_404() -> HTTPException:
    return HTTPException(status_code=404, detail="Conversa nao encontrada")


def _manager_arena_ids(db: Session, user) -> list:
    return db.execute(
        select(Arena.id).where(Arena.owner_id == user.id)
    ).scalars().all()


def _can_access(db: Session, user, conv: Conversation, arena: Arena) -> None:
    if user.role == ROLE_ADMIN:
        return
    if conv.player_id == user.id:
        return
    if user.role == ROLE_GERENTE and arena.owner_id == user.id:
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Acesso negado a esta conversa")


# --- Criacao (hook do pagamento confirmado) --------------------------------

def ensure_conversation_for_booking(db: Session, booking: Booking) -> Conversation | None:
    """Cria a conversa arena<->jogador quando a reserva e paga (idempotente).

    Devolve None quando a arena bloqueou a pessoa — a reserva segue valendo, so
    o canal nao abre.

    A tabela tem booking_id UNIQUE, mas o check antes evita conflito de PK e
    reutiliza a conversa existente. Nao commita — o chamador (confirm_payment)
    esta no meio da transacao.
    """
    existing = repo.get_by_booking(db, booking.id)
    if existing is not None:
        return existing

    # BLOQUEIO: a arena barrou esta pessoa. Nao abre canal novo.
    #
    # Nao levanta erro: a reserva ja foi paga e nao pode falhar por causa
    # disto — o dinheiro entrou e o jogo esta marcado. O que o bloqueio tira e
    # a conversa, que e onde o incomodo acontece. A tela do jogador ja lida com
    # reserva sem conversa (o botao "Falar com a arena" so aparece quando ha
    # uma), entao o efeito e exatamente o pretendido: o jogo acontece, o canal
    # nao abre.
    if esta_bloqueado(db, booking.arena_id, booking.user_id):
        return None

    arena = db.get(Arena, booking.arena_id)
    conv = Conversation(
        id=uuid.uuid4(),
        kind=CONVERSATION_KIND_ARENA,
        arena_id=booking.arena_id,
        player_id=booking.user_id,
        booking_id=booking.id,
        status=CONVERSATION_ACTIVE,
        updated_at=_utc_naive(),
    )
    db.add(conv)
    db.flush()
    repo.add_participant(db, conv.id, booking.user_id)
    if arena is not None and arena.owner_id:
        repo.add_participant(db, conv.id, arena.owner_id)
    return conv


# --- Serializacao (shape do SPA) -------------------------------------------

def _to_msg(viewer_id, m: Message) -> dict:
    return {
        "id": str(m.id),
        "from": "player" if m.sender_id == viewer_id else "venue",
        "text": m.content,
        "time": _as_local(m.created_at).strftime("%H:%M"),
    }


def _to_conv(db: Session, viewer_id, row, messages: list[Message]) -> dict:
    conv, arena_name, court_id, booking_code = row
    return {
        "id": str(conv.id),
        "bookingId": str(conv.booking_id),
        "venueId": str(court_id),
        "venue": arena_name,
        "subject": f"Reserva {booking_code}",
        "messages": [_to_msg(viewer_id, m) for m in messages],
        "unread": repo.count_newer_messages(db, conv.id, viewer_id) > 0,
        # Aditivo: o app antigo ignora e continua funcionando.
        "encerrada": conv.status != CONVERSATION_ACTIVE,
    }


def _serialize_conversation(db: Session, user, conv: Conversation) -> dict:
    row = db.execute(
        select(Conversation, Arena.name, Booking.court_id, Booking.code)
        .join(Arena, Arena.id == Conversation.arena_id)
        .join(Booking, Booking.id == Conversation.booking_id)
        .where(Conversation.id == conv.id)
    ).first()
    if row is None:
        raise _conv_404()
    arena = db.get(Arena, conv.arena_id)
    _can_access(db, user, conv, arena)
    return _to_conv(db, user.id, row, repo.list_messages(db, conv.id))


# --- Casos de uso ------------------------------------------------------------

def list_conversations(db: Session, user) -> list[dict]:
    if user.role == ROLE_JOGADOR:
        rows = repo.list_for_player(db, user.id)
    elif user.role == ROLE_ADMIN:
        rows = repo.list_all(db)
    else:
        rows = repo.list_for_manager(db, _manager_arena_ids(db, user))
    return [_to_conv(db, user.id, row, repo.list_messages(db, row[0].id)) for row in rows]


def get_conversation(db: Session, user, conversation_id) -> dict:
    conv = repo.get_conversation(db, conversation_id)
    if conv is None:
        raise _conv_404()
    return _serialize_conversation(db, user, conv)


def send_message(db: Session, user, conversation_id, text: str | None) -> dict:
    conv = repo.get_conversation(db, conversation_id)
    if conv is None:
        raise _conv_404()
    arena = db.get(Arena, conv.arena_id)
    _can_access(db, user, conv, arena)
    if conv.status != CONVERSATION_ACTIVE:
        raise HTTPException(
            status_code=409,
            detail="Este atendimento foi encerrado. Fale com a arena pela nova reserva.",
        )
    text = (text or "").strip()[:MAX_TEXT]
    if not text:
        raise HTTPException(status_code=422, detail="Mensagem vazia")
    now = _utc_naive()
    db.add(
        Message(
            id=uuid.uuid4(),
            conversation_id=conv.id,
            sender_id=user.id,
            content=text,
            message_type=MESSAGE_TYPE_TEXT,
            created_at=now,
        )
    )
    conv.updated_at = now
    db.commit()

    other_id = conv.player_id if conv.player_id != user.id else (arena.owner_id if arena else None)
    if other_id and other_id != user.id:
        other = db.get(User, other_id)
        if other is not None:
            publish_user_event(
                other_id,
                {
                    "type": "message.new",
                    "conversation": _serialize_conversation(db, other, conv),
                },
            )
            notify_message_new(
                other_id,
                title=f"Nova mensagem de {user.name}",
                body=text[:120],
                data={
                    "conversationId": str(conv.id),
                    "bookingId": str(conv.booking_id),
                    "venue": arena.name if arena else "",
                    "subject": f"Reserva {conv.booking_id}",
                },
            )
    return _serialize_conversation(db, user, conv)


def mark_read(db: Session, user, conversation_id) -> dict:
    conv = repo.get_conversation(db, conversation_id)
    if conv is None:
        raise _conv_404()
    arena = db.get(Arena, conv.arena_id)
    _can_access(db, user, conv, arena)
    participant = repo.get_participant(db, conv.id, user.id)
    if participant is not None:
        participant.last_read_at = _utc_naive()
        last = repo.last_message(db, conv.id)
        participant.last_read_message_id = last.id if last else None
        db.commit()
    return _serialize_conversation(db, user, conv)


def encerrar_conversa(db: Session, user, conversation_id) -> dict:
    """A arena encerra o atendimento.

    Regra de produto, no mesmo espirito de iFood e 99: o canal existe para
    RESOLVER AQUELA reserva — combinar chegada, avisar de atraso, tirar duvida
    de acesso. Depois disso ele fecha.

    O motivo nao e economizar mensagem: e impedir que a conversa vire um canal
    permanente entre jogador e arena, por onde a proxima reserva e combinada
    por fora — sem horario travado, sem pagamento e sem a plataforma saber que
    a quadra esta ocupada. Quem faz isso quebra a agenda dos dois lados.

    So a arena encerra. Deixar o jogador encerrar nao resolveria nada (ele so
    pararia de falar) e tiraria da arena a unica ferramenta de encerrar um
    atendimento que virou conversa fiada.
    """
    conv = repo.get_conversation(db, conversation_id)
    if conv is None:
        raise _conv_404()
    arena = db.get(Arena, conv.arena_id)
    _can_access(db, user, conv, arena)
    if user.role == ROLE_JOGADOR:
        raise HTTPException(
            status_code=403,
            detail="Só a arena encerra o atendimento",
        )
    if conv.status != CONVERSATION_ACTIVE:
        return {"ok": True, "encerrada": True}
    conv.status = CONVERSATION_ARCHIVED
    conv.updated_at = _utc_naive()
    db.commit()
    return {"ok": True, "encerrada": True}


def encerrar_vencidas(db: Session, *, horas: int = 6) -> int:
    """Fecha sozinha o atendimento cuja reserva ja acabou.

    O fechamento manual sozinho nao basta: gerente ocupado nao fecha conversa
    nenhuma, e o canal fica aberto para sempre — que e exatamente o que a
    regra veio evitar.

    A folga de `horas` depois do fim do jogo existe porque o assunto nao
    termina junto com a partida: objeto esquecido, cobranca indevida e
    reclamacao aparecem depois. Fechar no minuto seguinte ao apito seria
    cortar a conversa no meio.
    """
    from ..models.booking import STATUS_CANCELLED, STATUS_EXPIRED

    corte = _utc_naive() - timedelta(hours=horas)
    linhas = db.execute(
        select(Conversation, Booking)
        .join(Booking, Booking.id == Conversation.booking_id)
        .where(Conversation.status == CONVERSATION_ACTIVE)
    ).all()

    fechadas = 0
    for conv, booking in linhas:
        fim = booking.end_at
        # Reserva que morreu antes de acontecer tambem encerra o canal: nao ha
        # mais reserva sobre a qual conversar.
        morreu = booking.status in (STATUS_CANCELLED, STATUS_EXPIRED)
        if not morreu and (fim is None or fim > corte):
            continue
        conv.status = CONVERSATION_ARCHIVED
        fechadas += 1
    if fechadas:
        db.commit()
    return fechadas


def badges(db: Session, user) -> dict:
    unread = repo.unread_conversation_count(db, user.id)
    # Chave ADITIVA: o app ja instalado ignora o que nao conhece, e
    # EMPTY_BADGES no front tolera a ausencia. Vale para os tres papeis —
    # gerente e admin tambem podem estar num clube como jogadores.
    from ..repositories import clubs as clubs_repo

    clube = clubs_repo.unread_total(db, user.id)
    if user.role == ROLE_JOGADOR:
        return {"solicitacoes": 0, "msg_jog": unread, "msg_ger": 0, "msg_clube": clube}
    if user.role == ROLE_GERENTE:
        arena_ids = _manager_arena_ids(db, user)
        return {
            "solicitacoes": repo.requested_count(db, arena_ids),
            "msg_jog": 0,
            "msg_ger": unread,
            "msg_clube": clube,
        }
    total_arenas = db.execute(select(Arena.id)).scalars().all()
    return {
        "solicitacoes": repo.requested_count(db, total_arenas),
        "msg_jog": 0,
        "msg_ger": unread,
        "msg_clube": clube,
    }


# --- Bloqueio de pessoa pela arena -----------------------------------------

def _arena_do_gerente(db: Session, user) -> Arena:
    """A arena que este gerente administra. 403 se ele nao administra nenhuma."""
    from ..services.gerente import manager_arena_or_404

    return manager_arena_or_404(db, user)


def bloquear_pessoa(db: Session, user, player_id, motivo: str | None = None) -> dict:
    """A arena barra alguem de abrir conversa nova com ela.

    Encerrar conversa resolve UM atendimento; nao resolve quando o problema e a
    pessoa. Encerrada uma, a proxima reserva abre outra e a arena volta ao
    mesmo lugar.

    O bloqueio e por ARENA e nao global: quem foi barrado numa quadra continua
    jogando nas outras. Banir da plataforma e decisao de quem opera a
    plataforma — e a arena tem interesse proprio no assunto, entao nao pode ser
    ela a tomar.

    Nao cancela reserva ja paga: dinheiro recebido tem de ser honrado ou
    devolvido, e cancelar no mesmo gesto seria confisco. As conversas ABERTAS
    sao encerradas, que e o efeito imediato que o gerente espera ao clicar.
    """
    if user.role == ROLE_JOGADOR:
        raise HTTPException(status_code=403, detail="Só a arena bloqueia")
    arena = _arena_do_gerente(db, user)

    alvo = db.get(User, _uuid_ou_404(player_id))
    if alvo is None:
        raise HTTPException(status_code=404, detail="Pessoa não encontrada")
    if alvo.id == user.id:
        raise HTTPException(status_code=422, detail="Você não pode bloquear a si mesmo")

    ja = db.execute(
        select(ArenaBlock).where(
            ArenaBlock.arena_id == arena.id, ArenaBlock.user_id == alvo.id
        )
    ).scalar_one_or_none()
    if ja is None:
        db.add(ArenaBlock(
            id=uuid.uuid4(), arena_id=arena.id, user_id=alvo.id,
            motivo=(motivo or "").strip()[:280] or None,
            blocked_by=user.id,
        ))

    # Fecha o que estiver aberto: bloquear e continuar com a conversa de pe
    # seria dizer uma coisa e fazer outra.
    abertas = db.execute(
        select(Conversation).where(
            Conversation.arena_id == arena.id,
            Conversation.player_id == alvo.id,
            Conversation.status == CONVERSATION_ACTIVE,
        )
    ).scalars().all()
    for conv in abertas:
        conv.status = CONVERSATION_ARCHIVED
        conv.updated_at = _utc_naive()

    db.commit()
    return {"ok": True, "bloqueado": True, "conversasEncerradas": len(abertas)}


def desbloquear_pessoa(db: Session, user, player_id) -> dict:
    """Desfaz o bloqueio. Existir e tao importante quanto o bloqueio: sem isso,
    um clique errado seria permanente e o gerente evitaria usar a ferramenta."""
    if user.role == ROLE_JOGADOR:
        raise HTTPException(status_code=403, detail="Só a arena desbloqueia")
    arena = _arena_do_gerente(db, user)
    db.execute(
        delete(ArenaBlock).where(
            ArenaBlock.arena_id == arena.id,
            ArenaBlock.user_id == _uuid_ou_404(player_id),
        )
    )
    db.commit()
    return {"ok": True, "bloqueado": False}


def listar_bloqueados(db: Session, user) -> list[dict]:
    if user.role == ROLE_JOGADOR:
        raise HTTPException(status_code=403, detail="Acesso negado")
    arena = _arena_do_gerente(db, user)
    linhas = db.execute(
        select(ArenaBlock, User)
        .join(User, User.id == ArenaBlock.user_id)
        .where(ArenaBlock.arena_id == arena.id)
        .order_by(ArenaBlock.created_at.desc())
    ).all()
    return [
        {
            "id": str(b.user_id),
            "nome": u.name,
            "motivo": b.motivo or "",
            "desde": b.created_at.isoformat() if b.created_at else None,
        }
        for b, u in linhas
    ]


def esta_bloqueado(db: Session, arena_id, player_id) -> bool:
    return db.execute(
        select(ArenaBlock.id).where(
            ArenaBlock.arena_id == arena_id, ArenaBlock.user_id == player_id
        )
    ).first() is not None


def _uuid_ou_404(valor):
    try:
        return valor if isinstance(valor, uuid.UUID) else uuid.UUID(str(valor))
    except (ValueError, TypeError):
        raise HTTPException(status_code=404, detail="Pessoa não encontrada")
