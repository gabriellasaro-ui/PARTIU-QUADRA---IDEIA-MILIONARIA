"""Regressao dos bloqueadores encontrados na auditoria de 17/08/2026.

Cada teste aqui reproduz um defeito que existia e passou a ser impossivel:

1. slot cancelado/expirado ficava preso para sempre (UNIQUE cru) -> HTTP 500;
2. webhook de pagamento sem assinatura nem conferencia de valor confirmava
   reserva de graca;
3. logout nao revogava a sessao no banco (so na blacklist do Redis);
4. cadastro aceitava qualquer coisa como e-mail e senha.
"""
import uuid
from datetime import date, timedelta

from conftest import WEBHOOK_HEADERS

# Dias proprios deste modulo, para nao colidir com o seed nem com os outros
# arquivos de teste (que tambem criam reservas).
_DIA = 200


def _proximo_dia() -> str:
    global _DIA
    _DIA += 1
    return (date.today() + timedelta(days=_DIA)).isoformat()


def _quadra_ativa() -> str:
    from app.core.database import SessionLocal
    from app.models import Court
    from sqlalchemy import select

    with SessionLocal() as db:
        court = db.execute(
            select(Court).where(Court.is_active == True)  # noqa: E712
        ).scalars().first()
        return str(court.id)


def _reservar(client, hdrs, court_id, dia, hora="21:00", dur=1):
    return client.post(
        "/api/reservas",
        headers={**hdrs, "Idempotency-Key": str(uuid.uuid4())},
        json={
            "quadraId": court_id,
            "data": dia,
            "hora": hora,
            "dur": dur,
            "plano": "avulso",
            "pagamento": "pix",
        },
    )


# --- 1. Slot volta a ficar livre -------------------------------------------

def test_slot_reusado_apos_cancelamento(client, login):
    """Era o pior defeito: cancelar matava o horario para sempre (500)."""
    hdrs = login("gabriel@email.com")
    quadra, dia = _quadra_ativa(), _proximo_dia()

    primeira = _reservar(client, hdrs, quadra, dia)
    assert primeira.status_code == 200, primeira.text
    rid = primeira.json()["reservas"][0]["id"]

    cancelou = client.post(f"/api/reservas/{rid}/cancelar", headers=hdrs, json={})
    assert cancelou.status_code == 200, cancelou.text

    segunda = _reservar(client, hdrs, quadra, dia)
    assert segunda.status_code == 200, (
        f"slot cancelado continua bloqueado: {segunda.status_code} {segunda.text}"
    )
    assert segunda.json()["reservas"][0]["id"] != rid


def test_slot_ocupado_por_reserva_viva_segue_bloqueado(client, login):
    """A correcao nao pode ter aberto a porta para double-booking."""
    hdrs = login("gabriel@email.com")
    quadra, dia = _quadra_ativa(), _proximo_dia()

    assert _reservar(client, hdrs, quadra, dia).status_code == 200
    repetida = _reservar(client, hdrs, quadra, dia)
    assert repetida.status_code == 409, repetida.text


def test_sobreposicao_parcial_ainda_bloqueia(client, login):
    """14h por 2h e depois 15h por 1h: start_at difere, mas sobrepoe."""
    hdrs = login("gabriel@email.com")
    quadra, dia = _quadra_ativa(), _proximo_dia()

    longa = _reservar(client, hdrs, quadra, dia, hora="14:00", dur=2)
    assert longa.status_code == 200, longa.text

    dentro = _reservar(client, hdrs, quadra, dia, hora="15:00", dur=1)
    assert dentro.status_code == 409, dentro.text


# --- 2. Webhook de pagamento -----------------------------------------------

def _reserva_com_cobranca(client, hdrs):
    quadra, dia = _quadra_ativa(), _proximo_dia()
    reserva = _reservar(client, hdrs, quadra, dia)
    assert reserva.status_code == 200, reserva.text
    rid = reserva.json()["reservas"][0]["id"]
    cobranca = client.post(f"/api/reservas/{rid}/pagar", headers=hdrs)
    assert cobranca.status_code == 200, cobranca.text
    return rid, cobranca.json()["payment"]


def _status_da_reserva(client, hdrs, rid) -> str:
    r = client.get(f"/api/reservas/{rid}", headers=hdrs)
    assert r.status_code == 200, r.text
    return r.json()["reserva"]["status"]


def test_webhook_sem_segredo_nao_confirma(client, login):
    """Callback forjado pelo proprio jogador, sem provar quem e."""
    hdrs = login("gabriel@email.com")
    rid, pagamento = _reserva_com_cobranca(client, hdrs)

    forjado = client.post(
        "/api/payments/webhook/mock",
        json={
            "webhookId": f"forjado-{uuid.uuid4().hex}",
            "paymentRef": pagamento["providerRef"],
            "status": "confirmed",
            "amountCents": int(pagamento["amount"] * 100),
        },
    )
    assert forjado.json().get("ok") is False
    assert _status_da_reserva(client, hdrs, rid) == "Aguardando pagamento"


def test_webhook_com_segredo_errado_nao_confirma(client, login):
    hdrs = login("gabriel@email.com")
    rid, pagamento = _reserva_com_cobranca(client, hdrs)

    forjado = client.post(
        "/api/payments/webhook/mock",
        headers={"X-Qadras-Webhook-Secret": "chute-errado"},
        json={
            "webhookId": f"forjado-{uuid.uuid4().hex}",
            "paymentRef": pagamento["providerRef"],
            "status": "confirmed",
            "amountCents": int(pagamento["amount"] * 100),
        },
    )
    assert forjado.json().get("ok") is False
    assert _status_da_reserva(client, hdrs, rid) == "Aguardando pagamento"


def test_webhook_com_valor_divergente_recusado(client, login):
    """Era assim que 1 centavo confirmava uma reserva de R$ 130,80."""
    hdrs = login("gabriel@email.com")
    rid, pagamento = _reserva_com_cobranca(client, hdrs)

    trocado = client.post(
        "/api/payments/webhook/mock",
        headers=WEBHOOK_HEADERS,
        json={
            "webhookId": f"centavo-{uuid.uuid4().hex}",
            "paymentRef": pagamento["providerRef"],
            "status": "confirmed",
            "amountCents": 1,
        },
    )
    assert trocado.status_code == 400, trocado.text
    assert _status_da_reserva(client, hdrs, rid) == "Aguardando pagamento"


def test_webhook_sem_valor_recusado(client, login):
    """Omitir o campo nao pode ser um jeito de pular a conferencia."""
    hdrs = login("gabriel@email.com")
    rid, pagamento = _reserva_com_cobranca(client, hdrs)

    sem_valor = client.post(
        "/api/payments/webhook/mock",
        headers=WEBHOOK_HEADERS,
        json={
            "webhookId": f"sem-valor-{uuid.uuid4().hex}",
            "paymentRef": pagamento["providerRef"],
            "status": "confirmed",
        },
    )
    assert sem_valor.status_code == 400, sem_valor.text
    assert _status_da_reserva(client, hdrs, rid) == "Aguardando pagamento"


def test_webhook_correto_confirma(client, login):
    """O caminho legitimo continua funcionando ponta a ponta."""
    hdrs = login("gabriel@email.com")
    rid, pagamento = _reserva_com_cobranca(client, hdrs)

    ok = client.post(
        "/api/payments/webhook/mock",
        headers=WEBHOOK_HEADERS,
        json={
            "webhookId": f"legitimo-{uuid.uuid4().hex}",
            "paymentRef": pagamento["providerRef"],
            "status": "confirmed",
            "amountCents": int(pagamento["amount"] * 100),
        },
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["status"] == "confirmed"
    assert _status_da_reserva(client, hdrs, rid) in ("Solicitada", "Confirmada")


# --- 2b. Prazo da arena conta do pagamento ---------------------------------

def _pagar_e_confirmar(client, hdrs):
    """Leva uma reserva ate `requested` (paga, esperando a arena)."""
    rid, pagamento = _reserva_com_cobranca(client, hdrs)
    ok = client.post(
        "/api/payments/webhook/mock",
        headers=WEBHOOK_HEADERS,
        json={
            "webhookId": f"pago-{uuid.uuid4().hex}",
            "paymentRef": pagamento["providerRef"],
            "status": "confirmed",
            "amountCents": int(pagamento["amount"] * 100),
        },
    )
    assert ok.status_code == 200, ok.text
    return rid


def test_reserva_recem_paga_nao_expira(client, login):
    """Regressao de fuso: `paid_at` gravado em hora local (Sao Paulo) numa
    coluna cuja convencao e UTC fazia a reserva nascer "3 horas velha" no
    SQLite e expirar poucos segundos depois de paga, com o dinheiro retido."""
    from app.core.database import SessionLocal
    from app.services import bookings as svc
    from app.models import Booking
    import uuid as _uuid

    hdrs = login("gabriel@email.com")
    rid = _pagar_e_confirmar(client, hdrs)

    with SessionLocal() as db:
        svc.expire_stale(db)
        booking = db.get(Booking, _uuid.UUID(rid))
        assert booking.status == "requested", (
            f"reserva paga agora mesmo expirou sozinha (status={booking.status})"
        )


def test_reserva_paga_ha_muito_tempo_expira_e_estorna(client, login):
    """O outro lado: passado o prazo, expira E devolve o dinheiro."""
    from datetime import timedelta

    from app.core.database import SessionLocal
    from app.core.timezone import utc_now
    from app.services import bookings as svc
    from app.models import Booking, Payment
    from sqlalchemy import select
    import uuid as _uuid

    hdrs = login("gabriel@email.com")
    rid = _pagar_e_confirmar(client, hdrs)
    alvo = _uuid.UUID(rid)

    with SessionLocal() as db:
        pagamento = db.execute(
            select(Payment).where(Payment.booking_id == alvo)
        ).scalars().first()
        pagamento.paid_at = utc_now() - timedelta(hours=2)
        db.commit()

    with SessionLocal() as db:
        svc.expire_stale(db)
        booking = db.get(Booking, alvo)
        pagamento = db.execute(
            select(Payment).where(Payment.booking_id == alvo)
        ).scalars().first()
        assert booking.status == "expired", booking.status
        assert pagamento.status == "refunded", (
            f"reserva paga expirou sem estorno (pagamento={pagamento.status})"
        )


# --- 3. Logout revoga de verdade -------------------------------------------

def test_logout_invalida_o_access_token(client, login):
    """Sem depender do Redis: a sessao morre no banco."""
    hdrs = login("gabriel@email.com")
    assert client.get("/api/reservas", headers=hdrs).status_code == 200

    saiu = client.post("/api/auth/logout", headers=hdrs, json={})
    assert saiu.status_code == 200, saiu.text

    assert client.get("/api/reservas", headers=hdrs).status_code == 401


# --- 4. Cadastro validado ---------------------------------------------------

def test_register_recusa_email_invalido(client):
    r = client.post(
        "/api/auth/register",
        json={"name": "Fulano Teste", "email": "nao-e-email", "senha": "senha12345"},
    )
    assert r.status_code == 422, r.text


def test_register_recusa_senha_curta(client):
    r = client.post(
        "/api/auth/register",
        json={
            "name": "Fulano Teste",
            "email": f"curta{uuid.uuid4().hex[:8]}@qadras.com.br",
            "senha": "123",
        },
    )
    assert r.status_code == 422, r.text


def test_register_aceita_dados_validos(client):
    r = client.post(
        "/api/auth/register",
        json={
            "name": "Fulano Teste",
            "email": f"valido{uuid.uuid4().hex[:8]}@qadras.com.br",
            "senha": "senha-forte-123",
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["token"]
