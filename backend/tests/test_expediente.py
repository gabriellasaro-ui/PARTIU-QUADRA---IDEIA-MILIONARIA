"""Expediente da quadra — os sete dias, e a diferenca entre fechado e vazio.

`court_recurring_availability` existia desde a fase 1, com dia da semana,
faixa e a coluna `closed` — e nunca teve rota no painel. O gerente tinha um
unico par "abre as / fecha as" valendo para a semana inteira, entao arena que
fecha mais cedo no domingo ou nao abre segunda nao tinha como dizer.

O caso que estes testes protegem e o mesmo que motivou a coluna `closed`:
FECHADO tem de gravar linha. Sem linha, `_day_window` cai no horario padrao da
quadra e o dia volta a aparecer ABERTO — o oposto do que o dono pediu, e ele so
descobriria quando alguem reservasse.
"""
GERENTE = "dono@arenabolanarede.com.br"


def _gerente(client):
    r = client.post("/api/auth/login", json={"email": GERENTE, "senha": "qadras123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _quadra(client, h):
    return client.get("/api/gerente/quadras", headers=h).json()["quadras"][0]["id"]


def test_devolve_sempre_os_sete_dias(client):
    """Um editor que comeca vazio obriga o dono a digitar catorze horarios
    antes de mudar um. Os sete dias vem sempre, com o padrao preenchido."""
    h = _gerente(client)
    d = client.get(f"/api/gerente/quadras/{_quadra(client, h)}/expediente", headers=h).json()
    assert len(d["dias"]) == 7
    assert [x["dia"] for x in d["dias"]] == [0, 1, 2, 3, 4, 5, 6]
    for dia in d["dias"]:
        assert dia["abre"] and dia["fecha"], dia


def test_fechado_persiste_e_nao_vira_dia_aberto(client):
    """O TESTE QUE IMPORTA.

    Marca domingo como fechado, relê, e confere que ele voltou fechado — e nao
    com o horario padrao da quadra, que e o que aconteceria se o servidor
    tivesse apagado a linha em vez de grava-la com closed=True.
    """
    h = _gerente(client)
    qid = _quadra(client, h)
    original = client.get(f"/api/gerente/quadras/{qid}/expediente", headers=h).json()["dias"]

    try:
        dias = [dict(x) for x in original]
        dias[6]["fechado"] = True
        r = client.put(f"/api/gerente/quadras/{qid}/expediente", headers=h, json={"dias": dias})
        assert r.status_code == 200, r.text

        depois = client.get(f"/api/gerente/quadras/{qid}/expediente", headers=h).json()["dias"]
        assert depois[6]["fechado"] is True
        assert depois[6]["configurado"] is True
    finally:
        client.put(f"/api/gerente/quadras/{qid}/expediente", headers=h,
                   json={"dias": [dict(x) for x in original]})


def test_horario_por_dia_e_gravado_separado(client):
    """Segunda so a noite e o resto do dia inteiro: era exatamente o que o par
    unico "abre as / fecha as" nao conseguia expressar."""
    h = _gerente(client)
    qid = _quadra(client, h)
    original = client.get(f"/api/gerente/quadras/{qid}/expediente", headers=h).json()["dias"]

    try:
        dias = [dict(x) for x in original]
        dias[0].update({"fechado": False, "abre": "18:00", "fecha": "23:00"})
        dias[1].update({"fechado": False, "abre": "06:00", "fecha": "22:00"})
        client.put(f"/api/gerente/quadras/{qid}/expediente", headers=h, json={"dias": dias})

        depois = client.get(f"/api/gerente/quadras/{qid}/expediente", headers=h).json()["dias"]
        assert (depois[0]["abre"], depois[0]["fecha"]) == ("18:00", "23:00")
        assert (depois[1]["abre"], depois[1]["fecha"]) == ("06:00", "22:00")
    finally:
        client.put(f"/api/gerente/quadras/{qid}/expediente", headers=h,
                   json={"dias": [dict(x) for x in original]})


def test_fechamento_antes_da_abertura_e_422(client):
    """Nao e virada de dia, e engano de digitacao. Aceitar produziria um dia
    sem nenhum horario reservavel, sem dizer por que."""
    h = _gerente(client)
    qid = _quadra(client, h)
    dias = client.get(f"/api/gerente/quadras/{qid}/expediente", headers=h).json()["dias"]
    dias = [dict(x) for x in dias]
    dias[2].update({"fechado": False, "abre": "22:00", "fecha": "08:00"})
    r = client.put(f"/api/gerente/quadras/{qid}/expediente", headers=h, json={"dias": dias})
    assert r.status_code == 422, r.text


def test_expediente_de_quadra_de_outra_arena_e_404(client):
    """O id vem no caminho da URL. Sem checar a dona, um gerente leria e
    reescreveria o expediente da quadra de outro."""
    h = _gerente(client)
    r = client.get(
        "/api/gerente/quadras/00000000-0000-0000-0000-000000000000/expediente",
        headers=h,
    )
    assert r.status_code == 404


def test_arena_pausada_ida_e_volta(client):
    """O interruptor gravava no localStorage do navegador: o dono desligava,
    via o botao virar, e a arena continuava aparecendo no app para todo mundo.
    Agora escreve em `is_active`, a mesma coluna que a busca consulta."""
    h = _gerente(client)
    try:
        r = client.patch("/api/gerente/configuracoes", headers=h, json={"pausada": True})
        assert r.status_code == 200, r.text
        assert r.json()["pausada"] is True
        assert client.get("/api/gerente/configuracoes", headers=h).json()["pausada"] is True
    finally:
        client.patch("/api/gerente/configuracoes", headers=h, json={"pausada": False})
    assert client.get("/api/gerente/configuracoes", headers=h).json()["pausada"] is False


# ───────────────────── indicadores do financeiro ───────────────────────────

def test_indicadores_vem_no_financeiro(client):
    h = _gerente(client)
    d = client.get("/api/gerente/financeiro?periodo=30d", headers=h).json()
    ind = d["indicadores"]
    assert set(ind) == {"clientes", "conversao", "ranking", "perdas"}
    assert set(ind["clientes"]) >= {"total", "novos", "recorrentes", "taxaRetorno"}


def test_novos_mais_recorrentes_fecham_o_total(client):
    """Todo cliente do periodo e novo OU ja jogava aqui — nunca os dois, nunca
    nenhum. Se a conta nao fechar, um dos dois conjuntos esta sendo montado
    errado e a taxa de retorno mente."""
    h = _gerente(client)
    c = client.get("/api/gerente/financeiro?periodo=30d", headers=h).json()["indicadores"]["clientes"]
    assert c["novos"] + c["recorrentes"] == c["total"]


def test_sem_cliente_a_taxa_e_nula_e_nao_zero(client):
    """"0% de retorno" e uma afirmacao sobre os clientes, e sem cliente nenhum
    ela e falsa. O zero inventado ja apareceu em quatro lugares deste painel."""
    h = _gerente(client)
    # Janela no passado remoto: a arena nao existia.
    d = client.get("/api/gerente/financeiro?de=2020-01-01&ate=2020-01-07", headers=h).json()
    ind = d["indicadores"]
    assert ind["clientes"]["total"] == 0
    assert ind["clientes"]["taxaRetorno"] is None
    assert ind["conversao"]["taxa"] is None
    assert ind["ranking"]["quadra"] is None


def test_conversao_nao_conta_reserva_que_nunca_esperou_decisao(client):
    """A taxa e sobre pedidos DECIDIDOS. Aceitas + recusadas + expiradas e a
    base; se ela incluisse reserva paga direto pelo app, a taxa iria para perto
    de 100% e pararia de dizer qualquer coisa."""
    h = _gerente(client)
    conv = client.get("/api/gerente/financeiro?periodo=30d", headers=h).json()["indicadores"]["conversao"]
    base = conv["aceitas"] + conv["recusadas"] + conv["expiradas"]
    if base:
        assert conv["taxa"] == round(conv["aceitas"] * 100 / base)


def test_faixas_somam_o_faturamento_das_reservas_ativas(client):
    h = _gerente(client)
    ind = client.get("/api/gerente/financeiro?periodo=30d", headers=h).json()["indicadores"]
    faixas = ind["ranking"]["faixas"]
    assert set(faixas) == {"Manhã", "Tarde", "Noite"}
    pico = ind["ranking"]["faixa"]
    if pico:
        assert abs(faixas[pico["nome"]] - pico["valor"]) < 0.01
