"""Perfil publico da arena — a vitrine entre a busca e a quadra.

O app listava quadras soltas: uma arena com tres quadras aparecia tres vezes e
nao havia lugar nenhum onde ela fosse uma coisa so. `/api/arenas/{id}` e essa
pagina.

O teste mais importante deste arquivo e o de contato: a plataforma NUNCA
publica telefone, e-mail, chave Pix ou rua da arena. Nao e preferencia de
layout — quem sai da tela com o contato fecha por fora, e a reserva que
sustenta o produto nao acontece. A regra vive dentro de
`catalog.get_arena_profile`, longe de quem edita a tela, entao a assercao aqui
e sobre as CHAVES do retorno: qualquer refatoracao que reintroduza o campo
quebra o teste em vez de vazar calada.
"""
import uuid


def _arena_do_seed(client) -> dict:
    r = client.get("/api/arenas")
    assert r.status_code == 200, r.text
    arenas = r.json()["arenas"]
    assert arenas, "o seed precisa de ao menos uma arena com quadra visivel"
    return arenas[0]


def _perfil(client, arena_id):
    return client.get(f"/api/arenas/{arena_id}")


# --- a regra de contato ----------------------------------------------------

def test_perfil_nunca_publica_contato_nem_rua(client):
    from app.core.database import SessionLocal
    from app.models import Arena

    arena = _arena_do_seed(client)

    # Preenche justamente os campos que nao podem sair: sem isso o teste
    # passaria por eles estarem vazios, e nao por estarem barrados.
    with SessionLocal() as db:
        linha = db.get(Arena, uuid.UUID(arena["id"]))
        antes = (linha.phone, linha.email, linha.pix_key, linha.address)
        linha.phone = "31999998888"
        linha.email = "contato@arena.com.br"
        linha.pix_key = "chave-pix-secreta"
        linha.address = "Rua Senador Campos Vergueiro 222"
        db.commit()
    try:
        corpo = _perfil(client, arena["id"]).json()["arena"]
        bruto = str(corpo)
        for proibido in ("31999998888", "contato@arena.com.br", "chave-pix-secreta",
                         "Senador Campos Vergueiro"):
            assert proibido not in bruto, f"o perfil vazou {proibido!r}"

        chaves = {k.lower() for k in corpo}
        assert not chaves & {"phone", "telefone", "email", "pix", "pixchave",
                             "address", "endereco", "rua"}
    finally:
        with SessionLocal() as db:
            linha = db.get(Arena, uuid.UUID(arena["id"]))
            linha.phone, linha.email, linha.pix_key, linha.address = antes
            db.commit()


def test_bairro_nao_cai_na_rua_quando_falta(client):
    """Sem bairro, mostra a CIDADE — nunca o `address`, que e texto livre e na
    pratica guarda a rua. A API ja devolveu
    `"neighborhood": "Rua Senador Campos Vergueiro 222"` por causa disso."""
    from app.services.catalog import bairro_da_arena

    class _Fake:
        neighborhood = None
        address = "Rua Senador Campos Vergueiro 222"
        city = "Belo Horizonte"

    assert bairro_da_arena(_Fake()) == "Belo Horizonte"

    _Fake.neighborhood = "Planalto"
    assert bairro_da_arena(_Fake()) == "Planalto"


# --- o que a vitrine mostra ------------------------------------------------

def test_perfil_traz_identidade_e_catalogo(client):
    arena = _arena_do_seed(client)
    corpo = _perfil(client, arena["id"]).json()["arena"]

    assert corpo["nome"]
    assert corpo["totalQuadras"] == len(corpo["quadras"]) >= 1
    assert corpo["precoMin"] == min(q["price"] for q in corpo["quadras"])
    # A galeria da arena sai das fotos das quadras, sem repetir.
    assert len(corpo["fotos"]) == len(set(corpo["fotos"]))
    # As avaliacoes ja eram gravadas por arena; e aqui que elas pertencem.
    assert isinstance(corpo["avaliacoes"], list)


def test_quadra_pausada_nao_aparece_no_perfil(client):
    from app.core.database import SessionLocal
    from app.models import Court

    arena = _arena_do_seed(client)
    corpo = _perfil(client, arena["id"]).json()["arena"]
    alvo = corpo["quadras"][0]["id"]

    with SessionLocal() as db:
        court = db.get(Court, uuid.UUID(alvo))
        court.is_active = False
        db.commit()
    try:
        resposta = _perfil(client, arena["id"])
        # ARENA ATIVA COM A QUADRA PAUSADA AINDA ABRE, e abre vazia.
        #
        # E por isto que `repo.get_visible_arena` nao usa o VISIBLE inteiro:
        # aquele conjunto tambem exige quadra visivel, e a arena sumiria como
        # se nao existisse. Quem chega por um link salvo merece a pagina
        # dizendo que nao ha quadra disponivel agora, e nao um 404.
        assert resposta.status_code == 200
        depois = resposta.json()["arena"]
        assert alvo not in [q["id"] for q in depois["quadras"]]
        assert depois["totalQuadras"] == corpo["totalQuadras"] - 1
        assert depois["nome"] == corpo["nome"]
    finally:
        with SessionLocal() as db:
            court = db.get(Court, uuid.UUID(alvo))
            court.is_active = True
            db.commit()


def test_arena_pausada_responde_404(client):
    """O perfil e URL publica: sem esta checagem ele viraria porta lateral
    para a arena que o dono acabou de tirar do ar."""
    from app.core.database import SessionLocal
    from app.models import Arena

    arena = _arena_do_seed(client)
    with SessionLocal() as db:
        linha = db.get(Arena, uuid.UUID(arena["id"]))
        linha.is_active = False
        db.commit()
    try:
        assert _perfil(client, arena["id"]).status_code == 404
        # E some tambem da faixa da home, que sai da mesma consulta.
        assert arena["id"] not in [a["id"] for a in client.get("/api/arenas").json()["arenas"]]
    finally:
        with SessionLocal() as db:
            linha = db.get(Arena, uuid.UUID(arena["id"]))
            linha.is_active = True
            db.commit()


def test_id_invalido_responde_404(client):
    assert _perfil(client, "nao-e-uuid").status_code == 404
    assert _perfil(client, str(uuid.uuid4())).status_code == 404


# --- a logo, que existia e nunca saia do banco ------------------------------

def test_logo_da_arena_chega_ao_card_da_quadra(client):
    """`Arena.logo` estava no banco e o painel ja deixava o dono subir, mas
    nenhum payload do jogador carregava o campo — a tela da quadra desenhava as
    iniciais do nome."""
    from app.core.database import SessionLocal
    from app.models import Arena

    arena = _arena_do_seed(client)
    with SessionLocal() as db:
        linha = db.get(Arena, uuid.UUID(arena["id"]))
        antes = linha.logo
        linha.logo = "https://exemplo.com/logo.png"
        db.commit()
    try:
        quadras = client.get("/api/quadras").json()["quadras"]
        minhas = [q for q in quadras if q["arenaId"] == arena["id"]]
        assert minhas and all(q["arenaLogo"] == "https://exemplo.com/logo.png" for q in minhas)
        assert _perfil(client, arena["id"]).json()["arena"]["logo"] == "https://exemplo.com/logo.png"
    finally:
        with SessionLocal() as db:
            linha = db.get(Arena, uuid.UUID(arena["id"]))
            linha.logo = antes
            db.commit()
