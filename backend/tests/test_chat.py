"""Testes do dominio chat — conversa, envio de mensagens, leitura (Fase 12).

Cria reserva com pagamento confirmado (gera conversa), envia mensagem,
lista conversas, marca como lida, verifica badges.
"""
import uuid
from datetime import date, timedelta

_SLOT_COUNTER = 50


def _next_slot():
    global _SLOT_COUNTER
    _SLOT_COUNTER += 1
    return (date.today() + timedelta(days=_SLOT_COUNTER)).isoformat(), "19:00"


def _setup_conversation(client, login_gerente):
    from app.core.database import SessionLocal
    from app.models import Arena, Court
    from sqlalchemy import select

    hdrs_jog = {
        "Authorization": f"Bearer {client.post('/api/auth/login', json={
            'email': 'gabriel@email.com', 'senha': 'qadras123'
        }).json()['token']}"
    }
    hdrs_ger = login_gerente

    with SessionLocal() as db:
        court = db.execute(
            select(Court)
            .join(Arena, Arena.id == Court.arena_id)
            .where(Arena.owner_id.isnot(None), Court.is_active == True)
        ).scalars().first()

    date_, hora = _next_slot()
    r = client.post(
        "/api/reservas",
        headers={**hdrs_jog, "Idempotency-Key": str(uuid.uuid4())},
        json={
            "quadraId": str(court.id),
            "data": date_,
            "hora": hora,
            "dur": 1,
            "plano": "avulso",
            "pagamento": "pix",
        },
    )
    assert r.status_code == 200, r.text
    rid = r.json()["reservas"][0]["id"]

    r = client.post(f"/api/reservas/{rid}/pagar", headers=hdrs_jog)
    payment = r.json()["payment"]

    client.post("/api/payments/webhook/mock", json={
        "webhookId": f"chat-{uuid.uuid4().hex[:8]}",
        "status": "confirmed",
        "paymentRef": payment["providerRef"],
        "amountCents": int(payment["amount"] * 100),
    })

    return hdrs_jog, hdrs_ger, rid


def test_send_message(client, login):
    hdrs_jog, _, rid = _setup_conversation(client, login("dono@arenabolanarede.com.br"))

    r = client.get("/api/mensagens", headers=hdrs_jog)
    assert r.status_code == 200
    convs = r.json()["conversas"]
    assert len(convs) >= 1

    cid = convs[0]["id"]

    r2 = client.post(
        f"/api/mensagens/{cid}/enviar",
        headers=hdrs_jog,
        params={"texto": "Ola! Preciso de informacoes sobre a quadra."},
    )
    assert r2.status_code == 200, r2.text
    msgs = r2.json()["conversa"]["messages"]
    assert any(m["text"] == "Ola! Preciso de informacoes sobre a quadra." for m in msgs)


def test_list_conversations(client, login):
    hdrs_jog, _, rid = _setup_conversation(client, login("dono@arenabolanarede.com.br"))

    r = client.get("/api/mensagens", headers=hdrs_jog)
    assert r.status_code == 200
    assert isinstance(r.json()["conversas"], list)
    assert len(r.json()["conversas"]) >= 1


def test_mark_read(client, login):
    hdrs_jog, _, rid = _setup_conversation(client, login("dono@arenabolanarede.com.br"))

    r = client.get("/api/mensagens", headers=hdrs_jog)
    cid = r.json()["conversas"][0]["id"]

    client.post(f"/api/mensagens/{cid}/enviar", headers=hdrs_jog, params={"texto": "Teste"})

    r2 = client.post(f"/api/mensagens/{cid}/read", headers=hdrs_jog)
    assert r2.status_code == 200
    assert r2.json()["conversa"]["unread"] is False


def test_badges(client, login):
    hdrs_jog, _, rid = _setup_conversation(client, login("dono@arenabolanarede.com.br"))

    r = client.get("/api/mensagens/nav/badges", headers=hdrs_jog)
    assert r.status_code == 200
    badges = r.json()
    assert "msg_jog" in badges
    assert isinstance(badges["msg_jog"], int)
