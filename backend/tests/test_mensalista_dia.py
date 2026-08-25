"""Mensalista: o dia da semana escolhido, e o preco quando nao ha mensalidade.

Dois defeitos que se escondiam um atras do outro. O dia da semana chegava ao
backend, era gravado na coluna e nunca usado para calcular a data — as sessoes
saiam sempre a partir de HOJE. Quando a hora escolhida ja tinha passado, a
criacao morria com 409 falando de "um horario que ja passou" que ninguem havia
pedido; quando nao tinha, a pessoa marcava quinta e recebia quatro tercas.

Corrigido o primeiro, aparecia o segundo: quadra sem `price_monthly_cents`
levava `compute_quote(None, ...)` a um TypeError, e toda tentativa virava 500.
"""
from datetime import date, timedelta


def _quadra_visivel(client) -> dict:
    r = client.get("/api/quadras")
    assert r.status_code == 200, r.text
    dados = r.json()
    lista = dados.get("venues") or dados.get("quadras") or dados
    assert lista, "o seed precisa de ao menos uma quadra visivel"
    return lista[0]


def _login_jogador(client) -> dict:
    r = client.post("/api/auth/login", json={"email": "gabriel@email.com", "senha": "qadras123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _criar_mensalista(client, headers, quadra_id, dia, hora="19:00"):
    return client.post(
        "/api/reservas",
        json={"quadraId": quadra_id, "hora": hora, "dur": 1, "plano": "mensalista",
              "dia": dia, "pagamento": "pix"},
        headers={**headers, "Idempotency-Key": f"mens-{dia}-{hora}-{date.today()}"},
    )


def test_sessoes_caem_no_dia_da_semana_escolhido(client):
    headers = _login_jogador(client)
    quadra = _quadra_visivel(client)

    # Um dia que NAO e hoje, para o teste falhar se a data voltar a sair de
    # now_local() — com "hoje" o acerto seria coincidencia.
    dia_alvo = (date.today().weekday() + 2) % 7

    r = _criar_mensalista(client, headers, quadra["id"], dia_alvo)
    assert r.status_code == 200, r.text
    reservas = r.json()["reservas"]
    assert len(reservas) == 4, "mensalista sao quatro sessoes"

    dias = [date.fromisoformat(x["dateValue"]) for x in reservas]
    assert all(d.weekday() == dia_alvo for d in dias), \
        f"esperava todas em weekday={dia_alvo}, veio {[d.weekday() for d in dias]}"
    # Semanais e no futuro: a primeira nunca pode cair antes de hoje.
    assert dias[0] >= date.today()
    for anterior, seguinte in zip(dias, dias[1:]):
        assert seguinte - anterior == timedelta(weeks=1)


def test_parse_start_anda_ate_o_dia_escolhido():
    """O calculo da data, direto — sem depender da hora do relogio nem do seed.

    Pela rota, a metade interessante (hora de hoje que ja passou) so acontece
    em parte do dia e o teste virava um skip. Aqui os dois ramos rodam sempre.
    """
    from app.core.timezone import now_local
    from app.services.bookings import _parse_start

    agora = now_local()

    # Um dia que nao e hoje: a data tem de ANDAR ate ele.
    alvo = (agora.weekday() + 3) % 7
    inicio = _parse_start(None, "19:00", alvo)
    assert inicio.astimezone(agora.tzinfo).weekday() == alvo
    assert inicio > agora

    # Hoje, numa hora que com certeza ja passou: vai para a semana seguinte,
    # e nao levanta o 409 de "horario que ja passou".
    if agora.hour > 0:
        hoje = _parse_start(None, "00:00", agora.weekday())
        local = hoje.astimezone(agora.tzinfo)
        assert local.weekday() == agora.weekday()
        assert local.date() > agora.date()

    # Data explicita continua mandando: o dia da semana nao pode reescreve-la.
    fixa = _parse_start("2026-12-25", "10:00", 0)
    assert fixa.astimezone(agora.tzinfo).date().isoformat() == "2026-12-25"


def test_cotacao_nao_quebra_sem_mensalidade():
    """`compute_quote(None, ...)` derrubava a criacao inteira com TypeError —
    500 para quem so queria virar mensalista numa quadra sem mensalidade."""
    from app.services.bookings import compute_quote

    valores = compute_quote(None, 1, plan="mensalista")
    assert valores["subtotal_cents"] == 0
    assert valores["total_cents"] == 0


def test_mensalidade_ausente_vira_quatro_vezes_a_hora(client):
    """A quadra sem `price_monthly_cents` cobra o mesmo que o card ja mostrava.

    Mexe direto no banco porque o seed cadastra mensalidade — e o caso que
    interessa e justamente a ausencia dela.
    """
    import uuid as _uuid

    from app.core.database import SessionLocal
    from app.models import Court

    headers = _login_jogador(client)
    quadra = _quadra_visivel(client)

    with SessionLocal() as db:
        court = db.get(Court, _uuid.UUID(quadra["id"]))
        anterior = court.price_monthly_cents
        court.price_monthly_cents = None
        db.commit()
    try:
        r = _criar_mensalista(client, headers, quadra["id"], (date.today().weekday() + 4) % 7)
        assert r.status_code == 200, r.text
        assert r.json()["reservas"][0]["subtotal"] == quadra["price"] * 4
    finally:
        with SessionLocal() as db:
            court = db.get(Court, _uuid.UUID(quadra["id"]))
            court.price_monthly_cents = anterior
            db.commit()
