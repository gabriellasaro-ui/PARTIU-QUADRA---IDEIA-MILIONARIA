"""Clubes (Fase 9).

Contrato do app (venues.js / mobile.js):
  GET    /api/clubes              -> {clubes:[...]}
  GET    /api/clubes?codigo=X     -> {clube}  (match EXATO, sem hifen)
  POST   /api/clubes              -> {clube}  (id presente = edicao)
  POST   /api/clubes/{id}/entrar  -> {clube}
  POST   /api/clubes/{id}/sair    -> {ok}
  DELETE /api/clubes/{id}         -> {ok}  (so dono, clube vazio)
  DELETE /api/clubes/{id}/membros/{mid} -> {ok}  (so dono, nunca a si mesmo)
  GET    /api/clubes/{id}/mensagens -> {mensagens:[...]}  (so membro)
  POST   /api/clubes/{id}/mensagens -> {mensagem}  ({text})
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..auth.deps import get_current_user
from ..core.database import get_db
from ..models import User
from ..schemas.clubes import ClubCreate, ClubMessageCreate
from ..services import clubs as svc

router = APIRouter(prefix="/api/clubes", tags=["clubes"])


@router.get("")
def listar_clubes(
    codigo: str | None = Query(default=None, max_length=20),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if codigo:
        return {"clube": svc.get_by_code(db, codigo)}
    return {"clubes": svc.list_clubs(db, user)}


@router.post("")
def criar_clube(
    body: ClubCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return {"clube": svc.create_club(db, user, body)}


@router.post("/{club_id}/entrar")
def entrar_clube(
    club_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return {"clube": svc.join_club(db, user, club_id)}


@router.post("/{club_id}/sair")
def sair_clube(
    club_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return svc.leave_club(db, user, club_id)


@router.delete("/{club_id}")
def apagar_clube(
    club_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return svc.delete_club(db, user, club_id)


@router.delete("/{club_id}/membros/{member_id}")
def remover_membro(
    club_id: str,
    member_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return svc.remove_member(db, user, club_id, member_id)


@router.get("/{club_id}/mensagens")
def listar_mensagens(
    club_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return {"mensagens": svc.list_messages(db, user, club_id)}


@router.post("/{club_id}/mensagens")
def enviar_mensagem(
    club_id: str,
    body: ClubMessageCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return {"mensagem": svc.send_message(db, user, club_id, body.text)}
