"""Estado e cidade como listas fechadas.

Campo livre produzia "Goiania", "goiânia" e "GOIANIA" como lugares diferentes,
e ai nenhum filtro por cidade fechava. O front passou a usar dois <select>
alimentados por /api/localidades; aqui se verifica o outro lado: que as listas
existem, que a UF chega ao banco e que ela volta na leitura.
"""
import uuid


def _conta_nova(client) -> dict:
    """Cria e loga um usuario sem clube nenhum."""
    email = f"loc-{uuid.uuid4().hex[:10]}@teste.com"
    r = client.post("/api/auth/register", json={
        "email": email, "name": "Teste Localidade", "senha": "senha123",
    })
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_estados_tem_as_27_unidades(client):
    r = client.get("/api/localidades/estados")
    assert r.status_code == 200
    estados = r.json()["estados"]
    assert len(estados) == 27
    siglas = {e["sigla"] for e in estados}
    assert {"GO", "SP", "AM", "DF"} <= siglas
    # Cada uma precisa do nome por extenso: o seletor mostra "GO — Goiás",
    # e so a sigla obrigaria a pessoa a decorar 27 pares.
    assert all(e.get("nome") for e in estados)


def test_cidades_da_uf(client):
    r = client.get("/api/localidades/estados/GO/cidades")
    assert r.status_code == 200
    cidades = r.json()["cidades"]
    assert "Goiânia" in cidades
    # Municipio de outro estado nao pode vazar para esta lista.
    assert "São Paulo" not in cidades


def test_uf_inexistente_e_404(client):
    """404, e nao lista vazia.

    O seletor de cidade so envia UF que veio da propria lista do servidor,
    entao isto nunca acontece pelo caminho normal — e quando acontece e erro
    de quem chamou, nao "esta UF nao tem municipios". O front trata o erro
    mostrando "Nao foi possivel carregar" em vez de um seletor vazio, que
    pareceria estado sem cidade nenhuma.
    """
    r = client.get("/api/localidades/estados/ZZ/cidades")
    assert r.status_code == 404


def test_clube_guarda_e_devolve_a_uf(client):
    """O formulario nunca mandava `state`, entao todo clube nascia sem UF.

    A coluna sempre existiu e o schema ja aceitava — faltava so o front. Este
    teste trava o contrato para que a UF nao volte a se perder no caminho.
    """
    # Usuario novo: os do seed ja pertencem ao clube semeado, e a regra de
    # "um clube por pessoa" (ainda em vigor) devolveria 409 antes de chegar
    # no que este teste quer medir.
    hdrs = _conta_nova(client)
    nome = f"Clube UF {uuid.uuid4().hex[:6]}"

    r = client.post(
        "/api/clubes",
        headers=hdrs,
        json={"name": nome, "sport": "Futebol Society", "city": "Goiânia", "state": "GO"},
    )
    assert r.status_code == 200, r.text
    criado = r.json()["clube"]
    assert criado["city"] == "Goiânia"
    assert criado["state"] == "GO"

    # E persiste: a leitura seguinte tem de trazer a mesma UF.
    lista = client.get("/api/clubes", headers=hdrs).json()["clubes"]
    guardado = next(c for c in lista if c["id"] == criado["id"])
    assert guardado["state"] == "GO"


def test_uf_com_tamanho_errado_e_recusada(client):
    """`state` e a sigla de 2 letras. Aceitar "Goiás" aqui traria de volta
    exatamente a bagunca que os dropdowns vieram resolver."""
    hdrs = _conta_nova(client)
    r = client.post(
        "/api/clubes",
        headers=hdrs,
        json={"name": "Clube UF ruim", "sport": "Futsal", "city": "Goiânia", "state": "Goiás"},
    )
    assert r.status_code == 422
