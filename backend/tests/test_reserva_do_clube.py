"""Reserva feita EM NOME de um clube — quem pode, e o que o dono da quadra ve.

DUAS COISAS, e elas se sustentam uma na outra.

1. QUEM PODE. Marcar quadra pelo clube compromete a turma inteira: data,
   horario e, no mensalista, quatro semanas. Se qualquer membro pudesse fazer
   isso, o clube viraria um canal por onde qualquer um convoca (e cobra) todo
   mundo. Dono e gerente marcam; jogador so responde se vai. Os cargos ja
   existiam no modelo — o que faltava era a porta usar isso.

   A checagem vive no SERVICO, e nao na tela: tela some, rota fica.

2. O QUE O GERENTE VE. "Gabriel Lasaro" nao diz nada ao dono da quadra — e so
   mais um nome. "Bola Murcha FC" e outra conversa, especialmente num
   mensalista, onde ele esta cedendo quatro semanas. Clube que joga ali toda
   quinta e o cliente que ele quer manter.

   Para isso o clube viaja com a RESERVA, e nao so com a pelada: a pelada so
   nasce DEPOIS da aprovacao, e a decisao de aprovar acontece antes dela
   existir.
"""
import itertools
import uuid
from datetime import date, timedelta

_SLOT = itertools.count(40)


def _login(client, email):
    r = client.post("/api/auth/login", json={"email": email, "senha": "qadras123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _meu_id(client, headers):
    d = client.get("/api/perfil", headers=headers).json()
    return d.get("id") or d.get("perfil", {}).get("id")


def _clube(quem_id, cargo, *, dono_id=None):
    """Cria o clube DIRETO no banco, e nao pela API.

    Nao e o cadastro de clube que esta sob teste aqui, e a API impoe teto de 2
    clubes por dono — com cinco casos neste arquivo (mais os de outro que roda
    na mesma base), os testes passariam a falhar por um limite que nao tem
    relacao nenhuma com o que medem.
    """
    from app.core.database import SessionLocal
    from app.models import Club, ClubMember

    club_id = uuid.uuid4()
    with SessionLocal() as db:
        db.add(Club(
            id=club_id,
            name=f"Clube {uuid.uuid4().hex[:5]}",
            code=uuid.uuid4().hex[:6].upper(),
            sport="Futebol Society",
            city="Belo Horizonte",
            state="MG",
            owner_id=uuid.UUID(dono_id or quem_id),
        ))
        db.add(ClubMember(club_id=club_id, user_id=uuid.UUID(quem_id), role=cargo))
        db.commit()
    return {"id": str(club_id)}


def _marcar(client, headers, *, club_id=None, plano="avulso"):
    quadra = client.get("/api/quadras").json()["quadras"][0]
    n = next(_SLOT)
    corpo = {
        "quadraId": quadra["id"],
        "data": (date.today() + timedelta(days=20 + n)).isoformat(),
        "hora": f"{9 + (n % 9):02d}:00",
        "dur": 1, "plano": plano, "pagamento": "pix",
    }
    if club_id:
        corpo["clubeId"] = club_id
    if plano == "mensalista":
        corpo["dia"] = 3
    return client.post("/api/reservas", json=corpo,
                       headers={**headers, "Idempotency-Key": uuid.uuid4().hex})


def test_gerente_do_clube_marca_em_nome_dele(client):
    jogador = _login(client, "gabriel@email.com")
    clube = _clube(_meu_id(client, jogador), cargo="admin")

    r = _marcar(client, jogador, club_id=clube["id"])
    assert r.status_code == 200, r.text


def test_jogador_comum_nao_marca_pelo_clube(client):
    jogador = _login(client, "gabriel@email.com")
    clube = _clube(_meu_id(client, jogador), cargo="membro")

    r = _marcar(client, jogador, club_id=clube["id"])
    assert r.status_code == 403, r.text
    detalhe = r.json()["detail"].lower()
    # Tem de dizer QUAL cargo falta e o que fazer — "sem permissao" deixa a
    # pessoa achando que o convite dela nao valeu.
    assert "gerentes" in detalhe and "gestão" in detalhe


def test_quem_nao_e_do_clube_leva_outra_mensagem(client):
    """"Nao faz parte" e "voce e so jogador" sao problemas diferentes."""
    de_fora = _login(client, "gabriel@email.com")
    outra = _login(client, "mariana@email.com")
    # Clube de outra pessoa, do qual `de_fora` NAO e membro.
    clube = _clube(_meu_id(client, outra), cargo="dono")

    r = _marcar(client, de_fora, club_id=clube["id"])
    assert r.status_code == 403, r.text
    assert "não faz parte" in r.json()["detail"].lower()


def test_reserva_sem_clube_continua_funcionando(client):
    """A reserva pessoal e a maioria; nada nela pode ter mudado."""
    jogador = _login(client, "gabriel@email.com")
    r = _marcar(client, jogador)
    assert r.status_code == 200, r.text


def test_o_dono_da_quadra_ve_de_qual_clube_e(client):
    jogador = _login(client, "gabriel@email.com")
    clube = _clube(_meu_id(client, jogador), cargo="admin")

    r = _marcar(client, jogador, club_id=clube["id"], plano="mensalista")
    assert r.status_code == 200, r.text

    gerente = _login(client, "dono@arenabolanarede.com.br")
    lista = client.get("/api/gerente/reservas", headers=gerente)
    assert lista.status_code == 200, lista.text

    linha = next((x for x in lista.json()["reservas"]
                  if (x.get("clube") or {}).get("id") == clube["id"]), None)
    assert linha is not None, "a reserva do clube tem de chegar identificada na fila do gerente"
    # E no mensalista, junto da recorrencia: e a combinacao "clube + toda
    # quinta" que muda a decisao de aprovar.
    assert linha["plan"] == "mensalista"
    assert linha["recorrencia"], "mensalista sem o dia da semana esconde o compromisso"


def test_pelada_herda_o_clube_da_reserva(client):
    """Sem herdar, a escolha teria de ser feita duas vezes — e duas fontes para
    o mesmo fato divergem: bastava a segunda tela falhar para o gerente ver o
    clube e a pelada nascer avulsa, sem avisar ninguem."""
    from app.core.database import SessionLocal
    from app.models import Booking, STATUS_CONFIRMED

    jogador = _login(client, "gabriel@email.com")
    clube = _clube(_meu_id(client, jogador), cargo="admin")

    r = _marcar(client, jogador, club_id=clube["id"])
    assert r.status_code == 200, r.text
    reserva = r.json()["reservas"][0]

    with SessionLocal() as db:
        b = db.get(Booking, uuid.UUID(reserva["id"]))
        b.status = STATUS_CONFIRMED
        db.commit()

    # Sem passar clubId nenhum: ele tem de vir da reserva.
    r = client.post("/api/peladas", json={"bookingId": reserva["id"]}, headers=jogador)
    assert r.status_code == 200, r.text
    pelada = r.json()["peladas"][0]
    assert str(pelada["clubId"]) == clube["id"]
    assert pelada["kind"] == "clube"
