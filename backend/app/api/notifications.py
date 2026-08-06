"""API de notificacoes in-app (Fase 7).

Rotas:
  GET  /api/notifications                — lista as do proprio usuario
  GET  /api/notifications/unread-count   — badge
  POST /api/notifications/{id}/read      — marca uma como lida (so as suas)
  POST /api/notifications/read-all       — marca todas como lidas

A autorizacao e por token: o usuario so enxerga as proprias notificacoes;
`role`/`de` vindos do cliente sao ignorados.
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..auth.deps import get_current_user
from ..core.database import get_db
from ..models import User
from ..services import notifications as svc

router = APIRouter(prefix="/api/notifications", tags=["notificacoes"])


@router.get("")
def listar_notificacoes(
    limite: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return {"notificacoes": svc.list_notifications(db, user, limite, offset)}


@router.get("/unread-count")
def nao_lidas(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return {"unread": svc.unread_count(db, user)}


@router.post("/{nid}/read")
def marcar_lida(
    nid: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return {"notificacao": svc.mark_read(db, user, nid)}


@router.post("/read-all")
def marcar_todas_lidas(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return {"marcadas": svc.mark_all_read(db, user)}
