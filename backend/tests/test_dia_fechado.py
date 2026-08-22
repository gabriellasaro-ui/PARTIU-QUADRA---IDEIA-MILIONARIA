"""Dia FECHADO na grade — a decisao e do gerente da quadra.

Antes, "nao abrimos domingo" so podia ser dito APAGANDO a linha do domingo. E
`_day_window` trata ausencia de linha como "usa o horario padrao do court":
apagar o domingo fazia a quadra aparecer ABERTA. O gerente fazia a acao mais
natural possivel e obtinha o oposto do que quis, sem nenhum aviso.

Agora ausencia e fechamento sao coisas diferentes, e o servidor obedece as
duas.
"""
import uuid
from contextlib import contextmanager
from datetime import date, time, timedelta

from app.models import Court, CourtRecurringAvailability
from app.services.catalog import get_availability


def _quadra(db):
    return db.query(Court).first()


@contextmanager
def grade_do_dia(db, court_id, dow, *, faixas=None, fechado=False):
    """Troca a grade daquele dia da semana e DEVOLVE o que estava la.

    A primeira versao destes testes so apagava as linhas e seguia em frente —
    e apagou do seed compartilhado os dias que usou. Testes que rodam depois
    herdavam uma quadra com a grade diferente da que o seed montou, e o defeito
    aparecia longe daqui, em outro arquivo. Estado compartilhado se devolve
    como se pegou.
    """
    originais = db.query(CourtRecurringAvailability).filter_by(
        court_id=court_id, day_of_week=dow
    ).all()
    guardadas = [
        {"start_time": r.start_time, "end_time": r.end_time, "closed": r.closed}
        for r in originais
    ]
    for r in originais:
        db.delete(r)
    db.commit()

    for inicio, fim in (faixas or []):
        db.add(CourtRecurringAvailability(
            id=uuid.uuid4(), court_id=court_id, day_of_week=dow,
            start_time=inicio, end_time=fim, closed=fechado,
        ))
    db.commit()
    try:
        yield
    finally:
        db.query(CourtRecurringAvailability).filter_by(
            court_id=court_id, day_of_week=dow
        ).delete()
        for linha in guardadas:
            db.add(CourtRecurringAvailability(
                id=uuid.uuid4(), court_id=court_id, day_of_week=dow, **linha
            ))
        db.commit()


def _proximo(dow: int) -> date:
    """Proxima data futura naquele dia da semana (nunca hoje: hora ja passada
    marcaria tudo como busy e confundiria o teste com outro efeito)."""
    d = date.today() + timedelta(days=1)
    while d.weekday() != dow:
        d += timedelta(days=1)
    return d


def _conta(client, prefixo):
    email = f"{prefixo}-{uuid.uuid4().hex[:8]}@teste.com"
    r = client.post("/api/auth/register", json={
        "name": "Grade Teste", "email": email, "senha": "Senha123!",
    })
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _reservar(client, hdrs, court_id, dia, hora, dur=1):
    return client.post("/api/reservas", headers={
        **hdrs, "Idempotency-Key": uuid.uuid4().hex,
    }, json={"quadraId": str(court_id), "data": dia, "hora": hora, "dur": dur})


def test_sem_linha_a_quadra_usa_o_horario_padrao(client, db_session):
    """O fallback continua valendo para quem NUNCA configurou a grade."""
    court = _quadra(db_session)
    dow = 6
    with grade_do_dia(db_session, court.id, dow, faixas=[]):
        slots = get_availability(db_session, court.id, _proximo(dow).isoformat())
        assert slots, "sem configuracao a quadra deve abrir no padrao"


def test_dia_marcado_como_fechado_nao_tem_horario(client, db_session):
    """A acao do gerente vira ausencia de agenda, e nao horario padrao."""
    court = _quadra(db_session)
    dow = 6
    with grade_do_dia(db_session, court.id, dow,
                      faixas=[(time(8, 0), time(22, 0))], fechado=True):
        slots = get_availability(db_session, court.id, _proximo(dow).isoformat())
        assert slots == [], "dia fechado pelo gerente nao pode oferecer horario"


def test_reservar_em_dia_fechado_e_recusado(client, db_session):
    """A guarda de TELA nao basta: a agenda nem mostraria o horario, mas o POST
    aceitava. Relogio errado, aba velha ou chamada direta passariam por cima."""
    court = _quadra(db_session)
    dow = 6
    with grade_do_dia(db_session, court.id, dow,
                      faixas=[(time(8, 0), time(22, 0))], fechado=True):
        r = _reservar(client, _conta(client, "fechado"), court.id,
                      _proximo(dow).isoformat(), "10:00")
        assert r.status_code == 409
        assert "nao abre" in r.json()["detail"].lower().replace("ã", "a")


def test_reserva_fora_do_expediente_e_recusada(client, db_session):
    """Faltava por completo: so se conferia reserva sobreposta e manutencao.

    Dava para reservar as 3 da manha numa quadra que abre as 18h — a tela nem
    oferecia o horario, mas o POST aceitava.
    """
    court = _quadra(db_session)
    dow = 2
    dia = _proximo(dow).isoformat()
    with grade_do_dia(db_session, court.id, dow, faixas=[(time(18, 0), time(22, 0))]):
        hdrs = _conta(client, "madrugada")
        assert _reservar(client, hdrs, court.id, dia, "03:00").status_code == 409
        # E o horario que ESTA na faixa continua passando — a guarda nao pode
        # fechar a quadra junto.
        dentro = _reservar(client, hdrs, court.id, dia, "19:00")
        assert dentro.status_code == 200, dentro.text


def test_reserva_nao_pode_atravessar_o_fim_do_expediente(client, db_session):
    """3h a partir das 21h numa quadra que fecha as 22h nao cabe.

    A hora de INICIO esta dentro da faixa, entao uma checagem que so olhasse o
    inicio deixaria passar — e a quadra ficaria ocupada uma hora depois de
    fechar.
    """
    court = _quadra(db_session)
    dow = 3
    with grade_do_dia(db_session, court.id, dow, faixas=[(time(8, 0), time(22, 0))]):
        r = _reservar(client, _conta(client, "atravessa"), court.id,
                      _proximo(dow).isoformat(), "21:00", dur=3)
        assert r.status_code == 409
