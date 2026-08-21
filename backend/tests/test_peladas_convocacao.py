"""Convocacao de faltantes — Fase 21.

Fecha o ciclo do clube: o grupo existe para a pelada nao ficar vazia, e ate
aqui ninguem era lembrado de confirmar presenca.

Cada teste aqui protege uma forma diferente de irritar as pessoas a ponto de
elas desligarem as notificacoes do app:
  - avisar quem ja respondeu (isso e cobranca, nao lembrete);
  - avisar quando a pelada ja esta cheia (ruido);
  - avisar de novo a cada ciclo da tarefa (o pior de todos).
"""
import uuid
from datetime import timedelta

from sqlalchemy import select


def _conta(client, nome="Jogador") -> tuple[dict, str]:
    email = f"conv-{uuid.uuid4().hex[:10]}@teste.com"
    r = client.post("/api/auth/register", json={
        "email": email, "name": nome, "senha": "Senha123!",
    })
    assert r.status_code == 200, r.text
    d = r.json()
    return {"Authorization": f"Bearer {d['token']}"}, d["user"]["id"]


def _pelada_de_clube(*, daqui_horas=20, max_players=10, presencas=None, membros=3):
    """Monta clube + pelada direto no banco.

    Pelo caminho da API a pelada so nasce de uma reserva confirmada, o que
    traria pagamento e aprovacao para dentro de um teste que nao e sobre isso.
    """
    from app.core.database import SessionLocal
    from app.core.timezone import now_local
    from app.models import (
        CLUB_ROLE_DONO,
        CLUB_ROLE_MEMBRO,
        PELADA_KIND_CLUBE,
        Arena,
        Club,
        ClubMember,
        Pelada,
        PeladaAttendance,
        User,
    )

    with SessionLocal() as db:
        pessoas = db.execute(select(User).limit(membros + 1)).scalars().all()
        arena = db.execute(select(Arena).limit(1)).scalar_one()
        dono = pessoas[0]

        club = Club(
            id=uuid.uuid4(), name=f"Clube {uuid.uuid4().hex[:5]}",
            code=uuid.uuid4().hex[:6].upper(), sport="Futsal",
            city="Goiânia", state="GO", owner_id=dono.id,
        )
        db.add(club)
        db.flush()
        for i, p in enumerate(pessoas[: membros + 1]):
            db.add(ClubMember(
                club_id=club.id, user_id=p.id,
                role=CLUB_ROLE_DONO if i == 0 else CLUB_ROLE_MEMBRO,
            ))

        quando = now_local() + timedelta(hours=daqui_horas)
        pelada = Pelada(
            id=uuid.uuid4(), club_id=club.id, kind=PELADA_KIND_CLUBE,
            title="Pelada de teste", arena_id=arena.id, venue_name=arena.name,
            sport="Futsal", date_iso=quando.strftime("%Y-%m-%d"),
            start_time=quando.strftime("%H:%M"), duration_min=60,
            max_players=max_players, organizer_id=dono.id, plan="avulso",
        )
        db.add(pelada)
        db.flush()

        for indice, valor in (presencas or {}).items():
            # Chave composta (pelada_id, user_id): a tabela nao tem coluna id.
            db.add(PeladaAttendance(
                pelada_id=pelada.id, user_id=pessoas[indice].id, value=valor,
            ))
        db.commit()
        return str(pelada.id), str(club.id), [str(p.id) for p in pessoas[: membros + 1]]


def _convocar():
    from app.core.database import SessionLocal
    from app.services import peladas as svc

    with SessionLocal() as db:
        return svc.convocar_faltantes(db)


def _avisados(pelada_id) -> set:
    from app.core.database import SessionLocal
    from app.models import NOTIF_PELADA_FALTAM, Notification

    with SessionLocal() as db:
        linhas = db.execute(
            select(Notification).where(Notification.type == NOTIF_PELADA_FALTAM)
        ).scalars().all()
        return {
            str(n.user_id) for n in linhas
            if (n.data or {}).get("peladaId") == pelada_id
        }


def test_avisa_so_quem_nao_respondeu(client):
    """Quem ja disse sim, talvez ou nao decidiu. Insistir e cobranca."""
    pid, _, pessoas = _pelada_de_clube(presencas={0: "sim", 1: "nao"})
    assert _convocar() >= 1
    avisados = _avisados(pid)
    assert pessoas[0] not in avisados   # disse sim
    assert pessoas[1] not in avisados   # disse nao
    assert pessoas[2] in avisados       # nao respondeu
    assert pessoas[3] in avisados


def test_talvez_tambem_conta_como_respondido(client):
    """"Talvez" e uma resposta. Quem respondeu nao e cobrado de novo."""
    pid, _, pessoas = _pelada_de_clube(presencas={2: "talvez"})
    _convocar()
    assert pessoas[2] not in _avisados(pid)


def test_pelada_cheia_nao_avisa(client):
    """Nao falta ninguem — o aviso seria puro ruido."""
    pid, _, pessoas = _pelada_de_clube(
        max_players=2, presencas={0: "sim", 1: "sim"},
    )
    _convocar()
    assert _avisados(pid) == set()


def test_nao_avisa_duas_vezes(client):
    """A armadilha mais cara: a tarefa roda em ciclo curto.

    Sem a marca `chamada_em`, as mesmas pessoas seriam avisadas a cada volta
    ate a hora do jogo — o jeito mais rapido de ensinar alguem a desligar as
    notificacoes do app.
    """
    pid, _, _ = _pelada_de_clube()
    assert _convocar() >= 1
    quantos = len(_avisados(pid))
    assert quantos > 0

    # Tres ciclos seguidos nao podem acrescentar nada.
    _convocar()
    _convocar()
    _convocar()
    assert len(_avisados(pid)) == quantos


def test_pelada_distante_nao_e_convocada_ainda(client):
    """Daqui a uma semana nao e urgente; avisar cedo demais e esquecido."""
    pid, _, _ = _pelada_de_clube(daqui_horas=24 * 7)
    _convocar()
    assert _avisados(pid) == set()


def test_pelada_que_ja_passou_nao_e_convocada(client):
    """Nao se enche mais."""
    pid, _, _ = _pelada_de_clube(daqui_horas=-5)
    _convocar()
    assert _avisados(pid) == set()


def test_going_e_faltam_no_contrato(client):
    """O front contava sozinho; agora o numero vem do servidor, para a tela e
    a notificacao nao divergirem."""
    from app.core.database import SessionLocal
    from app.models import Pelada
    from app.services.peladas import _pelada_dict

    pid, _, _ = _pelada_de_clube(max_players=10, presencas={0: "sim", 1: "sim", 2: "nao"})
    with SessionLocal() as db:
        pelada = db.get(Pelada, uuid.UUID(pid))
        dados = _pelada_dict(db, pelada)
    assert dados["going"] == 2       # so os "sim"
    assert dados["faltam"] == 8      # 10 - 2


def test_texto_do_aviso_diz_quando_e(client):
    """"amanha as 20h" e legivel de passagem; "2026-08-22 20:00" exige
    traduzir mentalmente para saber se e urgente."""
    from app.core.database import SessionLocal
    from app.models import NOTIF_PELADA_FALTAM, Notification

    pid, _, _ = _pelada_de_clube(daqui_horas=20)
    _convocar()
    with SessionLocal() as db:
        aviso = db.execute(
            select(Notification).where(Notification.type == NOTIF_PELADA_FALTAM)
        ).scalars().all()
        alvo = next(n for n in aviso if (n.data or {}).get("peladaId") == pid)
    assert "às" in alvo.body
    assert any(p in alvo.body for p in ("hoje", "amanhã")) or "às" in alvo.body
    assert "vaga" in alvo.body
