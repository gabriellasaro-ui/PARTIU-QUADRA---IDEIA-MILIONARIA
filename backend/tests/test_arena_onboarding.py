"""Cadastro de arena: rascunho que retoma, envio com guarda, e a arena nascendo.

O que estes testes protegem, na ordem em que importa:

1. RETOMAR. O cadastro tem oito telas e o dono responde do celular, no
   intervalo do trabalho. Se fechar o app custar comecar de novo, o cadastro
   nao acontece. Entao cada passo grava, e `passo` volta de onde parou.

2. A ARENA SO NASCE NA APROVACAO. Enquanto a ficha esta aberta nao existe
   Arena nenhuma no banco — e por isso que jogador nenhum ve quadra em analise,
   sem depender de filtro em lugar nenhum. Filtro se esquece; linha que nao
   existe, nao. O teste conta as arenas antes e depois.

3. AS GUARDAS DO ENVIO. E-mail nao verificado e campo faltando barram, e a
   mensagem diz O QUE falta — "dados incompletos" manda a pessoa procurar em
   oito telas.

4. RECUSA COM MOTIVO. Recusa muda para pior a vida de alguem; sem motivo, vira
   uma ligacao que ninguem sabe responder.
"""
import uuid

import pytest

from app.models import APP_APROVADA, APP_ENVIADA, APP_RECUSADA, Arena, ArenaApplication


def _novo_email():
    return "dono.%s@example.com" % uuid.uuid4().hex[:8]


def _hdr(token):
    return {"Authorization": f"Bearer {token}"}


def _comecar(client, email=None):
    email = email or _novo_email()
    r = client.post("/api/arenas/solicitacao", json={
        "nome": "Dono da Quadra", "email": email, "senha": "Quadra#2026",
    })
    assert r.status_code == 200, r.text
    return r.json(), email


def _verificar_email(client, token):
    """Pede o codigo e confere. Fora de producao o provedor devolve o codigo na
    resposta — e o que permite testar o fluxo inteiro sem provedor de e-mail."""
    r = client.post("/api/auth/verificar/enviar", json={}, headers=_hdr(token))
    assert r.status_code == 200, r.text
    codigo = r.json().get("codigo")
    assert codigo, "em dev o codigo tem de vir na resposta"
    r = client.post("/api/auth/verificar/conferir", json={"codigo": codigo}, headers=_hdr(token))
    assert r.status_code == 200, r.text


def _preencher(client, token, troca=None):
    passos = {
        3: {"arena_name": "Arena Teste FC", "cnpj": "11.444.777/0001-61"},
        4: {"cep": "30140071", "address": "Rua Teste", "number": "100",
            "neighborhood": "Savassi", "city": "Belo Horizonte", "state": "MG"},
        5: {"contact_name": "Dono da Quadra", "contact_phone": "31999990000"},
        6: {"court_count": 2, "sports": ["society"], "pains": ["horarios_vagos"]},
        # Fotos sao obrigatorias: sao o unico material que responde "existe uma
        # quadra ali?" — CNPJ e endereco cabem num lote vazio.
        7: {"photos": ["data:image/jpeg;base64,AAAA", "data:image/jpeg;base64,BBBB"]},
    }
    passos.update(troca or {})
    for n, dados in passos.items():
        r = client.patch(f"/api/arenas/solicitacao/passo/{n}", json=dados, headers=_hdr(token))
        assert r.status_code == 200, (n, r.text)
    r = client.post("/api/arenas/solicitacao/aceites",
                    json={"taxa": True, "termos": True}, headers=_hdr(token))
    assert r.status_code == 200, r.text


def test_comecar_cria_conta_de_gerente_e_ficha_em_rascunho(client):
    sessao, email = _comecar(client)
    assert sessao["user"]["role"] == "gerente"
    assert sessao["token"]
    ficha = sessao["ficha"]
    assert ficha["status"] == "rascunho"
    # Ja no passo 2: o passo 1 (a conta) acabou de ser cumprido.
    assert ficha["passo"] == 2
    assert ficha["contatoEmail"] == email


def test_cadastro_retoma_de_onde_parou(client):
    sessao, _ = _comecar(client)
    t = sessao["token"]

    r = client.patch("/api/arenas/solicitacao/passo/3",
                     json={"arena_name": "Arena Meio do Caminho"}, headers=_hdr(t))
    assert r.status_code == 200, r.text

    # "Fechou o app": nova consulta, sem nada em memoria.
    r = client.get("/api/arenas/solicitacao/minha", headers=_hdr(t))
    assert r.status_code == 200, r.text
    ficha = r.json()
    assert ficha["arenaNome"] == "Arena Meio do Caminho"
    assert ficha["passo"] == 4, "deveria abrir no passo seguinte ao ultimo gravado"
    assert ficha["emailVerificado"] is False


def test_cnpj_invalido_nao_entra(client):
    sessao, _ = _comecar(client)
    r = client.patch("/api/arenas/solicitacao/passo/3",
                     json={"arena_name": "X", "cnpj": "11.444.777/0001-62"},
                     headers=_hdr(sessao["token"]))
    assert r.status_code == 422, r.text
    assert "cnpj" in r.json()["detail"].lower()


def test_envio_exige_email_verificado(client):
    sessao, _ = _comecar(client)
    t = sessao["token"]
    _preencher(client, t)
    r = client.post("/api/arenas/solicitacao/enviar", headers=_hdr(t))
    assert r.status_code == 422, r.text
    assert "e-mail" in r.json()["detail"].lower()


def test_envio_diz_o_que_falta(client):
    sessao, _ = _comecar(client)
    t = sessao["token"]
    _verificar_email(client, t)
    # So o nome: falta CNPJ, endereco e telefone.
    client.patch("/api/arenas/solicitacao/passo/3",
                 json={"arena_name": "Arena Incompleta"}, headers=_hdr(t))
    client.post("/api/arenas/solicitacao/aceites",
                json={"taxa": True, "termos": True}, headers=_hdr(t))

    r = client.post("/api/arenas/solicitacao/enviar", headers=_hdr(t))
    assert r.status_code == 422, r.text
    detalhe = r.json()["detail"]
    # Tem de NOMEAR o que falta: "dados incompletos" manda procurar em 8 telas.
    assert "CNPJ" in detalhe and "CEP" in detalhe, detalhe


def test_envio_exige_fotos(client):
    """Sem foto nao da para dizer se a quadra existe.

    CNPJ e endereco cabem os dois num lote vazio; a fachada e a quadra sao o
    unico material que responde a pergunta da triagem — e sao gratuitas de
    produzir para quem de fato tem a quadra.
    """
    sessao, _ = _comecar(client)
    t = sessao["token"]
    _verificar_email(client, t)
    _preencher(client, t, {7: {"photos": []}})

    r = client.post("/api/arenas/solicitacao/enviar", headers=_hdr(t))
    assert r.status_code == 422, r.text
    detalhe = r.json()["detail"].lower()
    assert "fotos" in detalhe and "fachada" in detalhe, detalhe

    # Uma so tambem nao: a tela pede as duas pelo nome.
    client.patch("/api/arenas/solicitacao/passo/7",
                 json={"photos": ["data:image/jpeg;base64,AAAA"]}, headers=_hdr(t))
    assert client.post("/api/arenas/solicitacao/enviar", headers=_hdr(t)).status_code == 422


def test_aprovar_cria_a_arena_e_so_entao(client, db_session, login):
    antes = db_session.query(Arena).count()

    sessao, _ = _comecar(client)
    t = sessao["token"]
    _verificar_email(client, t)
    _preencher(client, t)

    r = client.post("/api/arenas/solicitacao/enviar", headers=_hdr(t))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == APP_ENVIADA

    # ENVIADA nao e APROVADA: nenhuma arena pode ter nascido ainda.
    assert db_session.query(Arena).count() == antes, \
        "a arena nasceu antes da aprovacao — quadra em analise apareceria no app"

    admin = login("admin@qadras.com.br")
    fila = client.get("/api/admin/solicitacoes", headers=admin)
    assert fila.status_code == 200, fila.text
    ids = [f["id"] for f in fila.json()["solicitacoes"]]
    ficha_id = r.json()["id"]
    assert ficha_id in ids, "a ficha enviada tem de aparecer na fila do admin"

    ok = client.post(f"/api/admin/solicitacoes/{ficha_id}/aprovar", headers=admin)
    assert ok.status_code == 200, ok.text
    assert ok.json()["status"] == APP_APROVADA

    assert db_session.query(Arena).count() == antes + 1
    arena = db_session.get(Arena, uuid.UUID(ok.json()["arenaId"]))
    db_session.refresh(arena)
    # Nasce com o que o dono DECLAROU — e isto que "nome pre-preenchido se for
    # aprovado" quer dizer.
    assert arena.name == "Arena Teste FC"
    assert arena.city == "Belo Horizonte"
    assert arena.neighborhood == "Savassi"
    assert arena.status == "aprovada"
    assert str(arena.owner_id) == sessao["user"]["id"]


def test_recusa_exige_motivo_e_ele_chega_ao_dono(client, db_session, login):
    sessao, _ = _comecar(client)
    t = sessao["token"]
    _verificar_email(client, t)
    _preencher(client, t)
    ficha_id = client.post("/api/arenas/solicitacao/enviar", headers=_hdr(t)).json()["id"]

    admin = login("admin@qadras.com.br")
    vazio = client.post(f"/api/admin/solicitacoes/{ficha_id}/recusar",
                        json={"motivo": ""}, headers=admin)
    assert vazio.status_code == 422, vazio.text

    r = client.post(f"/api/admin/solicitacoes/{ficha_id}/recusar",
                    json={"motivo": "CNPJ não corresponde ao endereço informado"},
                    headers=admin)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == APP_RECUSADA

    # O dono precisa VER o motivo, senao vai ligar para perguntar.
    minha = client.get("/api/arenas/solicitacao/minha", headers=_hdr(t)).json()
    assert "CNPJ não corresponde" in minha["motivoRecusa"]


def test_recusada_volta_a_ser_editavel(client, login):
    """Recusa nao e fim de linha: corrigir e reenviar tem de funcionar."""
    sessao, _ = _comecar(client)
    t = sessao["token"]
    _verificar_email(client, t)
    _preencher(client, t)
    ficha_id = client.post("/api/arenas/solicitacao/enviar", headers=_hdr(t)).json()["id"]

    admin = login("admin@qadras.com.br")
    client.post(f"/api/admin/solicitacoes/{ficha_id}/recusar",
                json={"motivo": "Faltou a foto da fachada"}, headers=admin)

    r = client.patch("/api/arenas/solicitacao/passo/3",
                     json={"arena_name": "Arena Corrigida"}, headers=_hdr(t))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "rascunho", "editar depois da recusa recomeca o rascunho"
    assert r.json()["motivoRecusa"] == ""

    assert client.post("/api/arenas/solicitacao/enviar", headers=_hdr(t)).status_code == 200


def test_ficha_enviada_nao_aceita_edicao(client):
    sessao, _ = _comecar(client)
    t = sessao["token"]
    _verificar_email(client, t)
    _preencher(client, t)
    client.post("/api/arenas/solicitacao/enviar", headers=_hdr(t))

    r = client.patch("/api/arenas/solicitacao/passo/3",
                     json={"arena_name": "Trocando depois de enviar"}, headers=_hdr(t))
    assert r.status_code == 409, r.text


def test_email_repetido_manda_entrar_em_vez_de_duplicar(client):
    _, email = _comecar(client)
    r = client.post("/api/arenas/solicitacao", json={
        "nome": "Outro", "email": email, "senha": "Quadra#2026",
    })
    assert r.status_code == 409, r.text
    assert "entre" in r.json()["detail"].lower()


def test_aceite_guarda_a_taxa_vigente_e_nao_um_booleano(client, db_session):
    from app.core.config import settings

    sessao, _ = _comecar(client)
    client.post("/api/arenas/solicitacao/aceites",
                json={"taxa": True, "termos": True}, headers=_hdr(sessao["token"]))

    ficha = db_session.query(ArenaApplication).filter(
        ArenaApplication.user_id == uuid.UUID(sessao["user"]["id"])
    ).one()
    db_session.refresh(ficha)
    # Sem o retrato da taxa, daqui a um ano ninguem sabe com quanto ele
    # concordou — a taxa da config vai mudar.
    assert ficha.fee_rate_snapshot == settings.arena_fee_rate
    assert ficha.terms_version, "a versao dos termos tem de ficar registrada"
