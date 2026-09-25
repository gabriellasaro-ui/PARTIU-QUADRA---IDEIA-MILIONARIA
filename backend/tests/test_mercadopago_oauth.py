"""OAuth do Mercado Pago — o que protege o dinheiro da arena.

Tres coisas aqui, se quebrarem, custam dinheiro de verdade:

  1. `state` forjavel deixaria um atacante amarrar a PROPRIA conta do MP a
     uma arena que nao e dele, e dali em diante receber as reservas dela.
  2. Nao guardar o refresh_token NOVO a cada renovacao so falha 180 dias
     depois, de uma vez, em todas as arenas ao mesmo tempo.
  3. Token em log ou em resposta HTTP e vazamento de credencial de terceiro.
"""
import uuid
from datetime import timedelta

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.core.timezone import now_local
from app.models import Arena
from app.models.mercadopago_connection import MercadoPagoConnection
from app.services import mercadopago_oauth as oauth


@pytest.fixture()
def app_configurada(monkeypatch):
    """A aplicacao MP configurada — sem isso todo caminho responde 503."""
    monkeypatch.setattr(settings, "mercadopago_client_id", "1234567890", raising=False)
    monkeypatch.setattr(settings, "mercadopago_client_secret", "segredo", raising=False)
    monkeypatch.setattr(
        settings,
        "mercadopago_redirect_uri",
        "https://api.qadras.com.br/api/mercadopago/oauth/callback",
        raising=False,
    )


class _Resposta:
    def __init__(self, dados, status_code=200):
        self._dados = dados
        self.status_code = status_code
        self.content = b"x"

    def json(self):
        return self._dados


def _fake_post(dados, status_code=200):
    capturado = {}

    def _post(url, json=None, headers=None, timeout=None):
        capturado["url"] = url
        capturado["corpo"] = json
        return _Resposta(dados, status_code)

    _post.capturado = capturado
    return _post


TOKENS = {
    "access_token": "APP_USR-token-da-arena",
    "refresh_token": "TG-refresh-1",
    "public_key": "APP_USR-public",
    "user_id": 987654321,
    "token_type": "bearer",
    "scope": "offline_access read write",
    "expires_in": 15552000,  # 180 dias
}


def _arena(db):
    return db.execute(select(Arena)).scalars().first()


def _limpar(db, arena_id):
    db.execute(
        MercadoPagoConnection.__table__.delete().where(
            MercadoPagoConnection.arena_id == arena_id
        )
    )
    db.commit()


# ----------------------------------------------------------------- o state

def test_state_roundtrip():
    arena_id = uuid.uuid4()
    assert oauth.ler_state(oauth.montar_state(arena_id)) == arena_id


def test_state_com_assinatura_forjada_e_recusado():
    """O ataque que importa: trocar o arena_id embutido no state."""
    state = oauth.montar_state(uuid.uuid4())
    corpo, _assinatura = state.rsplit(".", 1)
    forjado = f"{corpo}.{'0' * 64}"
    with pytest.raises(oauth.MercadoPagoOAuthError, match="assinatura"):
        oauth.ler_state(forjado)


def test_state_de_outra_arena_nao_cola_com_assinatura_alheia():
    """Colar o corpo de uma arena na assinatura de outra tem de falhar."""
    a = oauth.montar_state(uuid.uuid4())
    b = oauth.montar_state(uuid.uuid4())
    corpo_a = a.rsplit(".", 1)[0]
    assinatura_b = b.rsplit(".", 1)[1]
    with pytest.raises(oauth.MercadoPagoOAuthError):
        oauth.ler_state(f"{corpo_a}.{assinatura_b}")


def test_state_expirado(monkeypatch):
    state = oauth.montar_state(uuid.uuid4())
    monkeypatch.setattr(oauth, "STATE_TTL_S", -1)
    with pytest.raises(oauth.MercadoPagoOAuthError, match="expirado"):
        oauth.ler_state(state)


@pytest.mark.parametrize("ruim", ["", "sem-ponto", "a.b", "!!!.###"])
def test_state_malformado(ruim):
    with pytest.raises(oauth.MercadoPagoOAuthError):
        oauth.ler_state(ruim)


# ------------------------------------------------------------ autorizacao

def test_authorization_url_carrega_o_redirect_do_config(app_configurada):
    url = oauth.authorization_url(uuid.uuid4())
    assert url.startswith("https://auth.mercadopago.com.br/authorization?")
    assert "client_id=1234567890" in url
    assert "response_type=code" in url
    # URL-encoded no querystring.
    assert "api.qadras.com.br%2Fapi%2Fmercadopago%2Foauth%2Fcallback" in url


def test_authorization_url_sem_configuracao_falha(monkeypatch):
    monkeypatch.setattr(settings, "mercadopago_client_id", "", raising=False)
    with pytest.raises(oauth.MercadoPagoOAuthError):
        oauth.authorization_url(uuid.uuid4())


# --------------------------------------------------------- troca do code

def test_exchange_code_grava_a_conexao(db_session, monkeypatch, app_configurada):
    arena = _arena(db_session)
    _limpar(db_session, arena.id)
    post = _fake_post(TOKENS)
    monkeypatch.setattr(oauth.requests, "post", post)

    state = oauth.montar_state(arena.id)
    arena_id, conexao = oauth.exchange_code(db_session, code="COD-1", state=state)
    db_session.commit()

    assert arena_id == arena.id
    assert conexao.access_token == TOKENS["access_token"]
    assert conexao.mp_user_id == "987654321"
    assert conexao.fee_rate == settings.mercadopago_default_fee_rate
    # O redirect_uri tem de ir na troca, identico ao da autorizacao.
    assert post.capturado["corpo"]["redirect_uri"] == settings.mercadopago_redirect_uri
    assert post.capturado["corpo"]["grant_type"] == "authorization_code"
    _limpar(db_session, arena.id)


def test_exchange_code_com_state_invalido_nao_chama_o_mp(
    db_session, monkeypatch, app_configurada
):
    """State ruim tem de barrar ANTES da chamada — senao o code e queimado."""
    def _explode(*a, **k):
        raise AssertionError("nao deveria chamar o Mercado Pago")

    monkeypatch.setattr(oauth.requests, "post", _explode)
    with pytest.raises(oauth.MercadoPagoOAuthError):
        oauth.exchange_code(db_session, code="COD-1", state="lixo.abc")


def test_reconectar_sobrescreve_em_vez_de_duplicar(
    db_session, monkeypatch, app_configurada
):
    arena = _arena(db_session)
    _limpar(db_session, arena.id)
    monkeypatch.setattr(oauth.requests, "post", _fake_post(TOKENS))
    state = oauth.montar_state(arena.id)
    oauth.exchange_code(db_session, code="C1", state=state)
    db_session.commit()

    novos = dict(TOKENS, access_token="APP_USR-segundo", refresh_token="TG-refresh-2")
    monkeypatch.setattr(oauth.requests, "post", _fake_post(novos))
    oauth.exchange_code(db_session, code="C2", state=oauth.montar_state(arena.id))
    db_session.commit()

    linhas = db_session.execute(
        select(MercadoPagoConnection).where(
            MercadoPagoConnection.arena_id == arena.id
        )
    ).scalars().all()
    assert len(linhas) == 1, "duas linhas: a cobranca teria de escolher um token"
    assert linhas[0].access_token == "APP_USR-segundo"
    _limpar(db_session, arena.id)


# ------------------------------------------------------------- renovacao

def test_refresh_guarda_o_refresh_token_NOVO(db_session, monkeypatch, app_configurada):
    """O erro que so aparece em 180 dias: reter o refresh antigo."""
    arena = _arena(db_session)
    _limpar(db_session, arena.id)
    monkeypatch.setattr(oauth.requests, "post", _fake_post(TOKENS))
    _arena_id, conexao = oauth.exchange_code(
        db_session, code="C1", state=oauth.montar_state(arena.id)
    )
    db_session.commit()
    assert conexao.refresh_token == "TG-refresh-1"

    girados = dict(TOKENS, access_token="APP_USR-novo", refresh_token="TG-refresh-2")
    post = _fake_post(girados)
    monkeypatch.setattr(oauth.requests, "post", post)
    atualizada = oauth.refresh_connection(db_session, conexao)
    db_session.commit()

    assert post.capturado["corpo"]["grant_type"] == "refresh_token"
    assert post.capturado["corpo"]["refresh_token"] == "TG-refresh-1"
    assert atualizada.access_token == "APP_USR-novo"
    assert atualizada.refresh_token == "TG-refresh-2"
    _limpar(db_session, arena.id)


def test_precisa_renovar_pelo_prazo():
    perto = MercadoPagoConnection(
        arena_id=uuid.uuid4(),
        access_token="x",
        expires_at=now_local() + timedelta(days=3),
    )
    longe = MercadoPagoConnection(
        arena_id=uuid.uuid4(),
        access_token="x",
        expires_at=now_local() + timedelta(days=120),
    )
    sem_data = MercadoPagoConnection(arena_id=uuid.uuid4(), access_token="x")
    assert oauth.precisa_renovar(perto) is True
    assert oauth.precisa_renovar(longe) is False
    assert oauth.precisa_renovar(sem_data) is True


def test_refresh_sem_refresh_token_diz_para_reconectar(db_session):
    conexao = MercadoPagoConnection(
        arena_id=uuid.uuid4(), access_token="x", refresh_token=None
    )
    with pytest.raises(oauth.MercadoPagoOAuthError, match="reconectar"):
        oauth.refresh_connection(db_session, conexao)


# ----------------------------------------------------- vazamento de token

def test_status_payload_nao_carrega_token_nenhum():
    conexao = MercadoPagoConnection(
        arena_id=uuid.uuid4(),
        access_token="APP_USR-secreto",
        refresh_token="TG-secreto",
        mp_user_id="42",
        expires_at=now_local() + timedelta(days=100),
    )
    payload = oauth.status_payload(conexao)
    texto = repr(payload)
    assert "APP_USR-secreto" not in texto
    assert "TG-secreto" not in texto
    assert payload["conectada"] is True
    assert payload["collectorId"] == "42"


def test_sem_segredo_redige_as_chaves_sensiveis():
    limpo = oauth._sem_segredo(
        {"access_token": "APP_USR-x", "refresh_token": "TG-y", "grant_type": "x"}
    )
    assert limpo["access_token"] == "***"
    assert limpo["refresh_token"] == "***"
    assert limpo["grant_type"] == "x"  # o que nao e segredo continua legivel


def test_disconnect_zera_a_credencial(db_session, monkeypatch, app_configurada):
    """Conexao revogada nao pode voltar a cobrar por acidente."""
    arena = _arena(db_session)
    _limpar(db_session, arena.id)
    monkeypatch.setattr(oauth.requests, "post", _fake_post(TOKENS))
    _a, conexao = oauth.exchange_code(
        db_session, code="C1", state=oauth.montar_state(arena.id)
    )
    db_session.commit()

    oauth.disconnect(db_session, conexao)
    db_session.commit()
    assert conexao.access_token == ""
    assert conexao.refresh_token is None
    assert conexao.revoked_at is not None
    # E some da consulta que a cobranca usa.
    assert oauth.connection_for_arena(db_session, arena.id) is None
    _limpar(db_session, arena.id)


# ------------------------------------------------------------------ rotas

def test_iniciar_exige_gerente(client, login):
    r = client.get(
        "/api/mercadopago/oauth/iniciar", headers=login("gabriel@email.com")
    )
    assert r.status_code == 403


def test_iniciar_sem_autenticacao(client):
    assert client.get("/api/mercadopago/oauth/iniciar").status_code == 401


def test_status_do_gerente_sem_conexao(client, login):
    r = client.get("/api/mercadopago/oauth/status", headers=login("dono@arenabolanarede.com.br"))
    assert r.status_code == 200
    assert r.json()["mercadopago"]["conectada"] is False


def test_callback_com_cancelamento_nao_grava(client):
    """O dono clicou em cancelar na tela do MP."""
    r = client.get("/api/mercadopago/oauth/callback?error=access_denied")
    assert r.status_code == 200
    assert r.json()["ok"] is False


def test_callback_sem_code_nao_grava(client):
    r = client.get("/api/mercadopago/oauth/callback?state=qualquer")
    assert r.status_code == 200
    assert r.json()["ok"] is False
