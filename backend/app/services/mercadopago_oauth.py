"""OAuth do Mercado Pago — a arena autoriza a Qadras a cobrar na conta dela.

Fluxo (split de pagamentos 1:1, modelo marketplace)
---------------------------------------------------
  1. O dono da arena pede a URL de autorizacao   -> `authorization_url`
  2. Ele autoriza no dominio do MP e volta com `?code=...&state=...`
  3. Trocamos o code por tokens                  -> `exchange_code`
  4. Uma task diaria renova antes dos 180 dias   -> `refresh_if_needed`

O que o MP devolve na troca: `access_token` (180 dias), `refresh_token`,
`public_key`, `user_id` (o collector) e `scope=offline_access`.

POR QUE O `state` E ASSINADO
----------------------------
O callback e uma rota PUBLICA — tem de ser, e o navegador do dono que chega
nela vindo do MP. Se o `state` fosse so o id da arena em texto, qualquer um
poderia chamar o callback com o id de OUTRA arena e amarrar a propria conta
do MP a ela: dali em diante o dinheiro das reservas daquela arena cairia na
conta do atacante. O `state` e um HMAC com o segredo do servidor e vence em
10 minutos — o mesmo prazo do code.

TOKENS NUNCA VAO PARA LOG
-------------------------
`_sem_segredo` existe para isso. Um `logger.info(resposta.json())` bem
intencionado aqui vaza a credencial de acesso a conta de um terceiro, e vaza
para onde quer que os logs sejam enviados.
"""
import base64
import hashlib
import hmac
import logging
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import requests
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.config import settings
from ..core.timezone import now_local
from ..models.mercadopago_connection import MercadoPagoConnection

logger = logging.getLogger(__name__)

AUTH_URL = "https://auth.mercadopago.com.br/authorization"
TOKEN_URL = "https://api.mercadopago.com/oauth/token"

#: Curto de proposito: isto roda dentro do request do dono da arena.
TIMEOUT_S = 15

#: O code do MP vale 10 minutos; o state nao precisa durar mais que ele.
STATE_TTL_S = 600

#: Chaves que jamais podem aparecer em log, nem em mensagem de erro.
_SENSIVEIS = frozenset(
    {"access_token", "refresh_token", "public_key", "client_secret", "code"}
)


class MercadoPagoOAuthError(RuntimeError):
    """Falha na conexao da arena com o Mercado Pago."""


def _sem_segredo(dados: dict) -> dict:
    """Copia do dict com os segredos trocados por asteriscos, pronta para log."""
    return {
        k: ("***" if k in _SENSIVEIS and v else v)
        for k, v in (dados or {}).items()
    }


def _aware(valor: datetime | None) -> datetime | None:
    """Normaliza para UTC consciente.

    O SQLite dos testes devolve datetime NAIVE mesmo em coluna declarada com
    timezone. Comparar naive com aware levanta TypeError, e o sintoma seria a
    task de renovacao quebrando so em teste (ou so em producao, dependendo de
    qual banco tem a linha antiga).
    """
    if valor is None:
        return None
    if valor.tzinfo is None:
        return valor.replace(tzinfo=timezone.utc)
    return valor.astimezone(timezone.utc)


# --------------------------------------------------------------- state HMAC

def _assinar(payload: str) -> str:
    return hmac.new(
        settings.jwt_secret.encode(), payload.encode(), hashlib.sha256
    ).hexdigest()


def montar_state(arena_id) -> str:
    """base64(arena_id:timestamp) + '.' + hmac — opaco ao MP, verificavel aqui."""
    payload = f"{arena_id}:{int(now_local().timestamp())}"
    corpo = base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")
    return f"{corpo}.{_assinar(payload)}"


def ler_state(state: str) -> uuid.UUID:
    """Devolve o arena_id embutido, ou levanta se o state nao presta.

    Devolve UUID, e nao str: a coluna `arena_id` e UUID e o SQLAlchemy recusa
    a string na hora do bind. Converter aqui, no unico lugar que le o state,
    evita que cada chamador lembre de converter — e um esqueceria.

    `compare_digest` e nao `==`: comparacao de string sai no primeiro byte
    diferente e o tempo de resposta entrega, byte a byte, qual seria a
    assinatura correta.
    """
    try:
        corpo, assinatura = (state or "").rsplit(".", 1)
        preenchido = corpo + "=" * (-len(corpo) % 4)
        payload = base64.urlsafe_b64decode(preenchido.encode()).decode()
        bruto, emitido_em = payload.rsplit(":", 1)
        arena_id = uuid.UUID(bruto)
    except (ValueError, AttributeError, UnicodeDecodeError) as exc:
        raise MercadoPagoOAuthError("state malformado") from exc

    if not hmac.compare_digest(assinatura, _assinar(payload)):
        raise MercadoPagoOAuthError("state com assinatura invalida")

    idade = now_local().timestamp() - int(emitido_em)
    if idade > STATE_TTL_S:
        raise MercadoPagoOAuthError("state expirado — recomece a conexao")
    return arena_id


# ------------------------------------------------------------------ chamada

def _postar_token(dados: dict) -> dict:
    """POST /oauth/token. Nunca deixa o corpo da resposta chegar ao log."""
    if not settings.mercadopago_client_id.strip():
        raise MercadoPagoOAuthError(
            "MERCADOPAGO_CLIENT_ID vazio: a aplicacao nao esta configurada"
        )
    corpo = {
        "client_id": settings.mercadopago_client_id.strip(),
        "client_secret": settings.mercadopago_client_secret.strip(),
        **dados,
    }
    # So na troca do code: o refresh herda o ambiente do token que renova.
    if (
        settings.mercadopago_oauth_test_token
        and dados.get("grant_type") == "authorization_code"
    ):
        corpo["test_token"] = True
    try:
        resposta = requests.post(
            TOKEN_URL,
            json=corpo,
            headers={"Accept": "application/json"},
            timeout=TIMEOUT_S,
        )
    except requests.RequestException as exc:
        raise MercadoPagoOAuthError(f"Mercado Pago inacessivel: {exc}") from exc

    if resposta.status_code >= 400:
        # So o status e o grant vao para o log. O corpo de erro do MP ecoa o
        # que foi enviado, inclusive o code.
        logger.warning(
            "oauth mercadopago recusou grant=%s status=%s",
            dados.get("grant_type"),
            resposta.status_code,
        )
        raise MercadoPagoOAuthError(
            f"Mercado Pago recusou a autorizacao ({resposta.status_code})"
        )
    return resposta.json() if resposta.content else {}


# ------------------------------------------------------------------- fluxo

def authorization_url(arena_id) -> str:
    """URL para a qual o dono da arena deve ser mandado."""
    if not settings.mercadopago_client_id.strip():
        raise MercadoPagoOAuthError("Integracao Mercado Pago nao configurada")
    if not settings.mercadopago_redirect_uri.strip():
        raise MercadoPagoOAuthError("MERCADOPAGO_REDIRECT_URI nao configurada")
    params = {
        "client_id": settings.mercadopago_client_id.strip(),
        "response_type": "code",
        "platform_id": "mp",
        # Do config, NUNCA do Host da request: um Host forjado levaria o code
        # do vendedor para o dominio de quem forjou.
        "redirect_uri": settings.mercadopago_redirect_uri.strip(),
        "state": montar_state(arena_id),
    }
    return f"{AUTH_URL}?{urlencode(params)}"


def _gravar(db: Session, arena_id, dados: dict, *, user_id=None) -> MercadoPagoConnection:
    """Cria ou atualiza a conexao da arena com o que o MP devolveu."""
    access_token = (dados.get("access_token") or "").strip()
    if not access_token:
        raise MercadoPagoOAuthError("Mercado Pago nao devolveu access_token")

    expira_em = now_local() + timedelta(seconds=int(dados.get("expires_in") or 0))
    conexao = db.execute(
        select(MercadoPagoConnection).where(
            MercadoPagoConnection.arena_id == arena_id
        )
    ).scalar_one_or_none()

    if conexao is None:
        conexao = MercadoPagoConnection(arena_id=arena_id)
        db.add(conexao)

    conexao.access_token = access_token
    # O refresh tambem e renovado a cada troca: guardar o NOVO. Manter o
    # antigo e o erro que so aparece 180 dias depois, quando ele nao serve
    # mais e toda arena precisa reconectar a mao.
    if dados.get("refresh_token"):
        conexao.refresh_token = dados["refresh_token"]
    conexao.mp_user_id = str(dados.get("user_id") or "") or conexao.mp_user_id
    conexao.public_key = dados.get("public_key") or conexao.public_key
    conexao.token_type = dados.get("token_type") or conexao.token_type
    conexao.scope = (dados.get("scope") or conexao.scope or "")[:120] or None
    conexao.expires_at = expira_em
    conexao.revoked_at = None
    if conexao.fee_rate is None:
        conexao.fee_rate = settings.mercadopago_default_fee_rate
    if user_id is not None:
        conexao.connected_by = user_id
        conexao.connected_at = now_local()
    db.flush()
    return conexao


def exchange_code(db: Session, *, code: str, state: str, user_id=None):
    """Troca o code pela credencial da arena. Devolve (arena_id, conexao)."""
    arena_id = ler_state(state)
    dados = _postar_token(
        {
            "grant_type": "authorization_code",
            "code": (code or "").strip(),
            "redirect_uri": settings.mercadopago_redirect_uri.strip(),
        }
    )
    conexao = _gravar(db, arena_id, dados, user_id=user_id)
    logger.info(
        "mercadopago conectado arena=%s collector=%s", arena_id, conexao.mp_user_id
    )
    return arena_id, conexao


def refresh_connection(db: Session, conexao: MercadoPagoConnection):
    """Renova o par access/refresh. Sem refresh_token nao ha o que fazer."""
    if not conexao.refresh_token:
        raise MercadoPagoOAuthError(
            "Conexao sem refresh_token: a arena precisa reconectar"
        )
    dados = _postar_token(
        {"grant_type": "refresh_token", "refresh_token": conexao.refresh_token}
    )
    return _gravar(db, conexao.arena_id, dados)


def precisa_renovar(conexao: MercadoPagoConnection) -> bool:
    expira = _aware(conexao.expires_at)
    if expira is None:
        return True
    limite = now_local() + timedelta(days=settings.mercadopago_refresh_days_before)
    return expira <= limite


def refresh_if_needed(db: Session, conexao: MercadoPagoConnection):
    if conexao.revoked_at is not None or not precisa_renovar(conexao):
        return conexao
    return refresh_connection(db, conexao)


# ----------------------------------------------------------------- consulta

def connection_for_arena(db: Session, arena_id) -> MercadoPagoConnection | None:
    """Conexao ATIVA da arena (revogada nao serve para cobrar)."""
    return db.execute(
        select(MercadoPagoConnection).where(
            MercadoPagoConnection.arena_id == arena_id,
            MercadoPagoConnection.revoked_at.is_(None),
        )
    ).scalar_one_or_none()


def disconnect(db: Session, conexao: MercadoPagoConnection) -> None:
    """Desconecta sem apagar: os pagamentos historicos apontam para a linha.

    O token e zerado porque uma conexao revogada nao pode voltar a cobrar por
    acidente — deixar a credencial viva num registro "inativo" e como trancar
    a porta e deixar a chave na fechadura.
    """
    conexao.revoked_at = now_local()
    conexao.access_token = ""
    conexao.refresh_token = None
    db.flush()


def status_payload(conexao: MercadoPagoConnection | None) -> dict:
    """Estado da conexao para o painel do gerente. Sem token nenhum."""
    if conexao is None or conexao.revoked_at is not None:
        return {"conectada": False, "expiraEm": None, "precisaRenovar": False}
    expira = _aware(conexao.expires_at)
    return {
        "conectada": True,
        "expiraEm": expira.isoformat() if expira else None,
        "precisaRenovar": precisa_renovar(conexao),
        "collectorId": conexao.mp_user_id,
        "meios": conexao.payment_methods or ["pix"],
        "conectadaEm": (
            _aware(conexao.connected_at).isoformat() if conexao.connected_at else None
        ),
    }
