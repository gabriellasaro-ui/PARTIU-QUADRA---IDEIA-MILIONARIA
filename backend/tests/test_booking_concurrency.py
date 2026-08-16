"""Testes de concorrência de reserva — double-booking e idempotência (Fase 12).

Valida que um mesmo slot so aceita uma reserva, e que replay com a mesma
Idempotency-Key devolve a reserva original (replay=true).
"""
import uuid
from datetime import date, timedelta

futuro = (date.today() + timedelta(days=30)).isoformat()


def _create_booking(client, hdrs, court_id, *, date_=None, hora="21:00"):
    return client.post(
        "/api/reservas",
        headers={**hdrs, "Idempotency-Key": str(uuid.uuid4())},
        json={
            "quadraId": court_id,
            "data": date_ or futuro,
            "hora": hora,
            "dur": 1,
            "plano": "avulso",
            "pagamento": "pix",
        },
    )


def test_same_slot_rejected(client, login):
    from app.core.database import SessionLocal
    from app.models import Arena, Court
    from sqlalchemy import select

    hdrs = login("gabriel@email.com")
    with SessionLocal() as db:
        court = db.execute(select(Court).where(Court.is_active == True)).scalars().first()

    r1 = _create_booking(client, hdrs, str(court.id), date_=futuro, hora="22:00")
    assert r1.status_code == 200, r1.text
    assert r1.json()["reservas"]

    r2 = _create_booking(client, hdrs, str(court.id), date_=futuro, hora="22:00")
    assert r2.status_code in (409, 422), r2.status_code


def test_idempotency_replay(client, login):
    from app.core.database import SessionLocal
    from app.models import Arena, Court
    from sqlalchemy import select

    hdrs = login("gabriel@email.com")
    with SessionLocal() as db:
        court = db.execute(select(Court).where(Court.is_active == True)).scalars().first()

    key = str(uuid.uuid4())
    r1 = client.post(
        "/api/reservas",
        headers={**hdrs, "Idempotency-Key": key},
        json={
            "quadraId": str(court.id),
            "data": futuro,
            "hora": "23:00",
            "dur": 1,
            "plano": "avulso",
            "pagamento": "pix",
        },
    )
    assert r1.status_code == 200, r1.text
    id1 = r1.json()["reservas"][0]["id"]

    r2 = client.post(
        "/api/reservas",
        headers={**hdrs, "Idempotency-Key": key},
        json={
            "quadraId": str(court.id),
            "data": futuro,
            "hora": "23:00",
            "dur": 1,
            "plano": "avulso",
            "pagamento": "pix",
        },
    )
    assert r2.status_code == 200
    assert r2.json()["replay"] is True
    assert r2.json()["reservas"][0]["id"] == id1


def test_different_slot_accepted(client, login):
    from app.core.database import SessionLocal
    from app.models import Arena, Court
    from sqlalchemy import select

    hdrs = login("gabriel@email.com")
    with SessionLocal() as db:
        court = db.execute(select(Court).where(Court.is_active == True)).scalars().first()

    r1 = _create_booking(client, hdrs, str(court.id), date_=futuro, hora="19:00")
    assert r1.status_code == 200, r1.text

    r2 = _create_booking(client, hdrs, str(court.id), date_=futuro, hora="20:00")
    assert r2.status_code == 200, r2.text
