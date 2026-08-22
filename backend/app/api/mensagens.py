"""API de mensagens — shape do SPA (Fase 6).

`role`/`de` vindos do cliente sao aceitos mas ignorados: a identidade vem do
token. Conversas so existem a partir do pagamento confirmado (booking pago),
logo conversa inexistente vira 404 para quem nao participa dela.
"""
from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel
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


# ── Bloqueio de pessoa pela arena ──────────────────────────────────────────
#
# ESTE BLOCO VEM ANTES de /{cid} de proposito. O FastAPI casa as rotas na ordem
# de declaracao: com /{cid} primeiro, "bloqueados" chega como se fosse um id de
# conversa e a rota certa nunca e alcancada. Mesma armadilha do /meus dos
# clubes.


class BloqueioBody(BaseModel):
    """Anotacao do gerente sobre o bloqueio.

    Opcional, mas util quando outro atendente pergunta seis meses depois por
    que aquela pessoa esta bloqueada.
    """

    motivo: str | None = None


@router.get("/bloqueados")
def listar_bloqueados(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return {"bloqueados": svc.listar_bloqueados(db, user)}


@router.post("/bloquear/{player_id}")
def bloquear(
    player_id: str,
    body: BloqueioBody | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """A arena barra alguem de abrir conversa nova com ela.

    Encerrar conversa resolve UM atendimento; nao resolve quando o problema e a
    pessoa — encerrada uma, a proxima reserva abre outra. O bloqueio e por
    ARENA e nao global: banir da plataforma e decisao de quem a opera, e a
    arena tem interesse proprio no assunto.
    """
    return svc.bloquear_pessoa(db, user, player_id, (body.motivo if body else None))


@router.delete("/bloquear/{player_id}")
def desbloquear(
    player_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Existir importa tanto quanto o bloqueio: sem desfazer, um clique errado
    seria permanente e o gerente evitaria usar a ferramenta."""
    return svc.desbloquear_pessoa(db, user, player_id)


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


@router.post("/{cid}/encerrar")
def encerrar_conversa(
    cid: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """A arena encerra o atendimento. Jogador recebe 403.

    Depois disso ninguem escreve nesta conversa — o canal existia para
    resolver AQUELA reserva.
    """
    return svc.encerrar_conversa(db, user, cid)


@router.post("/{cid}/read")
def marcar_lida(
    cid: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return {"conversa": svc.mark_read(db, user, cid)}
