"""Testes do dominio pagamento — fluxo completo e idempotência (Fase 12).

Cria reserva (jogador) → pagar (intent Pix) → webhook confirm → reserva
transita de pending_payment → payment_confirmed → requested; pagamento
idempotente no replay.
"""
import uuid
from datetime import date, timedelta

_SLOT_COUNTER = 40


def _next_slot():
    global _SLOT_COUNTER
    _SLOT_COUNTER += 1
    return (date.today() + timedelta(days=_SLOT_COUNTER)).isoformat(), "20:00"


def _create_booking(client, hdrs, court_id, *, date_, hora="20:00"):
    r = client.post(
        "/api/reservas",
        headers={**hdrs, "Idempotency-Key": str(uuid.uuid4())},
        json={
            "quadraId": court_id,
            "data": date_,
            "hora": hora,
            "dur": 1,
            "plano": "avulso",
            "pagamento": "pix",
        },
    )
    assert r.status_code == 200, r.text
    return r.json()["reservas"][0]


def test_pagar_reserva(client, login):
    from app.core.database import SessionLocal
    from app.models import Court
    from sqlalchemy import select

    hdrs = login("gabriel@email.com")
    with SessionLocal() as db:
        court = db.execute(select(Court).where(Court.is_active == True)).scalars().first()

    date_, hora = _next_slot()
    booking = _create_booking(client, hdrs, str(court.id), date_=date_, hora=hora)
    rid = booking["id"]

    r = client.post(f"/api/reservas/{rid}/pagar", headers=hdrs)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "payment" in data
    assert data["payment"]["provider"] == "mock"
    assert data["payment"]["qrCode"]
    assert data["replay"] is False


def test_pagar_replay(client, login):
    from app.core.database import SessionLocal
    from app.models import Court
    from sqlalchemy import select

    hdrs = login("gabriel@email.com")
    with SessionLocal() as db:
        court = db.execute(select(Court).where(Court.is_active == True)).scalars().first()

    date_, hora = _next_slot()
    booking = _create_booking(client, hdrs, str(court.id), date_=date_, hora=hora)
    rid = booking["id"]

    r1 = client.post(f"/api/reservas/{rid}/pagar", headers=hdrs)
    assert r1.status_code == 200, r1.text
    payment_id1 = r1.json()["payment"]["id"]

    r2 = client.post(f"/api/reservas/{rid}/pagar", headers=hdrs)
    assert r2.status_code == 200
    assert r2.json()["replay"] is True
    assert r2.json()["payment"]["id"] == payment_id1


def test_webhook_confirm(client, login):
    from app.core.database import SessionLocal
    from app.models import Court
    from sqlalchemy import select

    hdrs = login("gabriel@email.com")
    with SessionLocal() as db:
        court = db.execute(select(Court).where(Court.is_active == True)).scalars().first()

    date_, hora = _next_slot()
    booking = _create_booking(client, hdrs, str(court.id), date_=date_, hora=hora)
    rid = booking["id"]

    r = client.post(f"/api/reservas/{rid}/pagar", headers=hdrs)
    payment = r.json()["payment"]
    prov_ref = payment["providerRef"]

    r2 = client.post("/api/payments/webhook/mock", json={
        "webhookId": f"webhook-{uuid.uuid4().hex[:8]}",
        "status": "confirmed",
        "paymentRef": prov_ref,
        "amountCents": int(payment["amount"] * 100),
    })
    assert r2.status_code == 200
    assert r2.json()["ok"] is True
    assert r2.json()["status"] == "confirmed"

    r3 = client.get(f"/api/reservas/{rid}", headers=hdrs)
    assert r3.status_code == 200
    assert r3.json()["reserva"]["status"] in ("Solicitada", "Confirmada")


def test_webhook_idempotent(client, login):
    from app.core.database import SessionLocal
    from app.models import Court
    from sqlalchemy import select

    hdrs = login("gabriel@email.com")
    with SessionLocal() as db:
        court = db.execute(select(Court).where(Court.is_active == True)).scalars().first()

    date_, hora = _next_slot()
    booking = _create_booking(client, hdrs, str(court.id), date_=date_, hora=hora)
    rid = booking["id"]

    r = client.post(f"/api/reservas/{rid}/pagar", headers=hdrs)
    payment = r.json()["payment"]
    prov_ref = payment["providerRef"]
    wh_id = f"webhook-idempotent-{uuid.uuid4().hex[:8]}"

    r2 = client.post("/api/payments/webhook/mock", json={
        "webhookId": wh_id,
        "status": "confirmed",
        "paymentRef": prov_ref,
        "amountCents": int(payment["amount"] * 100),
    })
    assert r2.status_code == 200

    r3 = client.post("/api/payments/webhook/mock", json={
        "webhookId": wh_id,
        "status": "confirmed",
        "paymentRef": prov_ref,
        "amountCents": int(payment["amount"] * 100),
    })
    assert r3.status_code == 200
    assert r3.json()["replay"] is True
