"""Testes do dominio pagamento — fluxo completo e idempotência (Fase 12).

Cria reserva (jogador) → pagar (intent Pix) → webhook confirm → reserva
transita de pending_payment → payment_confirmed → requested; pagamento
idempotente no replay.
"""
import uuid
from datetime import date, timedelta

from conftest import WEBHOOK_HEADERS

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

    r2 = client.post("/api/payments/webhook/mock", headers=WEBHOOK_HEADERS, json={
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

    r2 = client.post("/api/payments/webhook/mock", headers=WEBHOOK_HEADERS, json={
        "webhookId": wh_id,
        "status": "confirmed",
        "paymentRef": prov_ref,
        "amountCents": int(payment["amount"] * 100),
    })
    assert r2.status_code == 200

    r3 = client.post("/api/payments/webhook/mock", headers=WEBHOOK_HEADERS, json={
        "webhookId": wh_id,
        "status": "confirmed",
        "paymentRef": prov_ref,
        "amountCents": int(payment["amount"] * 100),
    })
    assert r3.status_code == 200
    assert r3.json()["replay"] is True


def _uma_quadra():
    from app.core.database import SessionLocal
    from app.models import Court
    from sqlalchemy import select

    with SessionLocal() as db:
        return str(db.execute(select(Court).where(Court.is_active == True)).scalars().first().id)


def test_sincronizar_e_a_rede_de_seguranca_do_webhook(client, login):
    """Webhook falha; o dinheiro nao. Esta rota existe para isso.

    Sem ela, uma notificacao perdida — `notification_url` esquecida no
    ambiente, deploy no instante errado, rede — deixa a reserva morrendo em
    `pending_payment` com o Pix ja pago, e a unica saida e mexer no banco.
    """
    hdrs = login("gabriel@email.com")
    date_, hora = _next_slot()
    booking = _create_booking(client, hdrs, _uma_quadra(), date_=date_, hora=hora)
    pid = client.post(f"/api/reservas/{booking['id']}/pagar", headers=hdrs).json()["payment"]["id"]

    # Com o mock nao ha o que conciliar, mas a rota tem de responder sem
    # explodir — e e esse contrato que o provider real vai herdar.
    r = client.post(f"/api/payments/{pid}/sincronizar", headers=hdrs)
    assert r.status_code == 200, r.text
    assert r.json()["ok"] is True


def test_sincronizar_nao_vaza_pagamento_de_outro(client, login):
    """Mesma autorizacao da consulta: dono ou admin, e mais ninguem."""
    hdrs = login("gabriel@email.com")
    date_, hora = _next_slot()
    booking = _create_booking(client, hdrs, _uma_quadra(), date_=date_, hora=hora)
    pid = client.post(f"/api/reservas/{booking['id']}/pagar", headers=hdrs).json()["payment"]["id"]

    outro = login("dono@arenabolanarede.com.br")
    assert client.post(f"/api/payments/{pid}/sincronizar", headers=outro).status_code == 403


def _pagar_e_confirmar(client, login, hdrs, hora):
    """Reserva paga e CONFIRMADA — o unico estado em que ha o que estornar."""
    date_, _ = _next_slot()
    booking = _create_booking(client, hdrs, _uma_quadra(), date_=date_, hora=hora)
    pay = client.post(f"/api/reservas/{booking['id']}/pagar", headers=hdrs).json()["payment"]
    wh = f"webhook-{uuid.uuid4().hex[:8]}"
    r = client.post("/api/payments/webhook/mock", headers=WEBHOOK_HEADERS, json={
        "webhookId": wh,
        "status": "confirmed",
        "paymentRef": pay["providerRef"],
        "amountCents": int(pay["amount"] * 100),
    })
    assert r.status_code == 200, r.text
    return booking, pay


def _status_pagamento(client, hdrs, pid):
    return client.get(f"/api/payments/{pid}", headers=hdrs).json()["payment"]["status"]


def test_recusar_estorna_o_que_foi_pago(client, login):
    """O incentivo nao pode ficar invertido.

    O estorno so existia quando a arena IGNORAVA a solicitacao ate vencer.
    Recusar ativamente deixava o dinheiro na conta dela — ou seja, ignorar era
    melhor para o jogador do que receber um nao.
    """
    hdrs = login("gabriel@email.com")
    booking, pay = _pagar_e_confirmar(client, login, hdrs, "21:00")
    assert _status_pagamento(client, hdrs, pay["id"]) == "confirmed"

    gerente = login("dono@arenabolanarede.com.br")
    r = client.post(f"/api/reservas/{booking['id']}/recusar", headers=gerente,
                    json={"motivo": "Quadra em manutencao"})
    assert r.status_code == 200, r.text
    assert _status_pagamento(client, hdrs, pay["id"]) == "refunded"


def test_cancelar_estorna_o_que_foi_pago(client, login):
    """Mesma regra do recusar: devolucao integral (decisao de 23/09/2026)."""
    hdrs = login("gabriel@email.com")
    booking, pay = _pagar_e_confirmar(client, login, hdrs, "22:00")

    r = client.post(f"/api/reservas/{booking['id']}/cancelar", headers=hdrs,
                    json={"motivo": "Nao vou conseguir ir"})
    assert r.status_code == 200, r.text
    assert _status_pagamento(client, hdrs, pay["id"]) == "refunded"


def test_recusar_reserva_nao_paga_nao_inventa_estorno(client, login):
    """Sem pagamento confirmado nao ha o que devolver — e nada deve quebrar."""
    hdrs = login("gabriel@email.com")
    date_, _ = _next_slot()
    booking = _create_booking(client, hdrs, _uma_quadra(), date_=date_, hora="19:00")

    gerente = login("dono@arenabolanarede.com.br")
    r = client.post(f"/api/reservas/{booking['id']}/recusar", headers=gerente,
                    json={"motivo": "Sem pagamento"})
    assert r.status_code in (200, 409), r.text
