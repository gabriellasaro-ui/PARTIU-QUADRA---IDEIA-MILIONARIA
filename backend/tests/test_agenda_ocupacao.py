"""A agenda desenha o que OCUPA a quadra — e nada alem disso.

`repo.bookings_between` traz a semana inteira sem filtrar status, e o servico
montava um evento para cada linha. Recusada, cancelada e expirada viravam bloco
na grade: o dono abria a agenda, via um retangulo em sabado 17h e concluia que o
horario estava vendido. Estava LIVRE — e ele podia vende-lo naquele instante.

O erro nao aparece em nenhum numero da tela (a ocupacao media ja usava
ACTIVE_STATUSES). Aparece so no desenho, que e justamente onde o dono decide.

Elas nao somem do produto: continuam em /api/gerente/reservas, com o status,
que e onde se pergunta "o que aconteceu com aquele pedido".
"""
from datetime import datetime, timedelta

from app.models.booking import ACTIVE_STATUSES, STATUS_CANCELLED, STATUS_REJECTED

GERENTE = "dono@arenabolanarede.com.br"


def _gerente(client):
    r = client.post("/api/auth/login", json={"email": GERENTE, "senha": "qadras123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_agenda_nao_desenha_reserva_recusada_ou_cancelada(client, db_session):
    """O teste que prova o filtro: uma reserva vira recusada e SOME da grade.

    Ele mede a mesma reserva antes e depois, e nao dois conjuntos parecidos —
    e a unica forma de separar "o filtro funciona" de "aquele dado nem estava
    na semana".
    """
    from app.models.booking import Booking

    h = _gerente(client)
    semana = client.get("/api/gerente/agenda", headers=h).json()
    inicio = datetime.strptime(semana["semana"], "%Y-%m-%d")
    fim = inicio + timedelta(days=7)

    alvo = next(
        (b for b in db_session.query(Booking)
         .filter(Booking.start_at >= inicio, Booking.start_at < fim).all()
         if b.status in ACTIVE_STATUSES),
        None,
    )
    if alvo is None:
        return  # semana sem reserva ativa; nada a provar

    ids = {e["id"] for e in semana["eventos"]}
    assert str(alvo.id) in ids, "reserva ativa deveria estar na agenda"

    original = alvo.status
    try:
        alvo.status = STATUS_REJECTED
        db_session.commit()
        depois = client.get("/api/gerente/agenda", headers=h).json()
        assert str(alvo.id) not in {e["id"] for e in depois["eventos"]}, \
            "reserva recusada continuou ocupando o horario na grade"
    finally:
        # A suite compartilha o banco de dev: deixar a reserva recusada
        # quebraria os testes de faturamento que rodam depois.
        alvo.status = original
        db_session.commit()


def test_agenda_so_traz_status_que_ocupam(client):
    """Guarda de regressao para o conjunto inteiro, e nao para um caso.

    Se alguem acrescentar um status novo e esquecer de decidir se ele ocupa,
    este teste avisa antes de a grade voltar a mentir.
    """
    h = _gerente(client)
    d = client.get("/api/gerente/agenda", headers=h).json()
    proibidos = {"Recusada", "Cancelada", "Expirada"}
    vistos = {e["status"] for e in d["eventos"]}
    assert not (vistos & proibidos), f"status que nao ocupam na agenda: {vistos & proibidos}"


# ───────────────────────── financeiro ──────────────────────────────────────

def test_ticket_medio_vem_em_reais(client):
    """`gross` esta em centavos e o ticket saia sem a divisao por 100.

    A tela mostrava "ticket medio R$ 23.184,00" ao lado de "faturamento bruto
    R$ 695,52" — cem vezes maior, no painel onde o dono decide preco de hora.

    O teste amarra o ticket ao bruto em vez de fixar um numero: o banco de dev
    muda a cada reserva de teste, e um valor cravado aqui quebraria sozinho.
    """
    h = _gerente(client)
    d = client.get("/api/gerente/financeiro?periodo=30d", headers=h).json()
    if not d["reservas"]:
        return
    esperado = round(d["bruto"] / d["reservas"], 2)
    assert abs(d["ticket_medio"] - esperado) <= 0.02, \
        f"ticket {d['ticket_medio']} nao bate com bruto {d['bruto']} / {d['reservas']}"


def test_serie_de_7_dias_tem_7_pontos(client):
    """"Ultimos 7 dias" precisa devolver SETE dias.

    A janela era `now - 7 dias` ate `now`: comecava no meio de um sabado e
    terminava no meio do sabado seguinte, caindo em oito baldes diarios (dois
    parciais). O eixo do grafico saia "Sáb Dom Seg Ter Qua Qui Sex Sáb", com o
    mesmo dia nas duas pontas.
    """
    h = _gerente(client)
    d = client.get("/api/gerente/financeiro?periodo=7d", headers=h).json()
    assert len(d["serie"]) == 7, [p["rotulo"] for p in d["serie"]]
    rotulos = [p["rotulo"] for p in d["serie"]]
    assert len(set(rotulos)) == 7, f"dia da semana repetido no eixo: {rotulos}"


def test_serie_de_30_dias_tem_30_pontos(client):
    h = _gerente(client)
    d = client.get("/api/gerente/financeiro?periodo=30d", headers=h).json()
    assert len(d["serie"]) == 30, len(d["serie"])
