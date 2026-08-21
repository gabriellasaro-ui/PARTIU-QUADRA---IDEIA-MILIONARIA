"""Casos de uso de peladas — Fase 9.

A pelada nasce de uma reserva (doc §9.5): `POST /api/peladas` exige
`reservationCode`/`bookingId` e e idempotente por (booking, dateISO) — a tela
nao duplica pelada quando recarrega. Mensalista gera 4 peladas com +7 dias;
avulsa gera 1 na data da reserva. Data/hora/arena/esporte sao sempre
derivados da reserva no servidor.
"""
import uuid
from datetime import datetime, time, timedelta

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..core.timezone import TZ, now_local
from ..core.ws import publish_user_event
from ..models import (
    ATTENDANCE_NAO,
    ATTENDANCE_SIM,
    ATTENDANCE_TALVEZ,
    ATTENDANCE_VALUES,
    NOTIF_PELADA_CRIADA,
    NOTIF_PELADA_PRESENCA,
    PELADA_KIND_AVULSA,
    PELADA_KIND_CLUBE,
    PELADA_STATUS_AGENDADA,
    PLAN_MENSALISTA,
    STATUS_CONFIRMED,
    STATUS_PAYMENT_CONFIRMED,
    STATUS_PENDING_PAYMENT,
    STATUS_REQUESTED,
    Pelada,
)
from ..repositories import bookings as bookings_repo
from ..repositories import clubs as clubs_repo
from ..repositories import peladas as repo
from .catalog import _as_local

_WEEKDAYS = [
    "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo",
]
# Status da reserva que ainda podem virar pelada.
_ELIGIBLE = {STATUS_PENDING_PAYMENT, STATUS_PAYMENT_CONFIRMED, STATUS_REQUESTED, STATUS_CONFIRMED}


def _pelada_dict(db: Session, pelada: Pelada) -> dict:
    attendance = {
        str(a.user_id): a.value for a in repo.list_attendance(db, pelada.id)
    }
    return {
        "id": str(pelada.id),
        "clubId": str(pelada.club_id) if pelada.club_id else None,
        "kind": pelada.kind,
        "title": pelada.title,
        "venueId": str(pelada.arena_id),
        "venueName": pelada.venue_name,
        "sport": pelada.sport,
        "dateISO": pelada.date_iso,
        "startTime": pelada.start_time,
        "duration": pelada.duration_min,
        "maxPlayers": pelada.max_players,
        "organizerId": str(pelada.organizer_id),
        "plan": pelada.plan,
        "reservationCode": pelada.reservation_code,
        "status": pelada.status,
        "attendance": attendance,
        # O front ja contava isto sozinho a cada card. Agora vem do servidor
        # porque a notificacao tambem precisa do numero — e duas contas do
        # mesmo valor, uma na tela e outra no aviso, divergem no dia em que
        # alguem mudar a regra de um lado so.
        "going": sum(1 for v in attendance.values() if v == ATTENDANCE_SIM),
        "faltam": max(0, pelada.max_players - sum(1 for v in attendance.values() if v == ATTENDANCE_SIM)),
    }


def convocar_faltantes(db: Session, *, horas: int = 24) -> int:
    """Chama quem ainda nao respondeu, quando falta gente para a pelada.

    E o que fecha o ciclo do clube: o grupo existe para a pelada nao ficar
    vazia, e ate aqui ninguem era lembrado de confirmar.

    Tres cortes, e cada um evita um jeito diferente de irritar as pessoas:

      SO QUEM NAO RESPONDEU. Quem ja disse sim, talvez ou nao decidiu — mandar
      de novo e cobranca, nao lembrete.

      SO PELADA DE CLUBE COM VAGA. Se ja tem gente suficiente, nao falta
      ninguem, e o aviso vira ruido.

      UMA VEZ POR PELADA (`chamada_em`). A tarefa roda em ciclo curto; sem a
      marca, as mesmas pessoas seriam avisadas a cada volta ate a hora do
      jogo.

    Devolve quantas peladas foram convocadas.
    """
    from ..models import NOTIF_PELADA_FALTAM, PELADA_KIND_CLUBE

    agora = now_local()
    limite = agora + timedelta(hours=horas)

    convocadas = 0
    for pelada in repo.list_agendadas_sem_chamada(db):
        if pelada.kind != PELADA_KIND_CLUBE or not pelada.club_id:
            continue
        quando = _quando(pelada)
        # Janela: comeca depois de agora e antes do limite. Pelada que ja
        # passou nao se enche mais, e a de daqui a uma semana nao e urgente.
        if quando is None or not (agora < quando <= limite):
            continue

        presencas = {str(a.user_id): a.value for a in repo.list_attendance(db, pelada.id)}
        vao = sum(1 for v in presencas.values() if v == ATTENDANCE_SIM)
        faltam = pelada.max_players - vao

        # Marca ANTES de decidir se avisa: pelada cheia tambem nao deve voltar
        # a ser examinada a cada ciclo ate o jogo acontecer.
        pelada.chamada_em = agora
        if faltam <= 0:
            continue

        alvos = [
            m.user_id
            for m, _ in clubs_repo.list_members(db, pelada.club_id)
            if str(m.user_id) not in presencas
        ]
        if not alvos:
            continue

        quantos = "1 vaga" if faltam == 1 else f"{faltam} vagas"
        for uid in alvos:
            _notify(
                db, uid, NOTIF_PELADA_FALTAM,
                "Falta gente na pelada",
                f"{pelada.title} é {_quando_por_extenso(quando)} e ainda tem {quantos}.",
                {
                    "peladaId": str(pelada.id),
                    "clubId": str(pelada.club_id),
                    "title": pelada.title,
                    "faltam": faltam,
                },
            )
        convocadas += 1

    db.commit()
    return convocadas


def _quando(pelada) -> datetime | None:
    """Data e hora da pelada como datetime local."""
    try:
        dia = datetime.strptime(pelada.date_iso, "%Y-%m-%d").date()
        hora, minuto = (int(x) for x in str(pelada.start_time).split(":")[:2])
    except (TypeError, ValueError):
        return None
    return datetime.combine(dia, time(hour=hora, minute=minuto), tzinfo=TZ)


def _quando_por_extenso(quando: datetime) -> str:
    """"hoje as 20h" / "amanha as 20h" / "sabado as 20h".

    O texto vai para a barra de notificacoes, onde a pessoa le de passagem —
    "2026-08-22 20:00" exige traduzir mentalmente para saber se e urgente.
    """
    hoje = now_local().date()
    dias = (quando.date() - hoje).days
    hora = quando.strftime("%Hh%M").replace("h00", "h")
    if dias == 0:
        return f"hoje às {hora}"
    if dias == 1:
        return f"amanhã às {hora}"
    nomes = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"]
    return f"{nomes[quando.weekday()]} às {hora}"


def list_peladas(db: Session, user) -> list[dict]:
    return [_pelada_dict(db, p) for p in repo.list_for_user(db, user.id)]


def create_from_booking(db: Session, user, body) -> tuple[list[dict], bool]:
    if body.bookingId:
        booking = bookings_repo.get_booking(db, body.bookingId)
        if booking is not None:
            booking = booking[0]
    else:
        code = (body.reservationCode or "").strip().upper()
        booking = bookings_repo.get_booking_by_code(db, code) if code else None
    if booking is None:
        raise HTTPException(status_code=404, detail="Reserva nao encontrada")
    if booking.user_id is None or str(booking.user_id) != str(user.id):
        raise HTTPException(status_code=403, detail="Você não pode criar pelada desta reserva")
    if booking.status not in _ELIGIBLE:
        raise HTTPException(status_code=409, detail="Reserva não pode virar pelada neste estado")

    if body.clubId:
        club = clubs_repo.get_club(db, body.clubId)
        if club is None or not clubs_repo.is_member(db, club.id, user.id):
            raise HTTPException(status_code=403, detail="Você não faz parte deste clube")
    else:
        club = None
    kind = PELADA_KIND_CLUBE if club is not None else PELADA_KIND_AVULSA

    _, court, arena = bookings_repo.get_booking(db, booking.id)
    start_local = _as_local(booking.start_at)
    start_time = start_local.strftime("%H:%M")
    title = body.title or (
        f"Pelada de {_WEEKDAYS[booking.weekday]}" if booking.plan == PLAN_MENSALISTA and booking.weekday is not None
        else f"Jogo na {arena.name}"
    )
    max_players = body.maxPlayers or 14

    dates = _session_dates(booking, start_local)
    created = []
    replay = True
    for date_iso in dates:
        existing = repo.by_booking_date(db, booking.id, date_iso)
        if existing is not None:
            created.append(existing)
            continue
        replay = False
        pelada = Pelada(
            id=uuid.uuid4(),
            club_id=club.id if club else None,
            source_booking_id=booking.id,
            kind=kind,
            title=title,
            arena_id=arena.id,
            venue_name=arena.name,
            sport=court.sport if court else arena.name,
            date_iso=date_iso,
            start_time=start_time,
            duration_min=booking.duration_h * 60,
            max_players=max_players,
            organizer_id=user.id,
            plan=booking.plan,
            reservation_code=booking.code,
            status=PELADA_STATUS_AGENDADA,
        )
        db.add(pelada)
        created.append(pelada)
        repo.upsert_attendance(db, pelada.id, user.id, ATTENDANCE_SIM)
    db.commit()

    # Notificacao pos-commit: membros do clube (ou o proprio organizador, na avulsa).
    member_ids = _member_ids_for(db, peladas_of=created, club=club)
    data = {"peladaId": str(created[0].id), "title": title}
    for uid in member_ids:
        if str(uid) == str(user.id):
            continue
        _notify(
            db, uid, NOTIF_PELADA_CRIADA, "Nova pelada agendada",
            f"{title} em {created[0].venue_name}.",
            data,
        )
    for pelada in created:
        payload = _pelada_dict(db, pelada)
        for uid in member_ids:
            publish_user_event(uid, {"type": "pelada.updated", "pelada": payload})
    return [_pelada_dict(db, p) for p in created], replay


def _session_dates(booking, start_local):
    base = start_local.strftime("%Y-%m-%d")
    if booking.plan == PLAN_MENSALISTA:
        return [
            (_as_local(booking.start_at) + timedelta(days=i * 7)).strftime("%Y-%m-%d")
            for i in range(4)
        ]
    return [base]


def _member_ids_for(db: Session, peladas_of, club) -> list[uuid.UUID]:
    if club is not None:
        return [m.user_id for m, _ in clubs_repo.list_members(db, club.id)]
    ids = {p.organizer_id for p in peladas_of}
    return list(ids)


def set_attendance(db: Session, user, pelada_id, value: str) -> dict:
    if value not in ATTENDANCE_VALUES:
        raise HTTPException(status_code=422, detail="Presença deve ser sim, talvez ou nao")
    pelada = repo.get_pelada(db, pelada_id)
    if pelada is None:
        raise HTTPException(status_code=404, detail="Pelada nao encontrada")
    if pelada.kind == PELADA_KIND_CLUBE and pelada.club_id is not None:
        if not clubs_repo.is_member(db, pelada.club_id, user.id):
            raise HTTPException(
                status_code=403, detail="Você não faz parte deste clube"
            )
    row = repo.upsert_attendance(db, pelada.id, user.id, value)
    db.commit()

    if str(pelada.organizer_id) != str(user.id):
        label = {"sim": "vai", "talvez": "talvez vá", "nao": "não vai"}[value]
        _notify(
            db, pelada.organizer_id, NOTIF_PELADA_PRESENCA,
            "Presença na pelada",
            f"{user.name} {label} a {pelada.title}.",
            {"peladaId": str(pelada.id), "title": pelada.title},
        )
    payload = _pelada_dict(db, pelada)
    for uid in _participant_audience(db, pelada):
        publish_user_event(uid, {"type": "pelada.updated", "pelada": payload})
    return payload


def _participant_audience(db: Session, pelada: Pelada) -> list[uuid.UUID]:
    ids = set(repo.participant_ids(db, pelada.id))
    ids.add(pelada.organizer_id)
    if pelada.club_id is not None:
        ids.update(m.user_id for m, _ in clubs_repo.list_members(db, pelada.club_id))
    return list(ids)


def _notify(db: Session, user_id, type_: str, title: str, body: str, data: dict) -> None:
    from .notifications import emit_notification

    emit_notification(db, user_id, type=type_, title=title, body=body, data=data)
