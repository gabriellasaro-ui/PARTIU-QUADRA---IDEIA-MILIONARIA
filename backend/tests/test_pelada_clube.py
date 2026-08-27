"""Escolher o clube da pelada depois de criada — e avisar a turma na hora certa.

A pelada nasce quando a arena aprova a reserva, no meio da tela de confirmacao.
Parar ali para perguntar de qual clube ela e arriscaria a pessoa fechar o app e
a pelada nao existir. Entao ela nasce AVULSA (que nao avisa ninguem) e o clube
e escolhido logo depois, por PATCH — e e nesse instante que a turma e avisada.

Antes disso o app usava o primeiro clube da pessoa sem perguntar: quem esta em
dois convocava o errado, e quem so queria jogar com os amigos avisava o clube
inteiro sem querer.
"""
import itertools
import uuid


def _login(client, email):
    r = client.post("/api/auth/login", json={"email": email, "senha": "qadras123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


# Cada pelada precisa do proprio horario: o indice unico de slot recusa duas
# reservas na mesma quadra e hora, e os testes rodam na mesma base.
_SLOT = itertools.count()


def _pelada_avulsa(client, headers):
    """Cria uma reserva confirmada e a pelada dela."""
    quadra = client.get("/api/quadras").json()["quadras"][0]
    from datetime import date, timedelta
    n = next(_SLOT)
    dia = (date.today() + timedelta(days=9 + n)).isoformat()
    r = client.post("/api/reservas", json={
        "quadraId": quadra["id"], "data": dia, "hora": f"{9 + (n % 8):02d}:00",
        "dur": 1, "plano": "avulso", "pagamento": "pix",
    }, headers={**headers, "Idempotency-Key": f"pel-{uuid.uuid4().hex[:8]}"})
    assert r.status_code == 200, r.text
    reserva = r.json()["reservas"][0]

    from app.core.database import SessionLocal
    from app.models import Booking, STATUS_CONFIRMED
    with SessionLocal() as db:
        b = db.get(Booking, uuid.UUID(reserva["id"]))
        b.status = STATUS_CONFIRMED
        db.commit()

    r = client.post("/api/peladas", json={"bookingId": reserva["id"]}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["peladas"][0]


def _clube_com_dois(client, dono_headers, membro_id):
    r = client.post("/api/clubes", json={
        "name": f"Clube {uuid.uuid4().hex[:5]}", "sport": "Futebol Society",
        "city": "Belo Horizonte", "state": "MG",
    }, headers=dono_headers)
    assert r.status_code == 200, r.text
    clube = r.json()["clube"]

    from app.core.database import SessionLocal
    from app.models import ClubMember
    with SessionLocal() as db:
        db.add(ClubMember(club_id=uuid.UUID(clube["id"]), user_id=uuid.UUID(membro_id), role="membro"))
        db.commit()
    return clube


def test_pelada_nasce_avulsa(client):
    """Sem clube escolhido, ninguem e avisado — o padrao seguro."""
    h = _login(client, "gabriel@email.com")
    pelada = _pelada_avulsa(client, h)
    assert pelada["clubId"] in (None, "")
    assert pelada["kind"] == "avulsa"


def test_apontar_para_o_clube_avisa_a_turma(client):
    from app.core.database import SessionLocal
    from app.models import Notification, User

    organizador = _login(client, "gabriel@email.com")
    eu = client.get("/api/perfil", headers=organizador).json()
    meu_id = eu.get("id") or eu.get("perfil", {}).get("id")

    outro = _login(client, "mariana@email.com")
    with SessionLocal() as db:
        outro_user = db.query(User).filter(User.email == "mariana@email.com").one()
        outro_id = str(outro_user.id)

    clube = _clube_com_dois(client, outro, meu_id)
    pelada = _pelada_avulsa(client, organizador)

    def convocacoes():
        with SessionLocal() as db:
            return db.query(Notification).filter(
                Notification.type == "pelada.criada",
                Notification.user_id == uuid.UUID(outro_id),
            ).count()

    antes = convocacoes()
    r = client.patch(f"/api/peladas/{pelada['id']}", json={"clubId": clube["id"]}, headers=organizador)
    assert r.status_code == 200, r.text
    assert r.json()["pelada"]["kind"] == "clube"
    assert convocacoes() == antes + 1, "a turma do clube precisa ser avisada"

    # Repetir o MESMO clube nao reconvoca: o aviso e sobre a mudanca.
    client.patch(f"/api/peladas/{pelada['id']}", json={"clubId": clube["id"]}, headers=organizador)
    assert convocacoes() == antes + 1

    # E voltar para avulsa nao avisa ninguem.
    r = client.patch(f"/api/peladas/{pelada['id']}", json={"clubId": None}, headers=organizador)
    assert r.status_code == 200
    assert r.json()["pelada"]["kind"] == "avulsa"
    assert convocacoes() == antes + 1


def test_so_o_organizador_muda_o_clube(client):
    """Senao qualquer um convocaria a turma dos outros."""
    from app.core.database import SessionLocal
    from app.models import User

    organizador = _login(client, "gabriel@email.com")
    eu = client.get("/api/perfil", headers=organizador).json()
    meu_id = eu.get("id") or eu.get("perfil", {}).get("id")

    outro = _login(client, "mariana@email.com")
    clube = _clube_com_dois(client, outro, meu_id)
    pelada = _pelada_avulsa(client, organizador)

    r = client.patch(f"/api/peladas/{pelada['id']}", json={"clubId": clube["id"]}, headers=outro)
    assert r.status_code == 403


def test_clube_de_quem_nao_e_membro_e_recusado(client):
    organizador = _login(client, "gabriel@email.com")
    dono = _login(client, "rafael@email.com")
    r = client.post("/api/clubes", json={
        "name": f"Fechado {uuid.uuid4().hex[:5]}", "sport": "Futebol Society",
        "city": "Belo Horizonte", "state": "MG",
    }, headers=dono)
    clube = r.json()["clube"]

    pelada = _pelada_avulsa(client, organizador)
    r = client.patch(f"/api/peladas/{pelada['id']}", json={"clubId": clube["id"]}, headers=organizador)
    assert r.status_code == 403
