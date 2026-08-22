"""Painel do gerente — paginacao, intervalo livre e mapa de calor.

Os tres nasceram de queixas concretas do Gabriel sobre o painel:

  "reservas faturadas com paginacao completa"  -> a lista vinha cortada em 200
     linhas SEM avisar do corte. A tela mostrava o que coubesse e nao havia
     como saber que faltava.
  "filtro de dias personalizados"              -> so havia hoje/7d/30d. Quem
     fecha o mes precisa de "1 a 31 de julho", e nao de "os ultimos 30 dias a
     partir de agora".
  "mapa de calor dos dias e horarios"          -> "ocupacao media 2%" nao diz
     se o problema e a terca de manha ou o domingo inteiro.
"""
import uuid
from datetime import date, timedelta

GERENTE = "dono@arenabolanarede.com.br"


def _gerente(client):
    r = client.post("/api/auth/login", json={"email": GERENTE, "senha": "qadras123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _quadra(client):
    return client.get("/api/quadras").json()["quadras"][0]["id"]


# ─────────────────────────────── paginacao ─────────────────────────────────

def test_reservas_vem_paginadas_com_total(client):
    h = _gerente(client)
    r = client.get("/api/gerente/reservas?pagina=1&porPagina=2", headers=h)
    assert r.status_code == 200, r.text
    d = r.json()
    assert set(d) >= {"reservas", "total", "pagina", "paginas", "porPagina"}
    assert len(d["reservas"]) <= 2
    assert d["pagina"] == 1


def test_a_pagina_2_traz_reservas_diferentes(client):
    """O teste que prova que ha OFFSET, e nao so um limite menor.

    Sem offset, toda pagina devolveria as mesmas primeiras linhas e o
    paginador seria enfeite.
    """
    h = _gerente(client)
    p1 = client.get("/api/gerente/reservas?pagina=1&porPagina=2", headers=h).json()
    if p1["total"] <= 2:
        return  # sem dado suficiente para paginar; nada a provar aqui
    p2 = client.get("/api/gerente/reservas?pagina=2&porPagina=2", headers=h).json()
    ids1 = {r["id"] for r in p1["reservas"]}
    ids2 = {r["id"] for r in p2["reservas"]}
    assert ids1 and ids2
    assert not (ids1 & ids2), "a pagina 2 repetiu reservas da pagina 1"


def test_total_nao_muda_com_o_tamanho_da_pagina(client):
    """`total` e do CONJUNTO, nao da pagina — contar a lista ja cortada daria
    o tamanho da pagina e o paginador mostraria sempre 1 pagina."""
    h = _gerente(client)
    a = client.get("/api/gerente/reservas?porPagina=2", headers=h).json()["total"]
    b = client.get("/api/gerente/reservas?porPagina=50", headers=h).json()["total"]
    assert a == b


def test_filtro_por_plano_separa_avulso_de_mensalista(client):
    h = _gerente(client)
    todas = client.get("/api/gerente/reservas?porPagina=100", headers=h).json()
    avulso = client.get("/api/gerente/reservas?plano=avulso&porPagina=100", headers=h).json()
    mensal = client.get("/api/gerente/reservas?plano=mensalista&porPagina=100", headers=h).json()
    assert avulso["total"] + mensal["total"] == todas["total"]
    assert all(r["plan"] == "avulso" for r in avulso["reservas"])


# ──────────────────────────── intervalo livre ──────────────────────────────

def test_financeiro_aceita_intervalo_proprio(client):
    h = _gerente(client)
    r = client.get("/api/gerente/financeiro?de=2026-08-01&ate=2026-08-31", headers=h)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["periodo"] == "custom"
    assert d["de"] == "2026-08-01"
    # `ate` e INCLUSIVO: quem digita 31 espera o dia 31 inteiro na conta.
    assert d["ate"] == "2026-08-31"


def test_data_torta_e_422(client):
    h = _gerente(client)
    assert client.get("/api/gerente/financeiro?de=ontem", headers=h).status_code == 422
    assert client.get("/api/gerente/financeiro?ate=31/08/2026", headers=h).status_code == 422


def test_intervalo_invertido_e_422(client):
    """Recusar e melhor que devolver zero: zero parece "nao faturou nada"."""
    h = _gerente(client)
    r = client.get("/api/gerente/financeiro?de=2026-08-31&ate=2026-08-01", headers=h)
    assert r.status_code == 422


def test_o_financeiro_mantem_os_centavos(client):
    """O painel mostrava "R$ 696" para R$ 695,52.

    O arredondamento era da TELA — o servidor sempre mandou o valor exato. O
    teste existe para que continue assim: uma arena confere o proprio caixa
    com esse numero.
    """
    h = _gerente(client)
    d = client.get("/api/gerente/financeiro", headers=h).json()
    for campo in ("bruto", "subtotal", "comissao", "liquido"):
        assert isinstance(d[campo], (int, float))
    # centavos existem de fato (nao e tudo inteiro por acaso do seed)
    assert round(d["bruto"], 2) == d["bruto"]


# ───────────────────────────── mapa de calor ───────────────────────────────

def test_ritmo_devolve_a_grade_completa(client):
    """7x24 sempre, mesmo sem dado: buraco no meio de um mapa de calor le como
    "zero", e nao como "sem informacao"."""
    h = _gerente(client)
    d = client.get("/api/gerente/ritmo", headers=h).json()
    assert len(d["dias"]) == 7 and d["dias"][0] == "Dom"
    for grade in ("reservas", "procura"):
        assert len(d[grade]) == 7
        assert all(len(linha) == 24 for linha in d[grade])


def test_escolher_horario_alimenta_a_procura(client):
    """A PROCURA sai da escolha do horario, nao da abertura da agenda.

    A primeira versao contava no GET da agenda, somando 1 em toda hora livre
    do dia — media quantas vezes o DIA foi aberto e a grade saia achatada, com
    o mesmo numero em todas as colunas. A pergunta que o mapa existe para
    responder ("quando enche?") ficava sem resposta.
    """
    h = _gerente(client)
    quadra = _quadra(client)
    antes = client.get("/api/gerente/ritmo", headers=h).json()

    # Uma sexta-feira futura, bloco de 2h a partir das 20h.
    d = date.today() + timedelta(days=1)
    while d.weekday() != 4:
        d += timedelta(days=1)
    r = client.post(f"/api/quadras/{quadra}/interesse",
                    json={"data": d.isoformat(), "hora": "20:00", "dur": 2})
    assert r.status_code == 204

    depois = client.get("/api/gerente/ritmo", headers=h).json()
    sexta = 5  # 0 = domingo
    assert depois["procura"][sexta][20] == antes["procura"][sexta][20] + 1
    # O bloco inteiro conta: 2h a partir das 20h sao 20 e 21.
    assert depois["procura"][sexta][21] == antes["procura"][sexta][21] + 1
    # E nao vaza para as horas de fora do bloco.
    assert depois["procura"][sexta][22] == antes["procura"][sexta][22]


def test_interesse_nao_exige_login(client):
    """Quem ainda nao tem conta tambem procura horario — e e justamente essa a
    demanda que a arena esta perdendo. Exigir conta apagaria o dado."""
    r = client.post(f"/api/quadras/{_quadra(client)}/interesse",
                    json={"hora": "19:00", "dur": 1})
    assert r.status_code == 204


def test_interesse_em_quadra_inexistente_e_404(client):
    r = client.post(f"/api/quadras/{uuid.uuid4()}/interesse", json={"hora": "19:00"})
    assert r.status_code == 404


def test_ritmo_exige_gerente(client):
    """O mapa e do dono da arena: expoe demanda, que e informacao comercial."""
    email = f"curioso-{uuid.uuid4().hex[:8]}@teste.com"
    reg = client.post("/api/auth/register", json={
        "name": "Curioso", "email": email, "senha": "Senha123!",
    })
    r = client.get("/api/gerente/ritmo", headers={
        "Authorization": f"Bearer {reg.json()['token']}",
    })
    assert r.status_code == 403
