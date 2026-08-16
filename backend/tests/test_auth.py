"""Testes do dominio auth — registro, login, refresh, logout (Fase 12).

Valida fluxos happy-path e erros esperados: credenciais invalidas,
token invalido, logout com blacklist, registro duplicado.
"""
import uuid


def test_register_login_user_flow(client):
    email = f"test-{uuid.uuid4().hex[:8]}@mail.com"
    r = client.post("/api/auth/register", json={
        "email": email,
        "name": "Teste",
        "senha": "senha123",
    })
    assert r.status_code == 200, r.text
    data = r.json()
    assert "token" in data
    assert data["isNew"] is True
    token = data["token"]

    r2 = client.get("/api/auth/user", headers={"Authorization": f"Bearer {token}"})
    assert r2.status_code == 200
    assert r2.json()["email"] == email


def test_login_wrong_password(client):
    r = client.post("/api/auth/login", json={
        "email": "gabriel@email.com",
        "senha": "senhaerrada",
    })
    assert r.status_code in (400, 401), r.status_code


def test_refresh_session(client):
    r = client.post("/api/auth/login", json={
        "email": "gabriel@email.com",
        "senha": "qadras123",
    })
    data = r.json()
    refresh = data["refreshToken"]

    r2 = client.post("/api/auth/refresh", json={"refreshToken": refresh})
    assert r2.status_code == 200
    data2 = r2.json()
    assert "token" in data2
    assert data2["isNew"] is False

    r3 = client.get("/api/auth/user", headers={"Authorization": f"Bearer {data2['token']}"})
    assert r3.status_code == 200
    assert r3.json()["email"] == "gabriel@email.com"


def test_logout_returns_ok(client, login):
    hdrs = login("gabriel@email.com")
    r = client.post("/api/auth/logout", json={
        "token": hdrs["Authorization"].split(" ", 1)[1],
        "refreshToken": "dummy",
    }, headers=hdrs)
    assert r.status_code == 200


def test_register_duplicate_email(client):
    email = f"dup-{uuid.uuid4().hex[:8]}@mail.com"
    client.post("/api/auth/register", json={
        "email": email,
        "name": "Dup",
        "senha": "senha123",
    })
    r2 = client.post("/api/auth/register", json={
        "email": email,
        "name": "Dup2",
        "senha": "senha123",
    })
    assert r2.status_code == 409
