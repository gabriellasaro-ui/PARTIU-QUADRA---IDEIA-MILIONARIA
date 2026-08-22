"""A agenda vinda do servidor — sem mock por tras.

`venues.availability()` tinha `|| DEFAULT_AVAILABILITY`: resposta vazia virava
uma grade inventada e a pessoa escolhia um horario que nao existe, descobrindo
o erro so no POST. O mock saiu, e com ele a rede de seguranca: se esta rota
falhar, a tela fica vazia. Por isso as bordas ficam cravadas aqui.
"""
import uuid
from datetime import date, timedelta


def _quadra(client) -> str:
    r = client.get("/api/quadras")
    assert r.status_code == 200, r.text
    quadras = r.json()["quadras"]
    assert quadras, "seed sem quadra: o resto do arquivo nao testa nada"
    return quadras[0]["id"]


def _slots(client, quadra_id, dia=None):
    q = f"?data={dia}" if dia else ""
    r = client.get(f"/api/quadras/{quadra_id}/horarios{q}")
    assert r.status_code == 200, r.text
    return r.json()["horarios"]


def test_devolve_agenda_real_com_hora_e_status(client):
    slots = _slots(client, _quadra(client))
    assert slots, "agenda vazia hoje — a tela ficaria em branco"
    for s in slots:
        assert set(s) == {"hour", "status"}
        assert s["status"] in {"free", "busy"}
        assert len(s["hour"]) == 5 and s["hour"][2] == ":"


def test_quadra_inexistente_e_404(client):
    r = client.get(f"/api/quadras/{uuid.uuid4()}/horarios")
    assert r.status_code == 404


def test_data_torta_e_422_e_nao_500(client):
    """strptime numa data invalida subia ValueError ate virar 500.

    500 vira alarme de producao e nao diz a ninguem o que fazer; 422 diz.
    """
    for ruim in ("xx", "2026-13-01", "21/08/2026", ""):
        r = client.get(f"/api/quadras/{_quadra(client)}/horarios?data={ruim}")
        assert r.status_code in (200, 422), f"{ruim!r} devolveu {r.status_code}"
        assert r.status_code != 500


def test_reserva_ocupa_o_horario_na_agenda(client):
    """O elo que a tela inteira depende: reservar tem que APAGAR o horario
    da agenda de quem olha depois. Se isso quebrar, dois pagam pela mesma hora.
    """
    quadra = _quadra(client)
    amanha = (date.today() + timedelta(days=1)).isoformat()

    livres = [s["hour"] for s in _slots(client, quadra, amanha) if s["status"] == "free"]
    assert livres, "sem horario livre amanha para o teste"
    alvo = livres[0]

    email = f"agenda-{uuid.uuid4().hex[:8]}@teste.com"
    reg = client.post("/api/auth/register", json={
        "name": "Agenda", "email": email, "senha": "Senha123!",
    })
    hdrs = {
        "Authorization": f"Bearer {reg.json()['token']}",
        "Idempotency-Key": uuid.uuid4().hex,
    }
    r = client.post("/api/reservas", headers=hdrs, json={
        "quadraId": quadra, "data": amanha, "hora": alvo, "dur": 1,
    })
    assert r.status_code == 200, r.text

    depois = {s["hour"]: s["status"] for s in _slots(client, quadra, amanha)}
    assert depois[alvo] == "busy", f"{alvo} continuou livre depois de reservado"


def test_horario_que_ja_passou_nao_pode_ser_reservado(client):
    """O calendario desabilita dia passado, mas isso e guarda de CLIENTE.

    Relogio errado, aba velha ou chamada direta na API passariam por cima.
    """
    quadra = _quadra(client)
    ontem = (date.today() - timedelta(days=1)).isoformat()
    email = f"passado-{uuid.uuid4().hex[:8]}@teste.com"
    reg = client.post("/api/auth/register", json={
        "name": "Passado", "email": email, "senha": "Senha123!",
    })
    r = client.post("/api/reservas", headers={
        "Authorization": f"Bearer {reg.json()['token']}",
        "Idempotency-Key": uuid.uuid4().hex,
    }, json={"quadraId": quadra, "data": ontem, "hora": "10:00", "dur": 1})
    assert r.status_code == 409
