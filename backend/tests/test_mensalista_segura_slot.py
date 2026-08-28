"""O mensalista segura as quatro semanas — e as solta quando deixa de valer.

A pergunta que originou este arquivo: "se outra pessoa marcar no mesmo dia e
hora da quadra do mensalista, aparece bloqueado?". A resposta tem tres partes,
e so a primeira estava certa.

1. SEGURAR. As quatro semanas nascem ocupando (`pending_payment` esta em
   ACTIVE_STATUSES), entao a semana 3 — uma SESSAO, nao a reserva que a pessoa
   pediu — recusa outro pedido e ja aparece "busy" na grade. E o teste olha a
   semana 3 de proposito: se o segurar valesse so para a primeira, o furo
   apareceria exatamente ai.

2. SOLTAR NA RECUSA. `reject_booking` mudava so o pai. A arena dizia NAO e as
   tres sessoes seguiam `pending_payment`, ou seja, segurando a quadra por tres
   quintas para uma reserva que ninguem aprovou. Ninguem reclamaria disso como
   bug: a tela so mostra "ocupado", e o dono conclui que vendeu.

3. NAO MORRER SOZINHO. Sessao nao tem pagamento proprio, e `expire_stale`
   varre por status. Quinze minutos depois de criada, a sessao de um mensalista
   JA APROVADO caia na varredura e levava o grupo inteiro junto — inclusive o
   pai `confirmed`, uma transicao que nem existe no mapa. Resultado: excecao no
   meio do laco de manutencao, que e compartilhado com todas as outras
   reservas.
"""
import uuid
from datetime import date, timedelta

import pytest

from tests.conftest import WEBHOOK_HEADERS

from app.core.timezone import now_local
from app.models.booking import (
    ACTIVE_STATUSES,
    STATUS_CONFIRMED,
    STATUS_EXPIRED,
    STATUS_PENDING_PAYMENT,
    STATUS_REJECTED,
    Booking,
)


def _quadra(client) -> dict:
    r = client.get("/api/quadras")
    assert r.status_code == 200, r.text
    lista = r.json().get("venues") or r.json().get("quadras")
    assert lista
    return lista[0]


def _entrar(client, email) -> dict:
    r = client.post("/api/auth/login", json={"email": email, "senha": "qadras123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _hora_livre(client, quadra_id, dia) -> str:
    """Uma hora livre nas QUATRO semanas daquele dia da semana.

    O banco da suite e compartilhado e vai acumulando reservas dos outros
    arquivos, entao hora fixa aqui e um teste que quebra por ordem de execucao
    — sem nada a ver com o que ele mede. Perguntar a grade e o unico jeito
    estavel.
    """
    hoje = date.today()
    primeira = hoje + timedelta(days=(dia - hoje.weekday()) % 7 or 7)
    semanas = [primeira + timedelta(weeks=i) for i in range(4)]
    livres = None
    for quando in semanas:
        r = client.get(f"/api/quadras/{quadra_id}/horarios?data={quando}")
        assert r.status_code == 200, r.text
        agora = {s["hour"] for s in r.json()["horarios"] if s["status"] == "free"}
        livres = agora if livres is None else (livres & agora)
    assert livres, f"nenhuma hora livre nas 4 semanas de weekday={dia}"
    return sorted(livres)[-1]


def _pagar(client, headers, rid):
    """Paga de verdade (intencao + webhook): so assim a reserva vira `requested`.

    So `/pagar` cria a intencao e a reserva segue `pending_payment` — e o
    gerente nao pode aprovar nem recusar o que ainda nao foi pago.
    """
    pg = client.post(f"/api/reservas/{rid}/pagar", headers=headers)
    assert pg.status_code == 200, pg.text
    pagamento = pg.json()["payment"]
    r = client.post("/api/payments/webhook/mock", headers=WEBHOOK_HEADERS, json={
        "webhookId": f"slot-{uuid.uuid4().hex[:8]}", "status": "confirmed",
        "paymentRef": pagamento["providerRef"],
        "amountCents": int(pagamento["amount"] * 100),
    })
    assert r.status_code in (200, 202), r.text


def _marcar(client, headers, quadra_id, *, plano, dia=None, data=None, hora="21:00", chave=""):
    corpo = {"quadraId": quadra_id, "hora": hora, "dur": 1, "plano": plano, "pagamento": "pix"}
    if dia is not None:
        corpo["dia"] = dia
    if data is not None:
        corpo["data"] = data
    return client.post(
        "/api/reservas", json=corpo,
        headers={**headers, "Idempotency-Key": chave or f"{plano}-{dia}-{data}-{hora}"},
    )


def test_sessao_do_mensalista_bloqueia_outro_jogador(client):
    a = _entrar(client, "gabriel@email.com")
    b = _entrar(client, "mariana@email.com")
    quadra = _quadra(client)
    dia = (date.today().weekday() + 2) % 7
    hora = _hora_livre(client, quadra["id"], dia)

    r = _marcar(client, a, quadra["id"], plano="mensalista", dia=dia, chave="segura-1", hora=hora)
    assert r.status_code == 200, r.text
    datas = [x["dateValue"] for x in r.json()["reservas"]]
    assert len(datas) == 4

    # A grade que a pessoa ve, na SEMANA 3: ocupada antes de tentar.
    grade = client.get(f"/api/quadras/{quadra['id']}/horarios?data={datas[2]}")
    assert grade.status_code == 200
    slot = next(s for s in grade.json()["horarios"] if s["hour"] == hora)
    assert slot["status"] != "free", f"semana 3 deveria estar ocupada, veio {slot}"

    # E a garantia dura, que vale mesmo se a tela errar: a API recusa.
    for i, quando in enumerate(datas):
        r = _marcar(client, b, quadra["id"], plano="avulso", data=quando,
                    chave=f"conflito-{i}", hora=hora)
        assert r.status_code == 409, f"semana {i + 1} ({quando}) aceitou por cima: {r.status_code}"


def test_recusa_da_arena_solta_as_semanas_seguintes(client, db_session):
    a = _entrar(client, "gabriel@email.com")
    b = _entrar(client, "mariana@email.com")
    gerente = _entrar(client, "dono@arenabolanarede.com.br")
    quadra = _quadra(client)
    dia = (date.today().weekday() + 3) % 7
    hora = _hora_livre(client, quadra["id"], dia)

    r = _marcar(client, a, quadra["id"], plano="mensalista", dia=dia, chave="recusa-1", hora=hora)
    assert r.status_code == 200, r.text
    reservas = r.json()["reservas"]
    pai, datas = reservas[0]["id"], [x["dateValue"] for x in reservas]

    # Paga (vira `requested`) para a arena poder recusar.
    _pagar(client, a, pai)

    r = client.post(f"/api/reservas/{pai}/recusar", json={"motivo": "quadra em obra"},
                    headers=gerente)
    assert r.status_code == 200, r.text

    import uuid as _uuid
    reserva = db_session.get(Booking, _uuid.UUID(pai))
    db_session.refresh(reserva)
    assert reserva.status == STATUS_REJECTED
    familia = db_session.query(Booking).filter(Booking.group_id == reserva.group_id).all()
    assert len(familia) == 4
    presos = [x for x in familia if x.status in ACTIVE_STATUSES]
    assert not presos, f"recusado, mas {len(presos)} semanas seguem segurando a quadra"

    # E a prova pelo lado de quem quer a quadra: agora entra.
    r = _marcar(client, b, quadra["id"], plano="avulso", data=datas[2], chave="livre-3", hora=hora)
    assert r.status_code == 200, f"semana 3 continua bloqueada apos a recusa: {r.text}"


def test_mensalista_aprovado_nao_expira_com_as_proprias_sessoes(client, db_session):
    """A sessao nao tem pagamento proprio; a varredura nao pode le-la como abandono."""
    from app.services import bookings as svc

    a = _entrar(client, "gabriel@email.com")
    gerente = _entrar(client, "dono@arenabolanarede.com.br")
    quadra = _quadra(client)
    dia = (date.today().weekday() + 4) % 7
    hora = _hora_livre(client, quadra["id"], dia)

    r = _marcar(client, a, quadra["id"], plano="mensalista", dia=dia, chave="expira-1", hora=hora)
    assert r.status_code == 200, r.text
    pai = r.json()["reservas"][0]["id"]

    _pagar(client, a, pai)
    r = client.post(f"/api/reservas/{pai}/aprovar", json={}, headers=gerente)
    assert r.status_code == 200, r.text

    # Bem depois das duas janelas de 15 min.
    svc.expire_stale(db_session, now=now_local() + timedelta(hours=6))
    db_session.commit()

    reserva = db_session.get(Booking, __import__("uuid").UUID(pai))
    db_session.refresh(reserva)
    assert reserva.status == STATUS_CONFIRMED, \
        f"mensalista aprovado virou {reserva.status} sozinho"
    sessoes = db_session.query(Booking).filter(
        Booking.group_id == reserva.group_id, Booking.is_session.is_(True)
    ).all()
    assert all(s.status in ACTIVE_STATUSES for s in sessoes), \
        f"sessoes de um mensalista aprovado expiraram: {[s.status for s in sessoes]}"
