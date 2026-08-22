"""Configuracoes que salvam de verdade.

A tela nasceu como `data-demo-form`: mostrava "Configuracoes salvas" e nao
gravava nada. Trocar o esporte padrao ou desligar um aviso nao sobrevivia a
fechar o app.

O teste que importa nao e "o PATCH devolve 200" — e que o interruptor MANDE em
alguma coisa. Uma preferencia que o envio nao consulta e pior que preferencia
nenhuma: parece obedecer.
"""
import uuid

from app.models import (
    NOTIF_BOOKING_REJECTED,
    NOTIF_MESSAGE_NEW,
    NOTIF_PAYMENT_CONFIRMED,
    NOTIF_PELADA_FALTAM,
    User,
)
from app.services.notifications import quer_receber


def _conta(client):
    email = f"cfg-{uuid.uuid4().hex[:10]}@teste.com"
    r = client.post("/api/auth/register", json={
        "name": "Config Teste", "email": email, "senha": "Senha123!",
    })
    assert r.status_code == 200, r.text
    d = r.json()
    return {"Authorization": f"Bearer {d['token']}"}, d["user"]["id"]


def _config(client, hdrs):
    r = client.get("/api/perfil/config", headers=hdrs)
    assert r.status_code == 200, r.text
    return r.json()["config"]


def test_padroes_vem_ligados(client):
    h, _ = _conta(client)
    cfg = _config(client, h)
    assert cfg["notifyBooking"] and cfg["notifyReminder"] and cfg["notifyClub"]
    assert cfg["searchRadius"] == 10


def test_grava_e_volta(client):
    h, _ = _conta(client)
    client.patch("/api/perfil/config", headers=h, json={"notifyReminder": False})
    assert _config(client, h)["notifyReminder"] is False


def test_patch_parcial_nao_derruba_o_resto(client):
    """A distincao que torna isso utilizavel: AUSENTE e diferente de FALSE.

    Sem ela, salvar o esporte padrao desligaria os avisos junto — e a pessoa
    so descobriria quando o lembrete nao chegasse.
    """
    h, _ = _conta(client)
    client.patch("/api/perfil/config", headers=h, json={"notifyReminder": False})
    client.patch("/api/perfil/config", headers=h, json={"favoriteSport": "Futsal", "searchRadius": 25})

    cfg = _config(client, h)
    assert cfg["favoriteSport"] == "Futsal"
    assert cfg["searchRadius"] == 25
    assert cfg["notifyBooking"] is True    # nao foi tocado
    assert cfg["notifyReminder"] is False  # continua desligado


def test_raio_absurdo_e_recusado(client):
    h, _ = _conta(client)
    assert client.patch("/api/perfil/config", headers=h, json={"searchRadius": 9999}).status_code == 422
    assert client.patch("/api/perfil/config", headers=h, json={"searchRadius": 0}).status_code == 422


def test_config_exige_login(client):
    assert client.get("/api/perfil/config").status_code == 401


# ─────────────── o que faz a preferencia valer alguma coisa ────────────────

def test_desligar_o_aviso_para_o_envio(client, db_session):
    """Sem isto, o interruptor mudava um booleano e o push continuava saindo."""
    h, uid = _conta(client)
    assert quer_receber(db_session, uid, NOTIF_PAYMENT_CONFIRMED) is True

    client.patch("/api/perfil/config", headers=h, json={"notifyBooking": False})
    db_session.expire_all()
    assert quer_receber(db_session, uid, NOTIF_PAYMENT_CONFIRMED) is False
    # e os outros grupos seguem intactos
    assert quer_receber(db_session, uid, NOTIF_MESSAGE_NEW) is True
    assert quer_receber(db_session, uid, NOTIF_PELADA_FALTAM) is True


def test_avisos_de_problema_nao_podem_ser_desligados(client, db_session):
    """Reserva RECUSADA nao esta sob nenhum interruptor, de proposito.

    Nao e novidade agradavel que a pessoa optou por receber: e a informacao de
    que o jogo dela nao vai acontecer. Silenciar por omissao esconderia
    justamente o que ela precisa saber.
    """
    h, uid = _conta(client)
    client.patch("/api/perfil/config", headers=h, json={
        "notifyBooking": False, "notifyReminder": False, "notifyClub": False,
    })
    db_session.expire_all()
    assert quer_receber(db_session, uid, NOTIF_BOOKING_REJECTED) is True


def test_evento_desconhecido_e_enviado(db_session):
    """Evento sem dono no mapa passa. Silenciar por omissao faria um aviso novo
    nascer mudo e ninguem perceber."""
    u = db_session.query(User).first()
    assert quer_receber(db_session, u.id, "evento.que.nao.existe") is True
