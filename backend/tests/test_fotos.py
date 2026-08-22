"""Foto de perfil e escudo do clube.

Gabriel trocou a foto e ela nao mudou. A causa era a mesma da ficha do
jogador: o campo nao existia no schema do PATCH, entao o front mandava, o
servidor respondia 200 e descartava — a falha que se parece com sucesso.

Havia um segundo problema por baixo: a coluna era String(500) e uma data URL
passa de 40 mil caracteres. No SQLite isso passaria calado; no Postgres
quebraria na primeira foto de verdade.
"""
import uuid

# JPEG 1x1 real, pequeno o bastante para caber no arquivo de teste.
JPEG = (
    "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJ"
    "CQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/"
    "wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAA"
    "AAD/2gAIAQEAAD8AKp//2Q=="
)


def _conta(client):
    email = f"foto-{uuid.uuid4().hex[:10]}@teste.com"
    r = client.post("/api/auth/register", json={
        "name": "Foto Teste", "email": email, "senha": "Senha123!",
    })
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _perfil(client, hdrs):
    r = client.get("/api/perfil", headers=hdrs)
    assert r.status_code == 200, r.text
    return r.json()


def test_foto_de_perfil_e_gravada_de_verdade(client):
    """O teste que faltava: mandar, e depois LER DE VOLTA.

    Conferir so o 200 do PATCH era o que deixava o bug passar.
    """
    h = _conta(client)
    assert _perfil(client, h).get("photo", "") == ""

    r = client.patch("/api/perfil", headers=h, json={"photo": JPEG})
    assert r.status_code == 200, r.text
    assert _perfil(client, h)["photo"] == JPEG


def test_data_url_longa_cabe(client):
    """A coluna era String(500). Uma foto real e muito maior que isso."""
    h = _conta(client)
    grande = "data:image/jpeg;base64," + ("A" * 60_000)
    assert client.patch("/api/perfil", headers=h, json={"photo": grande}).status_code == 200
    assert len(_perfil(client, h)["photo"]) == len(grande)


def test_string_vazia_remove_a_foto(client):
    h = _conta(client)
    client.patch("/api/perfil", headers=h, json={"photo": JPEG})
    assert client.patch("/api/perfil", headers=h, json={"photo": ""}).status_code == 200
    assert _perfil(client, h)["photo"] == ""


def test_esquema_perigoso_e_recusado(client):
    """Esse texto vai parar num src na tela.

    `javascript:` num src e execucao de codigo com o conteudo que veio do
    aparelho — e o campo aceita o que o cliente mandar.
    """
    h = _conta(client)
    for ruim in ("javascript:alert(1)", "data:text/html,<script>", "file:///etc/passwd", "vbscript:x"):
        r = client.patch("/api/perfil", headers=h, json={"photo": ruim})
        assert r.status_code == 422, f"{ruim!r} passou com {r.status_code}"
    assert _perfil(client, h)["photo"] == ""


def test_imagem_absurda_e_recusada(client):
    h = _conta(client)
    r = client.patch("/api/perfil", headers=h, json={"photo": "data:image/jpeg;base64," + "A" * 1_500_000})
    assert r.status_code == 413


def test_escudo_do_clube_grava_e_volta(client):
    h = _conta(client)
    r = client.post("/api/clubes", headers=h, json={
        "name": f"Escudo {uuid.uuid4().hex[:5]}", "sport": "Futsal",
        "city": "Belo Horizonte", "state": "MG", "photo": JPEG,
    })
    assert r.status_code == 200, r.text
    club = r.json()["clube"]
    assert club["photo"] == JPEG

    # E a edicao troca sem exigir que se reenvie tudo de novo como imagem.
    r = client.post("/api/clubes", headers=h, json={
        "id": club["id"], "name": club["name"], "sport": club["sport"],
        "city": club["city"], "state": club["state"], "photo": "",
    })
    assert r.status_code == 200 and r.json()["clube"]["photo"] == ""


def test_escudo_do_clube_recusa_esquema_perigoso(client):
    h = _conta(client)
    r = client.post("/api/clubes", headers=h, json={
        "name": f"Ruim {uuid.uuid4().hex[:5]}", "sport": "Futsal",
        "city": "Belo Horizonte", "state": "MG", "photo": "javascript:alert(1)",
    })
    assert r.status_code == 422
