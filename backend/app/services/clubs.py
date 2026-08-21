"""Casos de uso de clubes — Fase 9, ampliado na Fase 16 (guilda).

Regras de produto:
- a pessoa participa de VARIOS clubes, ate `club_max_per_user`, e cria ate
  `club_max_owned`. Antes era um clube so: quem jogava com dois grupos tinha
  de sair de um para entrar no outro, e os dois esvaziavam;
- tres modos de entrada. `aberto` entra na hora; `solicitacao` cria um pedido
  que a gestao aprova; `privado` exige o codigo e NAO aparece em busca;
- tres cargos. Admin aprova entrada, remove membro e mexe na configuracao;
  dono faz isso e mais: apaga o clube e promove/rebaixa admin. Sem o cargo do
  meio o dono vira gargalo — se ele some, ninguem entra nem organiza pelada;
- o clube tem limite de membros, definido pela gestao;
- o membro nasce do perfil (position/rating), nunca de valor digitado;
- sair sendo o ultimo apaga o clube (um grupo sem ninguem nao e grupo);
- apagar so o dono e com o clube vazio; remover membro so o dono e nunca a
  si mesmo;
- o codigo de convite tem 6 chars do alfabeto que exclui I/L/O/0/1 e e
  identidade (match EXATO na busca, nunca parcial).
"""
import uuid
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..core.timezone import now_local
from ..core.ws import publish_user_event
from ..core.config import settings
from ..models import (
    CLUB_CODE_ALPHABET,
    CLUB_CODE_LENGTH,
    CLUB_JOIN_ABERTO,
    CLUB_JOIN_MODES,
    CLUB_JOIN_PRIVADO,
    CLUB_JOIN_SOLICITACAO,
    CLUB_ROLE_ADMIN,
    CLUB_ROLE_DONO,
    CLUB_ROLE_MEMBRO,
    CLUB_ROLES_GESTAO,
    JOIN_APROVADA,
    JOIN_PENDENTE,
    JOIN_RECUSADA,
    NOTIF_CLUBE_APROVADO,
    NOTIF_CLUBE_CARGO,
    NOTIF_CLUBE_ENTROU,
    NOTIF_CLUBE_RECUSADO,
    NOTIF_CLUBE_SOLICITACAO,
    Club,
    ClubMember,
    User,
)
from ..repositories import clubs as repo
from ..repositories import peladas as peladas_repo
from .catalog import _as_local

_MESES = [
    "jan", "fev", "mar", "abr", "mai", "jun",
    "jul", "ago", "set", "out", "nov", "dez",
]


def _mes_ano(value) -> str:
    """'ago/2026' — mesmo formato de `since` do app (utils/formatters.js)."""
    local = _as_local(value)
    if local is None:
        return ""
    return f"{_MESES[local.month - 1]}/{local.year}"


def _member_dict(member: ClubMember, user: User) -> dict:
    return {
        "id": str(user.id),
        "name": user.name,
        "role": member.role,
        "position": user.position or "Jogador",
        "rating": user.rating,
        "since": _mes_ano(member.joined_at),
    }


def _papel(db: Session, club: Club, user) -> str:
    """Cargo da pessoa no clube, ou "" se ela nao for membro."""
    if user is None:
        return ""
    membro = repo.get_member(db, club.id, user.id)
    return membro.role if membro else ""


def _exigir_gestao(db: Session, club: Club, user) -> str:
    papel = _papel(db, club, user)
    if papel not in CLUB_ROLES_GESTAO:
        raise HTTPException(
            status_code=403, detail="Só a administração do clube pode fazer isso"
        )
    return papel


def _exigir_dono(club: Club, user) -> None:
    if str(club.owner_id) != str(user.id):
        raise HTTPException(status_code=403, detail="Só quem criou o clube pode fazer isso")


def _club_dict(db: Session, club: Club, user=None) -> dict:
    """Contrato do clube.

    Os campos da Fase 16 sao ADITIVOS de proposito: o app que ja esta instalado
    continua lendo name/code/members como antes e simplesmente ignora o resto.

    `pendingCount` so vai para quem pode agir sobre a fila — quantas pessoas
    querem entrar num clube nao e informacao de visitante.
    """
    papel = _papel(db, club, user)
    dados = {
        "id": str(club.id),
        "name": club.name,
        "code": club.code,
        "sport": club.sport,
        "city": club.city,
        "state": club.state,
        "description": club.description or "",
        "photo": club.photo or "",
        "createdBy": str(club.owner_id),
        "joinMode": club.join_mode,
        "maxMembers": club.max_members,
        "myRole": papel,
        "members": [_member_dict(m, u) for m, u in repo.list_members(db, club.id)],
    }
    if papel in CLUB_ROLES_GESTAO:
        dados["pendingCount"] = repo.count_join_requests(db, club.id)
    return dados


def _member_ids(db: Session, club: Club) -> list[uuid.UUID]:
    return [m.user_id for m, _ in repo.list_members(db, club.id)]


def _generate_code(db: Session) -> str:
    import random

    usados = {c.code for c in repo.list_clubs(db)}
    for _ in range(50):
        code = "".join(
            random.choice(CLUB_CODE_ALPHABET) for _ in range(CLUB_CODE_LENGTH)
        )
        if code not in usados:
            return code
    return f"C{datetime.now().strftime('%Y%m%d%H%M%S')}"[:6]


def list_clubs(db: Session, user=None) -> list[dict]:
    # user_id vai ao repositorio: e la que o clube privado e cortado da busca.
    return [
        _club_dict(db, c, user)
        for c in repo.list_clubs(db, user_id=getattr(user, "id", None))
    ]


def meus_clubes(db: Session, user) -> list[dict]:
    return [_club_dict(db, c, user) for c in repo.my_clubs(db, user.id)]


def get_by_code(db: Session, code: str, user=None) -> dict:
    """Busca por codigo — a UNICA porta do clube privado.

    Match exato, nunca parcial: o codigo e identidade. Busca parcial deixaria
    varrer o alfabeto ate topar com um clube fechado.
    """
    normalized = "".join(ch for ch in str(code).upper() if ch.isalnum())
    club = repo.get_by_code(db, normalized)
    if club is None:
        raise HTTPException(status_code=404, detail="Clube nao encontrado")
    return _club_dict(db, club, user)


def _modo_valido(modo) -> str:
    """Modo de entrada, com o aberto como padrao.

    Modo desconhecido cai em `aberto` em vez de estourar: a alternativa seria
    um clube sem modo nenhum, e ai ninguem entra e ninguem entende por que.
    """
    modo = str(modo or "").strip().lower()
    return modo if modo in CLUB_JOIN_MODES else CLUB_JOIN_ABERTO


def _limite_valido(limite, *, minimo: int = 1) -> int:
    """Limite de membros, preso entre quem ja esta dentro e o teto do sistema.

    O piso e `minimo` — o total ATUAL de membros — porque baixar o limite para
    menos do que ja existe nao expulsa ninguem: so cria um clube que se recusa
    a aceitar gente e nao explica o motivo.
    """
    try:
        valor = int(limite)
    except (TypeError, ValueError):
        valor = settings.club_members_default
    piso = max(1, minimo)
    return max(piso, min(valor, settings.club_members_max))


def _exigir_espaco_para_entrar(db: Session, user) -> None:
    """Teto de participacoes.

    Sem teto aparece quem entra em dezenas de clubes so para cacar vaga e nunca
    confirma presenca — o que enche a lista de membros e esvazia a pelada, que
    e o oposto do que o clube existe para fazer.
    """
    if repo.count_memberships(db, user.id) >= settings.club_max_per_user:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Você já participa de {settings.club_max_per_user} clubes. "
                "Saia de um antes de entrar em outro."
            ),
        )


def create_club(db: Session, user, body) -> dict:
    if body.id:
        return update_club(db, user, body)
    if repo.count_owned(db, user.id) >= settings.club_max_owned:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Você já criou {settings.club_max_owned} clubes. "
                "Apague um antes de criar outro."
            ),
        )
    _exigir_espaco_para_entrar(db, user)
    club = Club(
        id=uuid.uuid4(),
        name=body.name.strip(),
        code=_generate_code(db),
        sport=body.sport.strip(),
        city=body.city.strip(),
        state=body.state,
        description=body.description,
        owner_id=user.id,
        join_mode=_modo_valido(getattr(body, "joinMode", None)),
        max_members=_limite_valido(getattr(body, "maxMembers", None)),
    )
    db.add(club)
    repo.add_member(db, club.id, user.id, role=CLUB_ROLE_DONO)
    db.commit()
    # Com o usuario: sem ele, myRole voltava vazio na criacao e a tela nao
    # sabia que quem acabou de criar o clube e o dono dele.
    return _club_dict(db, club, user)


def update_club(db: Session, user, body) -> dict:
    club = repo.get_club(db, body.id)
    if club is None:
        raise HTTPException(status_code=404, detail="Clube nao encontrado")
    # Gestao, e nao so o dono: admin existe justamente para o clube nao parar
    # quando o dono some.
    _exigir_gestao(db, club, user)
    club.name = body.name.strip()
    club.sport = body.sport.strip()
    club.city = body.city.strip()
    if body.state:
        club.state = body.state
    club.description = body.description
    modo = getattr(body, "joinMode", None)
    if modo:
        club.join_mode = _modo_valido(modo)
    limite = getattr(body, "maxMembers", None)
    if limite:
        club.max_members = _limite_valido(limite, minimo=repo.count_members(db, club.id))
    db.commit()
    return _club_dict(db, club, user)


def join_club(db: Session, user, club_id, codigo: str | None = None) -> dict:
    club = repo.get_club(db, club_id)
    if club is None:
        raise HTTPException(status_code=404, detail="Clube nao encontrado")
    if repo.is_member(db, club.id, user.id):
        return _club_dict(db, club, user)

    _exigir_espaco_para_entrar(db, user)

    if repo.count_members(db, club.id) >= club.max_members:
        raise HTTPException(status_code=409, detail="Clube lotado")

    # PRIVADO: so passa quem trouxe o codigo. A comparacao e exata e sobre a
    # forma normalizada — o codigo e exibido como XXX-XXX, mas guardado sem
    # hifen.
    if club.join_mode == CLUB_JOIN_PRIVADO:
        tentado = "".join(ch for ch in str(codigo or "").upper() if ch.isalnum())
        if tentado != club.code:
            raise HTTPException(
                status_code=403,
                detail="Este clube é fechado. Peça o código de convite a quem já está dentro.",
            )

    # SOLICITACAO: nao entra agora; entra na fila da gestao.
    elif club.join_mode == CLUB_JOIN_SOLICITACAO:
        pedido = repo.add_join_request(db, club.id, user.id)
        db.commit()
        for gestor_id in _ids_da_gestao(db, club):
            _notify(
                db, gestor_id, NOTIF_CLUBE_SOLICITACAO,
                "Pedido para entrar no clube",
                f"{user.name} quer entrar em {club.name}.",
                {"clubId": str(club.id), "clubName": club.name, "requestId": str(pedido.id)},
            )
        return {"status": JOIN_PENDENTE, "clube": _club_dict(db, club, user)}

    repo.add_member(db, club.id, user.id, role=CLUB_ROLE_MEMBRO)
    db.commit()
    if str(club.owner_id) != str(user.id):
        _notify(
            db, club.owner_id, NOTIF_CLUBE_ENTROU,
            "Nova pessoa no clube",
            f"{user.name} entrou em {club.name}.",
            {"clubId": str(club.id), "clubName": club.name},
        )
    return _club_dict(db, club, user)


def leave_club(db: Session, user, club_id) -> dict:
    club = repo.get_club(db, club_id)
    if club is None:
        return {"ok": True}
    if not repo.is_member(db, club.id, user.id):
        raise HTTPException(status_code=403, detail="Você não faz parte deste clube")
    if repo.count_members(db, club.id) <= 1:
        delete_club(db, user, club.id)
        return {"ok": True, "deleted": True}
    if str(club.owner_id) == str(user.id):
        # Dono saindo deixaria um clube sem quem apague, promova ou aprove
        # entrada — vivo e sem dono. Passar a posse vem antes de sair.
        raise HTTPException(
            status_code=409,
            detail="Passe o clube para outra pessoa antes de sair.",
        )
    repo.remove_member(db, club.id, user.id)
    db.commit()
    return {"ok": True}


def delete_club(db: Session, user, club_id) -> dict:
    club = repo.get_club(db, club_id)
    if club is None:
        return {"ok": True}
    if club.owner_id != user.id:
        raise HTTPException(status_code=403, detail="Só quem criou o clube pode apagar")
    if repo.count_members(db, club.id) > 1:
        raise HTTPException(
            status_code=409, detail="Remova os outros membros antes de apagar o clube"
        )
    for pelada in peladas_repo.list_by_club(db, club.id):
        db.delete(pelada)
    db.delete(club)  # club_members + club_messages cascateiam
    db.commit()
    return {"ok": True}


def remove_member(db: Session, user, club_id, member_id) -> dict:
    club = repo.get_club(db, club_id)
    if club is None:
        raise HTTPException(status_code=404, detail="Clube nao encontrado")
    quem = _exigir_gestao(db, club, user)
    if str(user.id) == str(member_id):
        raise HTTPException(status_code=409, detail="Você não pode remover a si mesmo")
    if not repo.is_member(db, club.id, member_id):
        raise HTTPException(status_code=404, detail="Membro não encontrado")

    alvo = repo.get_member(db, club.id, member_id)
    # Admin nao mexe em quem esta no mesmo degrau ou acima: sem isto, dois
    # admins podem se remover mutuamente, e qualquer um deles pode expulsar o
    # dono do proprio clube.
    if quem == CLUB_ROLE_ADMIN and alvo and alvo.role in CLUB_ROLES_GESTAO:
        raise HTTPException(
            status_code=403,
            detail="Admin não pode remover o dono nem outro admin",
        )
    repo.remove_member(db, club.id, member_id)
    db.commit()
    return {"ok": True}


def _ids_da_gestao(db: Session, club: Club) -> list:
    """Quem recebe aviso de pedido de entrada."""
    return [
        m.user_id
        for m, _ in repo.list_members(db, club.id)
        if m.role in CLUB_ROLES_GESTAO
    ]


# ─────────────────────────── solicitacoes de entrada ───────────────────────

def listar_solicitacoes(db: Session, user, club_id) -> dict:
    club = repo.get_club(db, club_id)
    if club is None:
        raise HTTPException(status_code=404, detail="Clube nao encontrado")
    _exigir_gestao(db, club, user)
    return {
        "solicitacoes": [
            {
                "id": str(pedido.id),
                "userId": str(pedido.user_id),
                "name": pessoa.name,
                "photo": pessoa.photo or "",
                "city": pessoa.city or "",
                "position": pessoa.position or "",
                "createdAt": pedido.created_at.isoformat() if pedido.created_at else None,
            }
            for pedido, pessoa in repo.list_join_requests(db, club.id)
        ]
    }


def decidir_solicitacao(db: Session, user, club_id, request_id, aprovar: bool) -> dict:
    club = repo.get_club(db, club_id)
    if club is None:
        raise HTTPException(status_code=404, detail="Clube nao encontrado")
    _exigir_gestao(db, club, user)

    pedido = repo.get_request(db, request_id)
    if pedido is None or str(pedido.club_id) != str(club.id):
        raise HTTPException(status_code=404, detail="Solicitação não encontrada")
    if pedido.status != JOIN_PENDENTE:
        raise HTTPException(status_code=409, detail="Esta solicitação já foi decidida")

    pedido.decided_at = now_local()
    pedido.decided_by = user.id

    if not aprovar:
        pedido.status = JOIN_RECUSADA
        db.commit()
        _notify(
            db, pedido.user_id, NOTIF_CLUBE_RECUSADO,
            "Pedido recusado",
            f"Seu pedido para entrar em {club.name} não foi aceito.",
            {"clubId": str(club.id), "clubName": club.name},
        )
        return {"ok": True, "status": JOIN_RECUSADA}

    # A checagem de lotacao e refeita AQUI, e nao so no pedido: entre pedir e
    # aprovar o clube pode ter enchido, e aprovar mesmo assim estouraria o
    # limite que a gestao definiu.
    if repo.count_members(db, club.id) >= club.max_members:
        raise HTTPException(status_code=409, detail="Clube lotado")
    if repo.is_member(db, club.id, pedido.user_id):
        pedido.status = JOIN_APROVADA
        db.commit()
        return {"ok": True, "status": JOIN_APROVADA}

    pedido.status = JOIN_APROVADA
    repo.add_member(db, club.id, pedido.user_id, role=CLUB_ROLE_MEMBRO)
    db.commit()
    _notify(
        db, pedido.user_id, NOTIF_CLUBE_APROVADO,
        "Você entrou no clube",
        f"Seu pedido para entrar em {club.name} foi aceito.",
        {"clubId": str(club.id), "clubName": club.name},
    )
    return {"ok": True, "status": JOIN_APROVADA}


# ───────────────────────────────── cargos ──────────────────────────────────

def definir_cargo(db: Session, user, club_id, member_id, cargo: str) -> dict:
    """Promove a admin ou rebaixa a membro. So o dono.

    O dono nao pode ser rebaixado nem promovido por esta porta: o cargo dele
    vem de `clubs.owner_id`, e mexer aqui deixaria o clube com um dono que nao
    e da gestao.
    """
    club = repo.get_club(db, club_id)
    if club is None:
        raise HTTPException(status_code=404, detail="Clube nao encontrado")
    _exigir_dono(club, user)

    cargo = str(cargo or "").strip().lower()
    if cargo not in (CLUB_ROLE_ADMIN, CLUB_ROLE_MEMBRO):
        raise HTTPException(status_code=422, detail="Cargo inválido")
    if str(member_id) == str(club.owner_id):
        raise HTTPException(status_code=409, detail="O dono não muda de cargo")
    if not repo.is_member(db, club.id, member_id):
        raise HTTPException(status_code=404, detail="Membro não encontrado")

    repo.set_role(db, club.id, member_id, cargo)
    db.commit()
    _notify(
        db, member_id, NOTIF_CLUBE_CARGO,
        "Seu cargo mudou",
        (f"Você agora é administrador de {club.name}." if cargo == CLUB_ROLE_ADMIN
         else f"Você agora é membro de {club.name}."),
        {"clubId": str(club.id), "clubName": club.name, "role": cargo},
    )
    return _club_dict(db, club, user)


def _require_member(db: Session, user, club_id) -> Club:
    club = repo.get_club(db, club_id)
    if club is None:
        raise HTTPException(status_code=404, detail="Clube nao encontrado")
    if not repo.is_member(db, club.id, user.id):
        raise HTTPException(status_code=403, detail="Você não faz parte deste clube")
    return club


def list_messages(db: Session, user, club_id) -> list[dict]:
    club = _require_member(db, user, club_id)
    return [_msg_dict(db, m) for m in repo.list_messages(db, club.id)]


def _msg_dict(db: Session, msg) -> dict:
    return {
        "id": str(msg.id),
        "clubId": str(msg.club_id),
        "memberId": str(msg.member_id),
        "name": msg.name,
        "text": msg.text,
        "time": _as_local(msg.created_at).isoformat() if msg.created_at else None,
    }


def send_message(db: Session, user, club_id, text: str) -> dict:
    club = _require_member(db, user, club_id)
    msg = repo.add_message(
        db, club.id, user.id, name=user.name, text=text.strip()
    )
    db.commit()
    payload = _msg_dict(db, msg)
    for uid in _member_ids(db, club):
        publish_user_event(uid, {"type": "club.message.new", "mensagem": payload})
    return payload


def _notify(db: Session, user_id, type_: str, title: str, body: str, data: dict) -> None:
    from .notifications import emit_notification

    emit_notification(
        db, user_id, type=type_, title=title, body=body, data=data
    )
