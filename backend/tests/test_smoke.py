"""Testes de regressão F9–F11 (Fase 12) — smoke test dos endpoints.

Verifica que todos os dominios principais continuam funcionais apos as
mudancas da Fase 12 (rate limit, logging, middleware).
"""
import uuid


def test_health_endpoints(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    data = r.json()
    assert "status" in data
    assert "app" in data

    r2 = client.get("/api/health/ready")
    assert r2.status_code in (200, 503)


def test_quadras_catalog(client):
    r = client.get("/api/quadras")
    assert r.status_code == 200
    data = r.json()
    assert "quadras" in data
    assert isinstance(data["quadras"], list)
    assert len(data["quadras"]) >= 1


def test_quadra_detail(client):
    r = client.get("/api/quadras")
    qid = r.json()["quadras"][0]["id"]
    r2 = client.get(f"/api/quadras/{qid}")
    assert r2.status_code == 200
    assert "quadra" in r2.json()


def test_reservas_list(client, login):
    hdrs = login("gabriel@email.com")
    r = client.get("/api/reservas", headers=hdrs)
    assert r.status_code == 200
    assert "reservas" in r.json()


def test_gerente_dashboard(client, login):
    hdrs = login("dono@arenabolanarede.com.br")
    r = client.get("/api/gerente/dashboard", headers=hdrs)
    assert r.status_code == 200
    assert "kpis" in r.json()


def test_gerente_quadras(client, login):
    hdrs = login("dono@arenabolanarede.com.br")
    r = client.get("/api/gerente/quadras", headers=hdrs)
    assert r.status_code == 200
    assert isinstance(r.json().get("quadras"), list)


def test_devices_register(client, login):
    hdrs = login("gabriel@email.com")
    r = client.post("/api/devices", headers=hdrs, json={
        "fcmToken": f"mock-fcm-token-{uuid.uuid4().hex[:16]}",
    })
    assert r.status_code in (200, 201)


def test_mensagens_nav(client, login):
    hdrs = login("gabriel@email.com")
    r = client.get("/api/mensagens/nav/badges", headers=hdrs)
    assert r.status_code == 200
    assert "msg_jog" in r.json()


def test_favoritos_list(client, login):
    hdrs = login("gabriel@email.com")
    r = client.get("/api/favoritos", headers=hdrs)
    assert r.status_code == 200


def test_notifications_list(client, login):
    hdrs = login("gabriel@email.com")
    r = client.get("/api/notifications", headers=hdrs)
    assert r.status_code == 200


def test_perfil(client, login):
    hdrs = login("gabriel@email.com")
    r = client.get("/api/perfil", headers=hdrs)
    assert r.status_code == 200


def test_carteira(client, login):
    hdrs = login("gabriel@email.com")
    r = client.get("/api/carteira", headers=hdrs)
    assert r.status_code == 200


def test_admin_overview(client, login):
    hdrs = login("admin@qadras.com.br")
    r = client.get("/api/admin/overview", headers=hdrs)
    assert r.status_code == 200


def test_clubes(client, login):
    hdrs = login("gabriel@email.com")
    r = client.get("/api/clubes", headers=hdrs)
    assert r.status_code == 200


def test_peladas(client, login):
    hdrs = login("gabriel@email.com")
    r = client.get("/api/peladas", headers=hdrs)
    assert r.status_code == 200


def test_partidas(client, login):
    hdrs = login("gabriel@email.com")
    r = client.get("/api/partidas/ativa", headers=hdrs)
    assert r.status_code == 200


def test_request_id_header(client):
    r = client.get("/api/health")
    assert "X-Request-Id" in r.headers
