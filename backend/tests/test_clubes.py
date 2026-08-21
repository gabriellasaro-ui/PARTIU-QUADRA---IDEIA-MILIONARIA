"""Clube como guilda — Fase 16.

O que mudou: a pessoa participa de varios clubes (com teto), existem tres
modos de entrada e tres cargos, e o clube tem limite de membros.

O que estes testes protegem, em ordem de custo se quebrar:
  1. clube privado nao pode vazar na busca — o nome do grupo sai na resposta;
  2. o teto de membros nao pode ser furado — nem no pedido, nem na aprovacao;
  3. admin nao pode agir sobre dono nem sobre outro admin;
  4. dono nao pode abandonar um clube com gente dentro.
"""
import uuid

import pytest


def _conta(client, nome="Teste Clube") -> tuple[dict, str]:
    """Usuario novo (sem clube nenhum) + o id dele."""
    email = f"clube-{uuid.uuid4().hex[:10]}@teste.com"
    r = client.post("/api/auth/register", json={
        "email": email, "name": nome, "senha": "Senha123!",
    })
    assert r.status_code == 200, r.text
    dados = r.json()
    return {"Authorization": f"Bearer {dados['token']}"}, dados["user"]["id"]


def _cria_clube(client, hdrs, *, modo="aberto", limite=30, nome=None):
    r = client.post("/api/clubes", headers=hdrs, json={
        "name": nome or f"Clube {uuid.uuid4().hex[:6]}",
        "sport": "Futebol Society",
        "city": "Goiânia",
        "state": "GO",
        "joinMode": modo,
        "maxMembers": limite,
    })
    assert r.status_code == 200, r.text
    return r.json()["clube"]


# ───────────────────────────── varios clubes ───────────────────────────────

def test_pessoa_participa_de_varios_clubes(client):
    """Antes era um so: quem jogava com dois grupos tinha de sair de um."""
    dono_a, _ = _conta(client)
    dono_b, _ = _conta(client)
    a = _cria_clube(client, dono_a)
    b = _cria_clube(client, dono_b)

    visitante, _ = _conta(client)
    assert client.post(f"/api/clubes/{a['id']}/entrar", headers=visitante).status_code == 200
    assert client.post(f"/api/clubes/{b['id']}/entrar", headers=visitante).status_code == 200

    meus = client.get("/api/clubes/meus", headers=visitante).json()["clubes"]
    assert {c["id"] for c in meus} == {a["id"], b["id"]}


def test_teto_de_participacoes(client, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "club_max_per_user", 2, raising=False)
    visitante, _ = _conta(client)
    ids = []
    for _ in range(3):
        dono, _ = _conta(client)
        ids.append(_cria_clube(client, dono)["id"])

    assert client.post(f"/api/clubes/{ids[0]}/entrar", headers=visitante).status_code == 200
    assert client.post(f"/api/clubes/{ids[1]}/entrar", headers=visitante).status_code == 200
    r = client.post(f"/api/clubes/{ids[2]}/entrar", headers=visitante)
    assert r.status_code == 409
    assert "2 clubes" in r.json()["detail"]


def test_teto_de_clubes_criados(client, monkeypatch):
    """Segura a enxurrada de clube vazio na busca."""
    from app.core.config import settings

    monkeypatch.setattr(settings, "club_max_owned", 1, raising=False)
    hdrs, _ = _conta(client)
    _cria_clube(client, hdrs)
    r = client.post("/api/clubes", headers=hdrs, json={
        "name": "Segundo", "sport": "Futsal", "city": "Goiânia", "state": "GO",
    })
    assert r.status_code == 409
    assert "criou" in r.json()["detail"]


# ────────────────────────────── modos de entrada ───────────────────────────

def test_aberto_entra_na_hora(client):
    dono, _ = _conta(client)
    club = _cria_clube(client, dono, modo="aberto")
    visitante, uid = _conta(client)
    r = client.post(f"/api/clubes/{club['id']}/entrar", headers=visitante)
    assert r.status_code == 200
    assert uid in [m["id"] for m in r.json()["clube"]["members"]]


def test_solicitacao_entra_na_fila_e_a_gestao_aprova(client):
    dono, _ = _conta(client)
    club = _cria_clube(client, dono, modo="solicitacao")
    visitante, uid = _conta(client)

    r = client.post(f"/api/clubes/{club['id']}/entrar", headers=visitante)
    assert r.status_code == 200
    # Nao entrou: entrou na fila. Quem chamou precisa saber a diferenca.
    assert r.json()["status"] == "pendente"
    assert uid not in [m["id"] for m in r.json()["clube"]["members"]]

    fila = client.get(f"/api/clubes/{club['id']}/solicitacoes", headers=dono).json()
    assert len(fila["solicitacoes"]) == 1
    pedido = fila["solicitacoes"][0]["id"]

    ok = client.post(f"/api/clubes/{club['id']}/solicitacoes/{pedido}/aprovar", headers=dono)
    assert ok.status_code == 200 and ok.json()["status"] == "aprovada"

    membros = client.get("/api/clubes/meus", headers=visitante).json()["clubes"]
    assert club["id"] in [c["id"] for c in membros]


def test_solicitacao_recusada_pode_ser_refeita(client):
    """Pedir de novo reabre o MESMO registro (UNIQUE club+user).

    Sem isso, quem foi recusado uma vez tomaria erro para sempre, sem
    entender o motivo.
    """
    dono, _ = _conta(client)
    club = _cria_clube(client, dono, modo="solicitacao")
    visitante, _ = _conta(client)

    client.post(f"/api/clubes/{club['id']}/entrar", headers=visitante)
    pedido = client.get(f"/api/clubes/{club['id']}/solicitacoes", headers=dono).json()["solicitacoes"][0]["id"]
    client.post(f"/api/clubes/{club['id']}/solicitacoes/{pedido}/recusar", headers=dono)

    r = client.post(f"/api/clubes/{club['id']}/entrar", headers=visitante)
    assert r.status_code == 200 and r.json()["status"] == "pendente"
    fila = client.get(f"/api/clubes/{club['id']}/solicitacoes", headers=dono).json()["solicitacoes"]
    assert len(fila) == 1  # reabriu, nao duplicou


def test_privado_nao_aparece_na_busca_e_so_entra_com_codigo(client):
    """O corte e no backend: o nome do grupo nao pode sair na resposta para
    depois ser escondido na tela."""
    dono, _ = _conta(client)
    club = _cria_clube(client, dono, modo="privado")
    visitante, _ = _conta(client)

    lista = client.get("/api/clubes", headers=visitante).json()["clubes"]
    assert club["id"] not in [c["id"] for c in lista]

    # Sem codigo: 403.
    r = client.post(f"/api/clubes/{club['id']}/entrar", headers=visitante, json={})
    assert r.status_code == 403

    # Codigo errado tambem nao passa.
    r = client.post(f"/api/clubes/{club['id']}/entrar", headers=visitante, json={"codigo": "XXXXXX"})
    assert r.status_code == 403

    # Com o codigo certo, entra — e o hifen de exibicao nao atrapalha.
    codigo = club["code"]
    r = client.post(f"/api/clubes/{club['id']}/entrar", headers=visitante,
                    json={"codigo": f"{codigo[:3]}-{codigo[3:]}"})
    assert r.status_code == 200


def test_dono_continua_vendo_o_proprio_clube_privado(client):
    dono, _ = _conta(client)
    club = _cria_clube(client, dono, modo="privado")
    lista = client.get("/api/clubes", headers=dono).json()["clubes"]
    assert club["id"] in [c["id"] for c in lista]


def test_busca_por_codigo_alcanca_o_privado(client):
    """E a unica porta — e por isso o match e exato, nunca parcial."""
    dono, _ = _conta(client)
    club = _cria_clube(client, dono, modo="privado")
    visitante, _ = _conta(client)
    r = client.get(f"/api/clubes?codigo={club['code']}", headers=visitante)
    assert r.status_code == 200 and r.json()["clube"]["id"] == club["id"]


# ───────────────────────────── limite de membros ───────────────────────────

def test_clube_lotado_recusa(client):
    dono, _ = _conta(client)
    club = _cria_clube(client, dono, limite=1)  # so o dono cabe
    visitante, _ = _conta(client)
    r = client.post(f"/api/clubes/{club['id']}/entrar", headers=visitante)
    assert r.status_code == 409 and "lotado" in r.json()["detail"].lower()


def test_lotacao_e_reconferida_na_aprovacao(client):
    """Entre pedir e aprovar o clube pode ter enchido."""
    dono, _ = _conta(client)
    club = _cria_clube(client, dono, modo="solicitacao", limite=2)
    a, _ = _conta(client)
    b, _ = _conta(client)

    client.post(f"/api/clubes/{club['id']}/entrar", headers=a)
    client.post(f"/api/clubes/{club['id']}/entrar", headers=b)
    fila = client.get(f"/api/clubes/{club['id']}/solicitacoes", headers=dono).json()["solicitacoes"]
    assert len(fila) == 2

    # A primeira aprovacao enche o clube (dono + 1 = 2).
    assert client.post(f"/api/clubes/{club['id']}/solicitacoes/{fila[0]['id']}/aprovar",
                       headers=dono).status_code == 200
    # A segunda tem de bater no limite, e nao entrar em silencio.
    r = client.post(f"/api/clubes/{club['id']}/solicitacoes/{fila[1]['id']}/aprovar", headers=dono)
    assert r.status_code == 409


def test_limite_nao_desce_abaixo_do_total_atual(client):
    """Baixar o limite nao expulsa ninguem: so criaria um clube que se recusa
    a aceitar gente sem explicar o motivo."""
    dono, _ = _conta(client)
    club = _cria_clube(client, dono, limite=10)
    visitante, _ = _conta(client)
    client.post(f"/api/clubes/{club['id']}/entrar", headers=visitante)  # 2 membros

    r = client.post("/api/clubes", headers=dono, json={
        "id": club["id"], "name": club["name"], "sport": club["sport"],
        "city": club["city"], "state": "GO", "maxMembers": 1,
    })
    assert r.status_code == 200
    assert r.json()["clube"]["maxMembers"] == 2  # preso no total atual


# ──────────────────────────────── cargos ───────────────────────────────────

def test_dono_promove_e_rebaixa(client):
    dono, _ = _conta(client)
    club = _cria_clube(client, dono)
    membro, mid = _conta(client)
    client.post(f"/api/clubes/{club['id']}/entrar", headers=membro)

    r = client.post(f"/api/clubes/{club['id']}/membros/{mid}/cargo",
                    headers=dono, json={"role": "admin"})
    assert r.status_code == 200
    assert next(m for m in r.json()["clube"]["members"] if m["id"] == mid)["role"] == "admin"

    r = client.post(f"/api/clubes/{club['id']}/membros/{mid}/cargo",
                    headers=dono, json={"role": "membro"})
    assert next(m for m in r.json()["clube"]["members"] if m["id"] == mid)["role"] == "membro"


def test_admin_nao_promove(client):
    """Promover e do dono. Admin promovendo admin viraria escalada sem freio."""
    dono, _ = _conta(client)
    club = _cria_clube(client, dono)
    admin, aid = _conta(client)
    outro, oid = _conta(client)
    client.post(f"/api/clubes/{club['id']}/entrar", headers=admin)
    client.post(f"/api/clubes/{club['id']}/entrar", headers=outro)
    client.post(f"/api/clubes/{club['id']}/membros/{aid}/cargo", headers=dono, json={"role": "admin"})

    r = client.post(f"/api/clubes/{club['id']}/membros/{oid}/cargo",
                    headers=admin, json={"role": "admin"})
    assert r.status_code == 403


def test_admin_remove_membro_comum_mas_nao_o_dono(client):
    dono, did = _conta(client)
    club = _cria_clube(client, dono)
    admin, aid = _conta(client)
    comum, cid = _conta(client)
    client.post(f"/api/clubes/{club['id']}/entrar", headers=admin)
    client.post(f"/api/clubes/{club['id']}/entrar", headers=comum)
    client.post(f"/api/clubes/{club['id']}/membros/{aid}/cargo", headers=dono, json={"role": "admin"})

    assert client.delete(f"/api/clubes/{club['id']}/membros/{cid}", headers=admin).status_code == 200
    assert client.delete(f"/api/clubes/{club['id']}/membros/{did}", headers=admin).status_code == 403


def test_membro_comum_nao_administra(client):
    dono, _ = _conta(client)
    club = _cria_clube(client, dono)
    comum, _ = _conta(client)
    outro, oid = _conta(client)
    client.post(f"/api/clubes/{club['id']}/entrar", headers=comum)
    client.post(f"/api/clubes/{club['id']}/entrar", headers=outro)

    assert client.get(f"/api/clubes/{club['id']}/solicitacoes", headers=comum).status_code == 403
    assert client.delete(f"/api/clubes/{club['id']}/membros/{oid}", headers=comum).status_code == 403


def test_pendingCount_so_para_a_gestao(client):
    """Quantas pessoas querem entrar nao e informacao de visitante."""
    dono, _ = _conta(client)
    club = _cria_clube(client, dono, modo="solicitacao")
    visitante, _ = _conta(client)
    client.post(f"/api/clubes/{club['id']}/entrar", headers=visitante)

    meu = client.get("/api/clubes/meus", headers=dono).json()["clubes"][0]
    assert meu["pendingCount"] == 1

    visto = client.get(f"/api/clubes?codigo={club['code']}", headers=visitante).json()["clube"]
    assert "pendingCount" not in visto


# ──────────────────────────────── sair ─────────────────────────────────────

def test_dono_nao_sai_deixando_gente(client):
    """Sairia deixando um clube vivo e sem quem apague, promova ou aprove."""
    dono, _ = _conta(client)
    club = _cria_clube(client, dono)
    outro, _ = _conta(client)
    client.post(f"/api/clubes/{club['id']}/entrar", headers=outro)

    r = client.post(f"/api/clubes/{club['id']}/sair", headers=dono)
    assert r.status_code == 409
    assert "Passe o clube" in r.json()["detail"]


def test_ultimo_a_sair_apaga_o_clube(client):
    """Regra da Fase 9 que continua valendo: grupo sem ninguem nao e grupo."""
    dono, _ = _conta(client)
    club = _cria_clube(client, dono)
    r = client.post(f"/api/clubes/{club['id']}/sair", headers=dono)
    assert r.status_code == 200 and r.json().get("deleted") is True
    assert client.get(f"/api/clubes?codigo={club['code']}", headers=dono).status_code == 404


def test_contrato_antigo_continua_valendo(client):
    """O app ja instalado le name/code/members e ignora o resto.

    Os campos da Fase 16 sao aditivos: nada saiu do contrato.
    """
    dono, _ = _conta(client)
    club = _cria_clube(client, dono)
    assert {"id", "name", "code", "sport", "city", "members", "createdBy"} <= set(club)
    assert club["joinMode"] == "aberto" and club["maxMembers"] == 30
    assert club["myRole"] == "dono"
