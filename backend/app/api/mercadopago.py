"""Conexao da arena com o Mercado Pago (OAuth do split 1:1).

  GET  /api/mercadopago/oauth/iniciar      gerente -> URL de autorizacao
  GET  /api/mercadopago/oauth/callback     PUBLICA -> troca o code por tokens
  GET  /api/mercadopago/oauth/status       gerente -> estado da conexao
  POST /api/mercadopago/oauth/desconectar  gerente -> revoga a conexao

UMA CONVENCAO SO. `status` e `desconectar` viviam fora do `oauth/` e isso
custou tempo duas vezes durante a integracao: quem chutava o caminho obvio
recebia 404 do FastAPI, que e indistinguivel de "a rota nao subiu". O
`callback` e o unico que nao pode mudar de lugar — o endereco esta cadastrado
no painel do Mercado Pago.

POR QUE O CALLBACK E PUBLICO
----------------------------
Quem chega nele e o navegador do dono vindo do dominio do Mercado Pago, sem
o nosso header Authorization. Exigir login aqui quebraria o fluxo no ultimo
passo. Quem faz o papel da autenticacao e o `state` assinado: ele carrega o
arena_id, tem HMAC do servidor e vence em 10 minutos. Ver o docstring de
services/mercadopago_oauth.py.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from ..auth.deps import get_current_manager
from ..core.config import settings
from ..core.database import get_db
from ..models import User
from ..services import mercadopago_oauth as oauth
from ..services.gerente import manager_arena_or_404

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/mercadopago", tags=["mercadopago"])


def _retorno(sucesso: bool, motivo: str = "", detalhe: str = ""):
    """Devolve o dono ao painel, ou responde JSON se nao houver painel.

    `mercadopago_panel_return_url` vazia mantem a rota utilizavel em teste e
    em curl sem inventar um redirect para lugar nenhum.
    """
    destino = settings.mercadopago_panel_return_url.strip()
    if not destino:
        # Sem painel configurado a resposta e lida por gente depurando: o
        # detalhe vale mais que a estetica.
        return {"ok": sucesso, "erro": motivo or None, "detalhe": detalhe or None}
    sep = "&" if "?" in destino else "?"
    query = "mp=ok" if sucesso else f"mp=erro&motivo={motivo or 'falha'}"
    return RedirectResponse(f"{destino}{sep}{query}", status_code=302)


@router.get("/oauth/iniciar")
def iniciar_conexao(
    user: User = Depends(get_current_manager),
    db: Session = Depends(get_db),
):
    arena = manager_arena_or_404(db, user)
    try:
        return {"url": oauth.authorization_url(arena.id)}
    except oauth.MercadoPagoOAuthError as exc:
        # 503 e nao 500: falta configuracao do lado da Qadras, nao erro do
        # gerente. A mensagem diz o que fazer sem vazar credencial.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        )


@router.get("/oauth/callback")
def callback_oauth(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
):
    # O dono pode ter clicado em "cancelar" na tela do MP.
    if error or not code or not state:
        return _retorno(False, error or "sem_code")
    try:
        arena_id, _conexao = oauth.exchange_code(db, code=code, state=state)
    except oauth.MercadoPagoOAuthError as exc:
        # `str(exc)` e seguro por construcao: MercadoPagoOAuthError so carrega
        # status e codigo de erro do MP, nunca o corpo (que ecoa o `code`).
        # Devolver o motivo evita que todo defeito de configuracao apareca
        # como o mesmo "recusado" — que nao da para depurar.
        logger.warning("callback mercadopago falhou: %s", exc)
        return _retorno(False, "recusado", detalhe=str(exc))
    db.commit()
    logger.info("mercadopago: arena %s conectada", arena_id)
    return _retorno(True)


@router.get("/oauth/status")
def status_conexao(
    user: User = Depends(get_current_manager),
    db: Session = Depends(get_db),
):
    arena = manager_arena_or_404(db, user)
    conexao = oauth.connection_for_arena(db, arena.id)
    return {"mercadopago": oauth.status_payload(conexao)}


@router.post("/oauth/desconectar")
def desconectar(
    user: User = Depends(get_current_manager),
    db: Session = Depends(get_db),
):
    arena = manager_arena_or_404(db, user)
    conexao = oauth.connection_for_arena(db, arena.id)
    if conexao is None:
        raise HTTPException(status_code=404, detail="Nenhuma conta conectada")
    oauth.disconnect(db, conexao)
    db.commit()
    return {"ok": True, "mercadopago": oauth.status_payload(None)}
