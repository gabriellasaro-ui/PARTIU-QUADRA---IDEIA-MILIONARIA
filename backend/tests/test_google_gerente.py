"""Entrar com Google no PAINEL DA ARENA nao pode criar conta de jogador.

O endpoint /api/auth/google e um so, e ate agora ele tinha uma regra unica:
e-mail sem conta -> cria na hora, papel jogador. No app do jogador isso e
exatamente o certo. Na porta do painel e o errado, e de um jeito que se esconde:
a pessoa CLICA, o Google aceita, ela "entra" — e dois passos depois bate num 403
sem nenhuma relacao aparente com o que fez. Pior, fica com uma conta de jogador
presa no e-mail dela, e quando finalmente cadastrar a arena o e-mail ja estara
tomado.

Entao o pedido passa a dizer de qual porta veio (`contexto`). Isso NAO e
permissao — quem decide o papel continua sendo o banco. E so a resposta a "nao
existe": no jogador, cria; no painel, manda cadastrar a arena.
"""
import pytest


@pytest.fixture()
def google_diz(monkeypatch):
    """Faz o Google 'validar' o token e devolver o e-mail que o teste quiser.

    A verificacao real precisa de rede e de uma chave do Google; o que se mede
    aqui e o que o NOSSO codigo faz DEPOIS de o token ser aceito. O import de
    `id_token` acontece dentro da funcao, entao o patch no modulo original
    alcanca a chamada.
    """
    from app.core.config import settings
    monkeypatch.setattr(settings, "google_client_id", "cliente-de-teste.apps.googleusercontent.com")

    def _preparar(email, nome="Fulano de Teste"):
        from google.oauth2 import id_token

        monkeypatch.setattr(
            id_token, "verify_oauth2_token",
            lambda *a, **k: {"email": email, "name": nome, "picture": ""},
        )
    return _preparar


def test_painel_nao_cria_conta_para_email_desconhecido(client, google_diz, db_session):
    from app.models import User

    email = "quadra.nova.sem.conta@example.com"
    google_diz(email)

    r = client.post("/api/auth/google", json={"idToken": "qualquer", "contexto": "gerente"})
    assert r.status_code == 404, r.text
    assert "cadastre sua arena" in r.json()["detail"].lower()

    # E, principalmente: nao sobrou conta nenhuma com esse e-mail.
    assert db_session.query(User).filter(User.email == email).first() is None, \
        "o painel criou uma conta que nao deveria existir"


def test_app_do_jogador_continua_criando(client, google_diz):
    """O caminho antigo nao pode ter mudado — e o contexto e opcional."""
    google_diz("jogador.novo.google@example.com")
    r = client.post("/api/auth/google", json={"idToken": "qualquer"})
    assert r.status_code == 200, r.text
    dados = r.json()
    assert dados["isNew"] is True
    assert dados["user"]["role"] == "jogador"


def test_painel_recusa_conta_de_jogador_com_mensagem_clara(client, google_diz):
    google_diz("gabriel@email.com")  # existe no seed, papel jogador
    r = client.post("/api/auth/google", json={"idToken": "qualquer", "contexto": "gerente"})
    assert r.status_code == 403, r.text
    detalhe = r.json()["detail"].lower()
    # Tem de dizer QUAL porta ela errou; senao a pessoa tenta a mesma de novo.
    assert "jogador" in detalhe and "arena" in detalhe


def test_painel_deixa_entrar_quem_e_dono(client, google_diz):
    google_diz("dono@arenabolanarede.com.br")
    r = client.post("/api/auth/google", json={"idToken": "qualquer", "contexto": "gerente"})
    assert r.status_code == 200, r.text
    assert r.json()["user"]["role"] == "gerente"
    assert r.json()["token"]
