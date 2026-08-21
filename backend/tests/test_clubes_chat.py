"""Leitura do mural do clube — Fase 18.

`club_messages` nasceu sem controle de leitura nenhum. Sem saber o que ja foi
lido nao ha badge nem aviso: "mensagem nova" e uma comparacao, e faltava o
outro lado dela.

Tres armadilhas, todas cravadas aqui:
  - quem NUNCA abriu conta a partir de quando ENTROU, nao do zero;
  - a propria mensagem nao conta;
  - quem leu, saiu e voltou nao recebe o historico de novo.
"""
import uuid


def _conta(client, nome="Membro") -> tuple[dict, str]:
    email = f"chat-{uuid.uuid4().hex[:10]}@teste.com"
    r = client.post("/api/auth/register", json={
        "email": email, "name": nome, "senha": "senha123",
    })
    assert r.status_code == 200, r.text
    d = r.json()
    return {"Authorization": f"Bearer {d['token']}"}, d["user"]["id"]


def _clube(client, hdrs):
    r = client.post("/api/clubes", headers=hdrs, json={
        "name": f"Chat {uuid.uuid4().hex[:6]}", "sport": "Futsal",
        "city": "Goiânia", "state": "GO",
    })
    assert r.status_code == 200, r.text
    return r.json()["clube"]


def _badge(client, hdrs) -> int:
    r = client.get("/api/mensagens/nav/badges", headers=hdrs)
    assert r.status_code == 200, r.text
    return r.json().get("msg_clube", 0)


def _manda(client, hdrs, club_id, texto):
    r = client.post(f"/api/clubes/{club_id}/mensagens", headers=hdrs, json={"text": texto})
    assert r.status_code == 200, r.text


def test_mensagem_de_outro_conta(client):
    dono, _ = _conta(client, "Dono")
    club = _clube(client, dono)
    membro, _ = _conta(client, "Membro")
    client.post(f"/api/clubes/{club['id']}/entrar", headers=membro)

    assert _badge(client, membro) == 0
    _manda(client, dono, club["id"], "bora quinta?")
    assert _badge(client, membro) == 1
    _manda(client, dono, club["id"], "confirma ai")
    assert _badge(client, membro) == 2


def test_a_propria_mensagem_nao_conta(client):
    """Mandar no mural e sair da tela nao pode criar um nao-lido de si mesmo."""
    dono, _ = _conta(client)
    club = _clube(client, dono)
    _manda(client, dono, club["id"], "primeiro aviso")
    assert _badge(client, dono) == 0


def test_marcar_lido_zera(client):
    dono, _ = _conta(client)
    club = _clube(client, dono)
    membro, _ = _conta(client)
    client.post(f"/api/clubes/{club['id']}/entrar", headers=membro)
    _manda(client, dono, club["id"], "oi")
    assert _badge(client, membro) == 1

    r = client.post(f"/api/clubes/{club['id']}/mensagens/read", headers=membro)
    assert r.status_code == 200 and r.json()["naoLidas"] == 0
    assert _badge(client, membro) == 0


def test_ler_as_mensagens_nao_marca_como_lido(client):
    """O GET nao marca — senao o aviso persistente sumiria antes de ser visto.

    Quem abre a tela do clube para ver a proxima pelada passa pelo GET; o
    aviso tem de sobreviver ate a pessoa abrir a aba de conversa.
    """
    dono, _ = _conta(client)
    club = _clube(client, dono)
    membro, _ = _conta(client)
    client.post(f"/api/clubes/{club['id']}/entrar", headers=membro)
    _manda(client, dono, club["id"], "aviso")

    r = client.get(f"/api/clubes/{club['id']}/mensagens", headers=membro)
    assert r.status_code == 200 and len(r.json()["mensagens"]) >= 1
    assert _badge(client, membro) == 1


def test_quem_entra_depois_nao_herda_o_historico(client):
    """A armadilha mais cara: sem o corte pela data de entrada, entrar num
    clube de tres anos daria um badge de centenas de mensagens que nunca
    foram para essa pessoa."""
    dono, _ = _conta(client)
    club = _clube(client, dono)
    for i in range(5):
        _manda(client, dono, club["id"], f"mensagem antiga {i}")

    novato, _ = _conta(client)
    client.post(f"/api/clubes/{club['id']}/entrar", headers=novato)
    assert _badge(client, novato) == 0

    _manda(client, dono, club["id"], "essa sim e nova")
    assert _badge(client, novato) == 1


def test_quem_saiu_e_voltou_nao_recebe_tudo_de_novo(client):
    dono, _ = _conta(client)
    club = _clube(client, dono)
    membro, _ = _conta(client)
    client.post(f"/api/clubes/{club['id']}/entrar", headers=membro)
    _manda(client, dono, club["id"], "antes de sair")

    client.post(f"/api/clubes/{club['id']}/mensagens/read", headers=membro)
    client.post(f"/api/clubes/{club['id']}/sair", headers=membro)
    client.post(f"/api/clubes/{club['id']}/entrar", headers=membro)
    assert _badge(client, membro) == 0


def test_sem_clube_o_badge_e_zero(client):
    solitario, _ = _conta(client)
    assert _badge(client, solitario) == 0


def test_badge_soma_os_clubes(client):
    """O contador da navegacao e um so; o total tem de somar todos."""
    visitante, _ = _conta(client)
    for _ in range(2):
        dono, _ = _conta(client)
        club = _clube(client, dono)
        client.post(f"/api/clubes/{club['id']}/entrar", headers=visitante)
        _manda(client, dono, club["id"], "novidade")
    assert _badge(client, visitante) == 2


def test_nao_membro_nao_marca_leitura(client):
    dono, _ = _conta(client)
    club = _clube(client, dono)
    estranho, _ = _conta(client)
    r = client.post(f"/api/clubes/{club['id']}/mensagens/read", headers=estranho)
    assert r.status_code == 403
