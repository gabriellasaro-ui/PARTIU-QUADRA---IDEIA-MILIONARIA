"""Acesso a dados de clubes, membros e mural — Fase 9."""
import uuid

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..models import (
    CLUB_JOIN_PRIVADO,
    JOIN_PENDENTE,
    Club,
    ClubJoinRequest,
    ClubMember,
    ClubMessage,
    ClubMessageRead,
    User,
)
from .venues import _uuid


def get_club(db: Session, club_id) -> Club | None:
    club_id = _uuid(club_id)
    if club_id is None:
        return None
    return db.get(Club, club_id)


def list_clubs(db: Session, limit: int = 200, *, user_id=None) -> list[Club]:
    """Clubes visiveis para `user_id`.

    Clube PRIVADO nao entra: ele so e alcancavel pelo codigo de convite, via
    get_by_code. O corte precisa ser aqui, e nao num filtro do cliente — o
    nome do grupo nao pode sair na resposta para depois ser escondido na tela.

    Quem ja e membro continua vendo o proprio clube privado na lista.
    """
    user_id = _uuid(user_id)
    consulta = select(Club)
    if user_id is None:
        consulta = consulta.where(Club.join_mode != CLUB_JOIN_PRIVADO)
    else:
        meus = select(ClubMember.club_id).where(ClubMember.user_id == user_id)
        consulta = consulta.where(
            (Club.join_mode != CLUB_JOIN_PRIVADO) | Club.id.in_(meus)
        )
    return list(
        db.execute(consulta.order_by(Club.name).limit(limit)).scalars()
    )


def get_by_code(db: Session, code: str) -> Club | None:
    if not code:
        return None
    return db.execute(
        select(Club).where(Club.code == code.upper())
    ).scalar_one_or_none()


def my_clubs(db: Session, user_id) -> list[Club]:
    """Todos os clubes da pessoa.

    Substitui `my_club`, que devolvia UM e usava scalar_one_or_none() — ou
    seja, com dois clubes ela nao escolhia um: levantava MultipleResultsFound.
    Manter uma versao "pega o primeiro" seria pior: escolheria em silencio e a
    pessoa veria o clube errado sem entender por que.
    """
    user_id = _uuid(user_id)
    if user_id is None:
        return []
    return list(
        db.execute(
            select(Club)
            .join(ClubMember, ClubMember.club_id == Club.id)
            .where(ClubMember.user_id == user_id)
            .order_by(Club.name)
        ).scalars()
    )


def count_memberships(db: Session, user_id) -> int:
    user_id = _uuid(user_id)
    if user_id is None:
        return 0
    return db.execute(
        select(func.count()).select_from(ClubMember).where(ClubMember.user_id == user_id)
    ).scalar() or 0


def count_owned(db: Session, user_id) -> int:
    user_id = _uuid(user_id)
    if user_id is None:
        return 0
    return db.execute(
        select(func.count()).select_from(Club).where(Club.owner_id == user_id)
    ).scalar() or 0


def set_role(db: Session, club_id, user_id, role: str) -> ClubMember | None:
    membro = get_member(db, club_id, user_id)
    if membro is None:
        return None
    membro.role = role
    return membro


# ─────────────────────────── solicitacoes de entrada ───────────────────────

def get_join_request(db: Session, club_id, user_id) -> ClubJoinRequest | None:
    club_id = _uuid(club_id)
    user_id = _uuid(user_id)
    if club_id is None or user_id is None:
        return None
    return db.execute(
        select(ClubJoinRequest).where(
            ClubJoinRequest.club_id == club_id,
            ClubJoinRequest.user_id == user_id,
        )
    ).scalar_one_or_none()


def get_request(db: Session, request_id) -> ClubJoinRequest | None:
    request_id = _uuid(request_id)
    if request_id is None:
        return None
    return db.get(ClubJoinRequest, request_id)


def add_join_request(db: Session, club_id, user_id) -> ClubJoinRequest:
    """Cria o pedido, ou REABRE o que ja existe.

    UNIQUE (club_id, user_id) impede duplicata no banco; aqui a mesma regra
    aparece como comportamento: quem foi recusado e pede de novo reabre o
    proprio registro, em vez de tomar 409 na cara sem saber por que.
    """
    existente = get_join_request(db, club_id, user_id)
    if existente is not None:
        existente.status = JOIN_PENDENTE
        existente.decided_at = None
        existente.decided_by = None
        return existente
    pedido = ClubJoinRequest(club_id=_uuid(club_id), user_id=_uuid(user_id))
    db.add(pedido)
    return pedido


def list_join_requests(db: Session, club_id, status: str = JOIN_PENDENTE) -> list[tuple[ClubJoinRequest, User]]:
    club_id = _uuid(club_id)
    if club_id is None:
        return []
    consulta = (
        select(ClubJoinRequest, User)
        .join(User, User.id == ClubJoinRequest.user_id)
        .where(ClubJoinRequest.club_id == club_id)
        .order_by(ClubJoinRequest.created_at)
    )
    if status:
        consulta = consulta.where(ClubJoinRequest.status == status)
    return list(db.execute(consulta).all())


def count_join_requests(db: Session, club_id) -> int:
    club_id = _uuid(club_id)
    if club_id is None:
        return 0
    return db.execute(
        select(func.count())
        .select_from(ClubJoinRequest)
        .where(
            ClubJoinRequest.club_id == club_id,
            ClubJoinRequest.status == JOIN_PENDENTE,
        )
    ).scalar() or 0


def list_members(db: Session, club_id) -> list[tuple[ClubMember, User]]:
    club_id = _uuid(club_id)
    if club_id is None:
        return []
    return list(
        db.execute(
            select(ClubMember, User)
            .join(User, User.id == ClubMember.user_id)
            .where(ClubMember.club_id == club_id)
            .order_by(ClubMember.joined_at)
        ).all()
    )


def get_member(db: Session, club_id, user_id) -> ClubMember | None:
    club_id = _uuid(club_id)
    user_id = _uuid(user_id)
    if club_id is None or user_id is None:
        return None
    return db.execute(
        select(ClubMember).where(
            ClubMember.club_id == club_id, ClubMember.user_id == user_id
        )
    ).scalar_one_or_none()


def is_member(db: Session, club_id, user_id) -> bool:
    return get_member(db, club_id, user_id) is not None


def count_members(db: Session, club_id) -> int:
    club_id = _uuid(club_id)
    if club_id is None:
        return 0
    return (
        db.execute(
            select(func.count())
            .select_from(ClubMember)
            .where(ClubMember.club_id == club_id)
        ).scalar()
        or 0
    )


def add_member(db: Session, club_id, user_id, *, role: str) -> ClubMember:
    row = ClubMember(club_id=_uuid(club_id), user_id=_uuid(user_id), role=role)
    db.add(row)
    return row


def remove_member(db: Session, club_id, user_id) -> None:
    club_id = _uuid(club_id)
    user_id = _uuid(user_id)
    if club_id is None or user_id is None:
        return
    db.execute(
        delete(ClubMember).where(
            ClubMember.club_id == club_id, ClubMember.user_id == user_id
        )
    )


# ────────────────────────── leitura do mural ───────────────────────────────

def unread_by_club(db: Session, user_id) -> dict[str, int]:
    """Quantas mensagens novas em cada clube da pessoa.

    Tres detalhes que decidem se o numero faz sentido:

    1. QUEM NUNCA ABRIU conta a partir de quando entrou, e nao do zero. Sem
       isso, entrar num clube de tres anos daria um badge de 400 mensagens que
       nunca foram para essa pessoa.

    2. A PROPRIA MENSAGEM NAO CONTA. Mandar no mural e sair da tela nao pode
       criar um "nao lido" de si mesmo.

    3. O CORTE E O MAIOR entre a ultima leitura e a data de entrada. Quem leu
       tudo, saiu e voltou nao recebe o historico de novo.
    """
    user_id = _uuid(user_id)
    if user_id is None:
        return {}

    leituras = {
        str(r.club_id): r.last_read_at
        for r in db.execute(
            select(ClubMessageRead).where(ClubMessageRead.user_id == user_id)
        ).scalars()
    }

    resultado: dict[str, int] = {}
    for membro in db.execute(
        select(ClubMember).where(ClubMember.user_id == user_id)
    ).scalars():
        clube = str(membro.club_id)
        corte = membro.joined_at
        lido = leituras.get(clube)
        if lido is not None and (corte is None or lido > corte):
            corte = lido

        consulta = select(func.count()).select_from(ClubMessage).where(
            ClubMessage.club_id == membro.club_id,
            ClubMessage.member_id != user_id,
        )
        if corte is not None:
            consulta = consulta.where(ClubMessage.created_at > corte)
        resultado[clube] = db.execute(consulta).scalar() or 0
    return resultado


def unread_total(db: Session, user_id) -> int:
    return sum(unread_by_club(db, user_id).values())


def marcar_lido(db: Session, club_id, user_id) -> None:
    """Anota a leitura em `agora`, e nao na data da ultima mensagem.

    Usar a ultima mensagem abriria uma janela: uma mensagem que chegasse entre
    a consulta e a gravacao ficaria marcada como lida sem ninguem ter visto.
    """
    from ..core.timezone import utc_now

    club_id = _uuid(club_id)
    user_id = _uuid(user_id)
    if club_id is None or user_id is None:
        return
    registro = db.get(ClubMessageRead, (club_id, user_id))
    ultima = db.execute(
        select(ClubMessage.id)
        .where(ClubMessage.club_id == club_id)
        .order_by(ClubMessage.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()
    # UTC-NAIVE, e nao hora local.
    #
    # `club_messages.created_at` vem de func.now() e e guardado como parede
    # UTC sem fuso. Gravar a leitura em horario de Brasilia punha o marco TRES
    # HORAS ATRAS da mensagem que acabou de ser lida, e a comparacao
    # created_at > last_read_at continuava verdadeira: o badge nao zerava, e
    # nada no codigo parecia errado.
    agora = utc_now().replace(tzinfo=None)
    if registro is None:
        db.add(ClubMessageRead(
            club_id=club_id, user_id=user_id,
            last_read_at=agora, last_read_message_id=ultima,
        ))
    else:
        registro.last_read_at = agora
        registro.last_read_message_id = ultima


def list_messages(db: Session, club_id) -> list[ClubMessage]:
    club_id = _uuid(club_id)
    if club_id is None:
        return []
    return list(
        db.execute(
            select(ClubMessage)
            .where(ClubMessage.club_id == club_id)
            .order_by(ClubMessage.created_at)
        ).scalars()
    )


def add_message(db: Session, club_id, member_id, *, name: str, text: str) -> ClubMessage:
    msg = ClubMessage(
        id=uuid.uuid4(),
        club_id=_uuid(club_id),
        member_id=_uuid(member_id),
        name=name,
        text=text,
    )
    db.add(msg)
    return msg
