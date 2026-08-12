"""Casos de uso de clubes — Fase 9.

Regras de produto (espelho de venues.js / mobile.js):
- um usuario so participa de UM clube (409 ao entrar em outro);
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
from ..models import (
    CLUB_CODE_ALPHABET,
    CLUB_CODE_LENGTH,
    CLUB_ROLE_DONO,
    CLUB_ROLE_MEMBRO,
    NOTIF_CLUBE_ENTROU,
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


def _club_dict(db: Session, club: Club) -> dict:
    return {
        "id": str(club.id),
        "name": club.name,
        "code": club.code,
        "sport": club.sport,
        "city": club.city,
        "state": club.state,
        "description": club.description or "",
        "photo": club.photo or "",
        "createdBy": str(club.owner_id),
        "members": [_member_dict(m, u) for m, u in repo.list_members(db, club.id)],
    }


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
    return [_club_dict(db, c) for c in repo.list_clubs(db)]


def get_by_code(db: Session, code: str) -> dict:
    normalized = "".join(ch for ch in str(code).upper() if ch.isalnum())
    club = repo.get_by_code(db, normalized)
    if club is None:
        raise HTTPException(status_code=404, detail="Clube nao encontrado")
    return _club_dict(db, club)


def create_club(db: Session, user, body) -> dict:
    if repo.my_club(db, user.id) is not None:
        raise HTTPException(
            status_code=409,
            detail="Você já faz parte de um clube. Saia dele antes de criar outro.",
        )
    if body.id:
        return update_club(db, user, body)
    club = Club(
        id=uuid.uuid4(),
        name=body.name.strip(),
        code=_generate_code(db),
        sport=body.sport.strip(),
        city=body.city.strip(),
        state=body.state,
        description=body.description,
        owner_id=user.id,
    )
    db.add(club)
    repo.add_member(db, club.id, user.id, role=CLUB_ROLE_DONO)
    db.commit()
    return _club_dict(db, club)


def update_club(db: Session, user, body) -> dict:
    club = repo.get_club(db, body.id)
    if club is None:
        raise HTTPException(status_code=404, detail="Clube nao encontrado")
    if club.owner_id != user.id:
        raise HTTPException(status_code=403, detail="Só quem criou o clube pode editá-lo")
    club.name = body.name.strip()
    club.sport = body.sport.strip()
    club.city = body.city.strip()
    if body.state:
        club.state = body.state
    club.description = body.description
    db.commit()
    return _club_dict(db, club)


def join_club(db: Session, user, club_id) -> dict:
    club = repo.get_club(db, club_id)
    if club is None:
        raise HTTPException(status_code=404, detail="Clube nao encontrado")
    if repo.is_member(db, club.id, user.id):
        return _club_dict(db, club)
    if repo.my_club(db, user.id) is not None:
        raise HTTPException(
            status_code=409,
            detail="Você já faz parte de um clube. Saia dele antes de entrar em outro.",
        )
    repo.add_member(db, club.id, user.id, role=CLUB_ROLE_MEMBRO)
    db.commit()
    if club.owner_id != user.id:
        _notify(
            db, club.owner_id, NOTIF_CLUBE_ENTROU,
            "Nova pessoa no clube",
            f"{user.name} entrou em {club.name}.",
            {"clubId": str(club.id), "clubName": club.name},
        )
    return _club_dict(db, club)


def leave_club(db: Session, user, club_id) -> dict:
    club = repo.get_club(db, club_id)
    if club is None:
        return {"ok": True}
    if not repo.is_member(db, club.id, user.id):
        raise HTTPException(status_code=403, detail="Você não faz parte deste clube")
    if repo.count_members(db, club.id) <= 1:
        delete_club(db, user, club.id)
        return {"ok": True, "deleted": True}
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
    if club.owner_id != user.id:
        raise HTTPException(status_code=403, detail="Só quem criou o clube pode remover membros")
    if str(user.id) == str(member_id):
        raise HTTPException(status_code=409, detail="Você não pode remover a si mesmo")
    if not repo.is_member(db, club.id, member_id):
        raise HTTPException(status_code=404, detail="Membro não encontrado")
    repo.remove_member(db, club.id, member_id)
    db.commit()
    return {"ok": True}


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
