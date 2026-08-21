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
