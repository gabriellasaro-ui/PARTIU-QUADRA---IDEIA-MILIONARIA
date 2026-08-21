"""Forca da senha no cadastro.

Exigencia do dono: maiuscula, minuscula, numero e caractere especial. Vale so
para cadastro NOVO — conta ja existente com senha fraca continua entrando,
porque forcar troca no proximo login e uma decisao de produto, nao um efeito
colateral de validacao.
"""
import uuid


def _cadastrar(client, senha: str):
    return client.post("/api/auth/register", json={
        "name": "Teste Senha",
        "email": f"senha-{uuid.uuid4().hex[:10]}@teste.com",
        "senha": senha,
    })


def test_senha_completa_e_aceita(client):
    r = _cadastrar(client, "Senha123!")
    assert r.status_code == 200, r.text
    assert r.json()["token"]


def test_falta_maiuscula(client):
    r = _cadastrar(client, "senha123!")
    assert r.status_code == 422
    assert "maiúscula" in r.text


def test_falta_numero(client):
    r = _cadastrar(client, "SenhaForte!")
    assert r.status_code == 422
    assert "número" in r.text


def test_falta_caractere_especial(client):
    r = _cadastrar(client, "Senha1234")
    assert r.status_code == 422
    assert "especial" in r.text


def test_curta_demais(client):
    r = _cadastrar(client, "Ab1!")
    assert r.status_code == 422
    assert "8 caracteres" in r.text


def test_lista_todas_as_faltas_de_uma_vez(client):
    """Uma exigencia por tentativa e o jeito mais rapido de fazer alguem
    desistir do cadastro. O erro diz tudo que falta junto."""
    r = _cadastrar(client, "abc")
    assert r.status_code == 422
    corpo = r.text
    assert "8 caracteres" in corpo
    assert "maiúscula" in corpo
    assert "número" in corpo
    assert "especial" in corpo


def test_conta_antiga_com_senha_fraca_continua_entrando(client):
    """A regra vale no CADASTRO. Quem ja tem conta nao e trancado fora dela —
    o seed usa 'qadras123', que a regra nova recusaria."""
    r = client.post("/api/auth/login", json={
        "email": "gabriel@email.com", "senha": "qadras123",
    })
    assert r.status_code == 200, r.text


# ─────────────────────────── troca de senha ────────────────────────────────

def _conta(client, senha="Senha123!"):
    email = f"troca-{uuid.uuid4().hex[:10]}@teste.com"
    r = client.post("/api/auth/register", json={
        "name": "Troca Senha", "email": email, "senha": senha,
    })
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}, email


def test_troca_exige_a_senha_atual(client):
    """O token sobrevive dias. Celular destravado na mao de outra pessoa nao
    pode virar troca de senha — que e o jeito de tomar a conta para sempre."""
    h, _ = _conta(client)
    r = client.post("/api/auth/senha", headers=h,
                    json={"senhaAtual": "Errada1!", "senhaNova": "Nova456@"})
    assert r.status_code == 403


def test_senha_nova_tambem_precisa_ser_forte(client):
    h, _ = _conta(client)
    r = client.post("/api/auth/senha", headers=h,
                    json={"senhaAtual": "Senha123!", "senhaNova": "fraca"})
    assert r.status_code == 422


def test_nova_igual_a_atual_e_recusada(client):
    """Trocar por ela mesma nao troca nada, e responder 200 faria a pessoa
    acreditar que se protegeu."""
    h, _ = _conta(client)
    r = client.post("/api/auth/senha", headers=h,
                    json={"senhaAtual": "Senha123!", "senhaNova": "Senha123!"})
    assert r.status_code == 422


def test_troca_valida_e_a_antiga_para_de_funcionar(client):
    h, email = _conta(client)
    assert client.post("/api/auth/senha", headers=h, json={
        "senhaAtual": "Senha123!", "senhaNova": "Nova456@",
    }).status_code == 200

    assert client.post("/api/auth/login", json={"email": email, "senha": "Nova456@"}).status_code == 200
    assert client.post("/api/auth/login", json={"email": email, "senha": "Senha123!"}).status_code == 401


def test_troca_revoga_as_sessoes(client):
    """Trocar a senha e o que se faz quando se desconfia que alguem entrou.

    Manter os tokens antigos vivos deixaria o invasor dentro justamente depois
    da acao que deveria expulsa-lo.
    """
    h, email = _conta(client)
    # Uma segunda sessao, como se fosse outro aparelho.
    outro = client.post("/api/auth/login", json={"email": email, "senha": "Senha123!"})
    outro_h = {"Authorization": f"Bearer {outro.json()['token']}"}
    assert client.get("/api/perfil", headers=outro_h).status_code == 200

    client.post("/api/auth/senha", headers=h, json={
        "senhaAtual": "Senha123!", "senhaNova": "Nova456@",
    })
    assert client.get("/api/perfil", headers=outro_h).status_code == 401
