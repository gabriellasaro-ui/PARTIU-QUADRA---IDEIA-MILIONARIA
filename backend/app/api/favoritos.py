"""Favoritos do jogador (Fase 3).

GET devolve as arenas favoritas como venues do contrato de quadras; so faz
sentido com sessao — sem token a resposta e vazia, sem quebrar a tela.
Toggle (POST/DELETE por arena_id) exige login.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..auth.deps import get_current_user, get_optional_user
from ..core.database import get_db
from ..models import Arena, User, UserFavorite
from ..repositories.venues import _uuid
from ..services import catalog

router = APIRouter(prefix="/api/favoritos", tags=["favoritos"])


@router.get("")
def favoritos(
    user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    if not user:
        return {"quadras": []}
    return {"quadras": catalog.get_favorite_venues(db, user.id)}


@router.post("/{arena_id}")
def favoritar(
    arena_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    arena_id = _arena_exists(db, arena_id)
    exists = db.execute(
        select(UserFavorite.user_id).where(
            UserFavorite.user_id == user.id, UserFavorite.arena_id == arena_id
        )
    ).first()
    if not exists:
        db.add(UserFavorite(user_id=user.id, arena_id=arena_id))
        db.commit()
    return {"ok": True, "favorito": True}


@router.delete("/{arena_id}")
def desfavoritar(
    arena_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    arena_id = _arena_exists(db, arena_id)
    db.execute(
        delete(UserFavorite).where(
            UserFavorite.user_id == user.id, UserFavorite.arena_id == arena_id
        )
    )
    db.commit()
    return {"ok": True, "favorito": False}


def _arena_exists(db: Session, arena_id: str):
    arena_id = _uuid(arena_id)
    if arena_id is None or not db.execute(
        select(Arena.id).where(Arena.id == arena_id)
    ).first():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Arena nao encontrada"
        )
    return arena_id
