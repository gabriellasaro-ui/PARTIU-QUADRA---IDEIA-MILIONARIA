"""API de mensagens — shape do SPA (Fase 6).

`role`/`de` vindos do cliente sao aceitos mas ignorados: a identidade vem do
token. Conversas so existem a partir do pagamento confirmado (booking pago),
logo conversa inexistente vira 404 para quem nao participa dela.
"""
from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session
from starlette.responses import Response

from ..auth.deps import get_current_user
from ..core.database import get_db
from ..core.ratelimit import LIMIT_CHAT_USER, limiter, user_or_ip_key
from ..models import User
from ..services import messages as svc

router = APIRouter(prefix="/api/mensagens", tags=["mensagens"])


@router.get("/nav/badges")
def badges(
    role: str = Query("jogador"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return svc.badges(db, user)


@router.get("")
def listar_conversas(
    role: str = Query("jogador"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return {"conversas": svc.list_conversations(db, user)}


@router.get("/{cid}")
def conversa_detalhe(
    cid: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return {"conversa": svc.get_conversation(db, user, cid)}


@router.post("/{cid}/enviar")
@limiter.limit(LIMIT_CHAT_USER, key_func=user_or_ip_key)
def enviar_mensagem(
    request: Request,
    cid: str,
    texto: str = Query(""),
    de: str = Query("jogador"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    response: Response = None,
):
    return {"conversa": svc.send_message(db, user, cid, texto)}


@router.post("/{cid}/read")
def marcar_lida(
    cid: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return {"conversa": svc.mark_read(db, user, cid)}
