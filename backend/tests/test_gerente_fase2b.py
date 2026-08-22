"""Bloqueio de pessoa, avaliacoes por quadra, fotos e logo.

Tres pedidos do Gabriel para o painel, e um defeito encontrado no caminho.
"""
import uuid

JPEG = "data:image/jpeg;base64," + "A" * 200
GERENTE = "dono@arenabolanarede.com.br"


def _gerente(client):
    r = client.post("/api/auth/login", json={"email": GERENTE, "senha": "qadras123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _jogador(client, nome="Bloqueado"):
    email = f"blk-{uuid.uuid4().hex[:8]}@teste.com"
    r = client.post("/api/auth/register", json={
        "name": nome, "email": email, "senha": "Senha123!",
    })
    d = r.json()
    return {"Authorization": f"Bearer {d['token']}"}, d["user"]["id"]


# ────────────────────────── bloquear pessoa ────────────────────────────────

def test_arena_bloqueia_e_desbloqueia(client):
    h = _gerente(client)
    _, pid = _jogador(client)

    r = client.post(f"/api/mensagens/bloquear/{pid}", headers=h, json={"motivo": "Não apareceu 3x"})
    assert r.status_code == 200, r.text
    assert r.json()["bloqueado"] is True

    lista = client.get("/api/mensagens/bloqueados", headers=h).json()["bloqueados"]
    assert any(b["id"] == pid and b["motivo"] == "Não apareceu 3x" for b in lista)

    assert client.delete(f"/api/mensagens/bloquear/{pid}", headers=h).status_code == 200
    lista = client.get("/api/mensagens/bloqueados", headers=h).json()["bloqueados"]
    assert not any(b["id"] == pid for b in lista)


def test_bloquear_duas_vezes_nao_duplica(client):
    """O gerente clica de novo sem saber que ja bloqueou. Nao pode estourar."""
    h = _gerente(client)
    _, pid = _jogador(client)
    assert client.post(f"/api/mensagens/bloquear/{pid}", headers=h).status_code == 200
    assert client.post(f"/api/mensagens/bloquear/{pid}", headers=h).status_code == 200
    lista = client.get("/api/mensagens/bloqueados", headers=h).json()["bloqueados"]
    assert sum(1 for b in lista if b["id"] == pid) == 1
    client.delete(f"/api/mensagens/bloquear/{pid}", headers=h)


def test_jogador_nao_bloqueia_ninguem(client):
    """A ferramenta e da arena. Deixar o jogador bloquear a arena so faria ele
    perder o canal de resolver a propria reserva."""
    h, _ = _jogador(client)
    _, alvo = _jogador(client)
    assert client.post(f"/api/mensagens/bloquear/{alvo}", headers=h).status_code == 403


def test_bloquear_pessoa_inexistente_e_404(client):
    h = _gerente(client)
    assert client.post(f"/api/mensagens/bloquear/{uuid.uuid4()}", headers=h).status_code == 404


# ────────────────────── avaliacoes separadas por quadra ────────────────────

def test_avaliacoes_trazem_a_quadra(client):
    h = _gerente(client)
    d = client.get("/api/gerente/avaliacoes", headers=h).json()
    assert "quadras" in d
    for a in d["avaliacoes"]:
        assert "quadraId" in a and "quadraNome" in a


def test_quadras_vem_da_pior_media_para_a_melhor(client):
    """A lista existe para o dono AGIR, e nao para se parabenizar: a quadra com
    problema tem de estar em cima."""
    h = _gerente(client)
    quadras = client.get("/api/gerente/avaliacoes", headers=h).json()["quadras"]
    medias = [q["media"] for q in quadras if q["total"]]
    assert medias == sorted(medias)


def test_avaliacao_sem_reserva_nao_e_atribuida_a_uma_quadra(client):
    """Chutar a quadra errada numa nota 2 e pior que nao atribuir nenhuma.

    O seed cria avaliacoes sem booking_id (para o catalogo ja nascer com nota),
    e elas nao tem como saber a quadra.
    """
    h = _gerente(client)
    d = client.get("/api/gerente/avaliacoes", headers=h).json()
    orfas = [a for a in d["avaliacoes"] if not a["quadraId"]]
    for a in orfas:
        assert a["quadraNome"] == "Sem quadra identificada"


# ──────────────────────── fotos da quadra e logo ───────────────────────────

def test_cadastrar_quadra_exige_cinco_fotos(client):
    """Uma foto so nao vende quadra: quem escolhe onde jogar quer ver o piso, a
    iluminacao e o vestiario. Com uma imagem o anuncio e promessa sem prova."""
    h = _gerente(client)
    corpo = {
        "nome": f"Quadra {uuid.uuid4().hex[:5]}", "esporte": "Futsal", "preco": 120.0,
        "fotos": [JPEG, JPEG],
    }
    r = client.post("/api/gerente/quadras", headers=h, json=corpo)
    assert r.status_code == 422
    assert "5 fotos" in str(r.json())


def test_cinco_fotos_passa(client):
    h = _gerente(client)
    r = client.post("/api/gerente/quadras", headers=h, json={
        "nome": f"Quadra {uuid.uuid4().hex[:5]}", "esporte": "Futsal", "preco": 120.0,
        "fotos": [JPEG] * 5,
    })
    assert r.status_code == 200, r.text


def test_editar_sem_mandar_fotos_nao_e_recusado(client):
    """A distincao que torna o PATCH utilizavel: AUSENTE e diferente de VAZIO.

    Sem ela, salvar o preco recusaria o pedido por falta de fotos que ninguem
    estava tentando mudar.
    """
    h = _gerente(client)
    nova = client.post("/api/gerente/quadras", headers=h, json={
        "nome": f"Quadra {uuid.uuid4().hex[:5]}", "esporte": "Futsal",
        "preco": 100.0, "fotos": [JPEG] * 5,
    }).json()
    cid = nova.get("id") or nova.get("quadra", {}).get("id")
    r = client.patch(f"/api/gerente/quadras/{cid}", headers=h, json={"preco": 150.0})
    assert r.status_code == 200, r.text


def test_logo_da_arena_grava_e_volta(client):
    """O painel tinha o botao "Trocar logo" e o campo nao existia no perfil —
    nem leitura nem escrita. Mesma falha que parece sucesso da ficha do
    jogador."""
    h = _gerente(client)
    assert client.patch("/api/gerente/perfil", headers=h, json={"logo": JPEG}).status_code == 200
    assert client.get("/api/gerente/perfil", headers=h).json()["logo"] == JPEG


def test_logo_recusa_esquema_perigoso(client):
    h = _gerente(client)
    r = client.patch("/api/gerente/perfil", headers=h, json={"logo": "javascript:alert(1)"})
    assert r.status_code == 422
