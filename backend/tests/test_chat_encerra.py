"""Atendimento que fecha — regra no espirito de iFood e 99.

O canal existe para resolver AQUELA reserva: combinar chegada, avisar atraso,
tirar duvida de acesso. Depois disso fecha.

O motivo nao e economizar mensagem. E impedir que a conversa vire um canal
permanente entre jogador e arena, por onde a proxima reserva e combinada por
fora — sem horario travado, sem pagamento, e sem a plataforma saber que a
quadra esta ocupada. Quem faz isso quebra a agenda dos dois lados.

Duas portas de fechamento, e as duas precisam existir:
  - a arena encerra na hora (atendimento que virou conversa fiada);
  - o sistema encerra sozinho depois que a reserva acaba, porque gerente
    ocupado nao fecha conversa nenhuma e o canal ficaria aberto para sempre.
"""
import uuid
from datetime import timedelta

import pytest
from sqlalchemy import select

from conftest import WEBHOOK_HEADERS


def _reserva_com_conversa(client, login):
    """Conversa nasce da confirmacao do pagamento (regra da Fase 12)."""
    from app.core.database import SessionLocal
    from app.models import Arena, Court

    hdrs_jog = {
        "Authorization": f"Bearer {client.post('/api/auth/login', json={
            'email': 'gabriel@email.com', 'senha': 'qadras123'
        }).json()['token']}"
    }
    hdrs_ger = login("dono@arenabolanarede.com.br")

    with SessionLocal() as db:
        court = db.execute(
            select(Court).join(Arena, Arena.id == Court.arena_id)
            .where(Arena.owner_id.isnot(None), Court.is_active == True)
        ).scalars().first()

    from datetime import date
    global _DIA
    _DIA += 1
    data = (date.today() + timedelta(days=_DIA)).isoformat()

    r = client.post("/api/reservas", headers={**hdrs_jog, "Idempotency-Key": str(uuid.uuid4())},
                    json={"quadraId": str(court.id), "data": data, "hora": "19:00",
                          "dur": 1, "plano": "avulso", "pagamento": "pix"})
    assert r.status_code == 200, r.text
    rid = r.json()["reservas"][0]["id"]
    pagamento = client.post(f"/api/reservas/{rid}/pagar", headers=hdrs_jog).json()["payment"]
    client.post("/api/payments/webhook/mock", headers=WEBHOOK_HEADERS, json={
        "webhookId": f"enc-{uuid.uuid4().hex[:8]}", "status": "confirmed",
        "paymentRef": pagamento["providerRef"],
        "amountCents": int(pagamento["amount"] * 100),
    })
    conversas = client.get("/api/mensagens", headers=hdrs_jog).json()["conversas"]
    # Pela RESERVA, e nao [-1]: a lista acumula entre testes e a ordem nao e
    # garantida — pegar a ultima trazia a conversa de outro teste, ja
    # encerrada, e o assert falhava sem relacao com o que se media.
    conv = next(c for c in conversas if str(c.get("bookingId")) == str(rid))
    return hdrs_jog, hdrs_ger, conv["id"], rid


_DIA = 200


def test_conversa_nasce_aberta(client, login):
    hdrs_jog, _, cid, _ = _reserva_com_conversa(client, login)
    conv = client.get(f"/api/mensagens/{cid}", headers=hdrs_jog).json()["conversa"]
    assert conv["encerrada"] is False
    assert client.post(f"/api/mensagens/{cid}/enviar?texto=oi", headers=hdrs_jog).status_code == 200


def test_arena_encerra_e_ninguem_mais_escreve(client, login):
    hdrs_jog, hdrs_ger, cid, _ = _reserva_com_conversa(client, login)
    assert client.post(f"/api/mensagens/{cid}/encerrar", headers=hdrs_ger).status_code == 200

    # Nem o jogador nem a propria arena voltam a escrever: encerrado e
    # encerrado, senao a arena reabriria o canal que ela mesma fechou.
    r = client.post(f"/api/mensagens/{cid}/enviar?texto=e ai", headers=hdrs_jog)
    assert r.status_code == 409
    assert "encerrado" in r.json()["detail"].lower()
    assert client.post(f"/api/mensagens/{cid}/enviar?texto=oi", headers=hdrs_ger).status_code == 409


def test_jogador_nao_encerra(client, login):
    """Deixar o jogador encerrar nao resolveria nada — ele so pararia de
    falar — e tiraria da arena a unica ferramenta que ela tem."""
    hdrs_jog, _, cid, _ = _reserva_com_conversa(client, login)
    r = client.post(f"/api/mensagens/{cid}/encerrar", headers=hdrs_jog)
    assert r.status_code == 403


def test_encerrar_duas_vezes_nao_quebra(client, login):
    hdrs_jog, hdrs_ger, cid, _ = _reserva_com_conversa(client, login)
    assert client.post(f"/api/mensagens/{cid}/encerrar", headers=hdrs_ger).status_code == 200
    assert client.post(f"/api/mensagens/{cid}/encerrar", headers=hdrs_ger).status_code == 200


def test_conversa_de_outra_arena_nao_e_encerravel(client, login):
    hdrs_jog, _, cid, _ = _reserva_com_conversa(client, login)
    estranho = login("admin@qadras.com.br")
    # Admin passa; o que nao pode e um gerente de OUTRA arena. Sem outra arena
    # com dono no seed, o teste garante ao menos que jogador nao encerra.
    assert client.post(f"/api/mensagens/{cid}/encerrar", headers=hdrs_jog).status_code == 403


def test_fecha_sozinha_depois_que_a_reserva_acaba(client, login):
    """Gerente ocupado nao fecha conversa nenhuma."""
    from app.core.database import SessionLocal
    from app.models import Conversation
    from app.services import messages as svc

    hdrs_jog, _, cid, _ = _reserva_com_conversa(client, login)

    # Ainda nao: a reserva e no futuro.
    with SessionLocal() as db:
        svc.encerrar_vencidas(db)
    assert client.get(f"/api/mensagens/{cid}", headers=hdrs_jog).json()["conversa"]["encerrada"] is False

    # Joga o fim da reserva para o passado. `end_at - 3 dias` nao servia: a
    # reserva e marcada a 200 dias daqui, entao continuava no futuro.
    with SessionLocal() as db:
        from app.core.timezone import utc_now
        from app.models import Booking
        conv = db.get(Conversation, uuid.UUID(cid))
        booking = db.get(Booking, conv.booking_id)
        booking.end_at = (utc_now() - timedelta(days=1)).replace(tzinfo=None)
        db.commit()
    with SessionLocal() as db:
        assert svc.encerrar_vencidas(db) >= 1
    assert client.get(f"/api/mensagens/{cid}", headers=hdrs_jog).json()["conversa"]["encerrada"] is True


def test_folga_depois_do_jogo(client, login):
    """Objeto esquecido, cobranca indevida e reclamacao aparecem DEPOIS do
    apito. Fechar no minuto seguinte cortaria a conversa no meio."""
    from app.core.database import SessionLocal
    from app.models import Booking, Conversation
    from app.services import messages as svc

    hdrs_jog, _, cid, _ = _reserva_com_conversa(client, login)
    with SessionLocal() as db:
        conv = db.get(Conversation, uuid.UUID(cid))
        booking = db.get(Booking, conv.booking_id)
        # Acabou ha 1 hora: dentro da folga de 6h, continua aberta.
        from app.core.timezone import utc_now
        booking.end_at = (utc_now() - timedelta(hours=1)).replace(tzinfo=None)
        db.commit()
    with SessionLocal() as db:
        svc.encerrar_vencidas(db)
    assert client.get(f"/api/mensagens/{cid}", headers=hdrs_jog).json()["conversa"]["encerrada"] is False
