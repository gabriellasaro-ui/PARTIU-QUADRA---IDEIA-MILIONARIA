"""Casos de uso de partidas (Game Day) — Fase 9.

A partida e materializada a partir da reserva confirmada no GET
`/api/partidas/ativa` (id estavel para as mutacoes) e a fase e derivada dos
timestamps, igual ao frontend (`matchPhaseNow`). Mutacoes de placar/gol/
cartao/times/fim exigem o organizador da reserva; presenca/atraso/nota/midia
sao de qualquer participante.
"""
import uuid
from datetime import timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..core.timezone import now_local
from ..core.ws import publish_user_event
from ..models import (
    MATCH_EVENT_GOAL,
    MATCH_EVENT_RED,
    MATCH_EVENT_YELLOW,
    MATCH_EVENT_TYPES,
    MATCH_PHASE_DURING_GAME,
    MATCH_PHASE_POST_GAME,
    MATCH_PHASE_PRE_GAME,
    MATCH_STATUS_ENDED,
    MATCH_STATUS_LIVE,
    MATCH_STATUS_SCHEDULED,
    NOTIF_PARTIDA_ATRASO,
    NOTIF_PARTIDA_ENCERRADA,
    NOTIF_PARTIDA_PRESENCA,
    STATUS_CONFIRMED,
    Booking,
    ClubMember,
    Match,
    MatchPlayer,
    Pelada,
    User,
)
from ..repositories import bookings as bookings_repo
from ..repositories import clubs as clubs_repo
from ..repositories import matches as repo
from .catalog import _as_local

_ATIVA_WINDOW_H = 48
_WEEKDAYS_FULL = [
    "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo",
]
_CARD_TYPES = (MATCH_EVENT_YELLOW, MATCH_EVENT_RED)
_PLAYER_FIELDS = {"id", "name", "position", "rating", "avatar"}


def _phase(match: Match, now) -> str:
    if match.status == MATCH_STATUS_ENDED:
        return MATCH_PHASE_POST_GAME
    if match.status == MATCH_STATUS_LIVE:
        return MATCH_PHASE_DURING_GAME
    start = _as_local(match.start_at)
    end = _as_local(match.end_at)
    if start is None or end is None:
        return MATCH_PHASE_PRE_GAME
    if now >= end:
        return MATCH_PHASE_POST_GAME
    if start <= now < end:
        return MATCH_PHASE_DURING_GAME
    return MATCH_PHASE_PRE_GAME


def _player_dict(p: MatchPlayer) -> dict:
    return {
        "id": str(p.user_id),
        "name": p.name,
        "position": p.position or "Jogador",
        "rating": p.rating,
        "avatar": "",
        "confirmed": p.confirmed,
        "delay": p.delay_minutes,
        "teamId": str(p.team_id) if p.team_id else None,
    }


def _event_dict(e) -> dict:
    return {
        "id": str(e.id),
        "type": e.event_type,
        "team": e.team,
        "player": str(e.player_id) if e.player_id else None,
        "playerName": e.player_name,
        "time": _as_local(e.created_at).strftime("%H:%M") if e.created_at else "",
    }


def _media_dict(m) -> dict:
    return {
        "id": str(m.id),
        "type": m.media_type,
        "url": m.url,
        "uploadedBy": str(m.uploaded_by) if m.uploaded_by else None,
    }


def _match_dict(db: Session, match: Match, user, booking=None, arena=None) -> dict:
    if booking is None:
        row = bookings_repo.get_booking(db, match.booking_id)
        booking = row[0] if row else None
        arena = row[2] if row else None
    start_local = _as_local(match.start_at)
    end_local = _as_local(match.end_at)

    players = repo.list_players(db, match.id)
    confirmed = [p for p in players if p.confirmed]
    pending = [p for p in players if not p.confirmed]

    events = repo.list_events(db, match.id)
    goals = [_event_dict(e) for e in events if e.event_type == MATCH_EVENT_GOAL]
    yellow = [_event_dict(e) for e in events if e.event_type == MATCH_EVENT_YELLOW]
    red = [_event_dict(e) for e in events if e.event_type == MATCH_EVENT_RED]

    ratings = match.ratings or {}
    organizer_name = booking.client_name if booking else None
    if not organizer_name and booking is not None and booking.user_id is not None:
        owner = db.get(User, booking.user_id)
        organizer_name = owner.name if owner else match.venue_name
    if not organizer_name:
        organizer_name = match.venue_name
    organizer_phone = booking.client_phone if booking else ""

    phase = _phase(match, now_local())
    return {
        "id": str(match.id),
        "reservationCode": booking.code if booking else "",
        "venueId": str(match.arena_id),
        "venueName": match.venue_name,
        "venueImage": (arena.logo or "") if arena else "",
        "sport": match.sport,
        "address": (arena.address or "") if arena else "",
        "lat": arena.lat if arena else None,
        "lng": arena.lng if arena else None,
        "date": f"{_WEEKDAYS_FULL[start_local.weekday()]} · {start_local.strftime('%d/%m')}",
        "dateISO": start_local.strftime("%Y-%m-%d"),
        "startTime": start_local.strftime("%H:%M"),
        "endTime": end_local.strftime("%H:%M"),
        "startTimestamp": int(start_local.timestamp() * 1000),
        "endTimestamp": int(end_local.timestamp() * 1000),
        "duration": match.duration_min,
        "organizer": {"name": organizer_name, "phone": organizer_phone},
        "players": {
            "confirmed": [_player_dict(p) for p in confirmed],
            "pending": [_player_dict(p) for p in pending],
        },
        "phase": phase,
        "status": match.status,
        "score": match.score or {"teamA": 0, "teamB": 0},
        "teams": match.teams,
        "goals": goals,
        "yellowCards": yellow,
        "redCards": red,
        "ratings": ratings,
        "rating": ratings.get(str(user.id)),
        "media": [_media_dict(m) for m in repo.list_media(db, match.id)],
        "elapsedSeconds": (
            int(now_local().timestamp() - match.start_at.timestamp())
            if phase == MATCH_PHASE_DURING_GAME else 0
        ),
    }


def _materialize(db: Session, booking: Booking) -> Match:
    match = repo.by_booking(db, booking.id)
    if match is not None:
        return match
    _, court, arena = bookings_repo.get_booking(db, booking.id)
    start = booking.start_at
    match = Match(
        id=uuid.uuid4(),
        booking_id=booking.id,
        arena_id=booking.arena_id,
        venue_name=arena.name,
        sport=court.sport if court else arena.name,
        start_at=start,
        end_at=booking.end_at,
        duration_min=booking.duration_h * 60,
        status=MATCH_STATUS_SCHEDULED,
        score={"teamA": 0, "teamB": 0},
    )
    db.add(match)
    _seed_players(db, match, booking)
    db.commit()
    return match


def _seed_players(db: Session, match: Match, booking: Booking) -> None:
    from ..repositories import peladas as peladas_repo

    pelada = _first_pelada(db, booking.id)
    attendee_ids = peladas_repo.participant_ids(db, pelada.id) if pelada else set()

    def _add(user_id, name, position, rating, confirmed):
        repo.upsert_player(
            db, match.id, user_id, name=name, position=position,
            rating=rating, confirmed=confirmed,
        )

    for user_id in attendee_ids:
        user = db.get(User, user_id)
        if user is None:
            continue
        _add(user.id, user.name, user.position, user.rating, confirmed=True)
    if booking.user_id and not attendee_ids:
        user = db.get(User, booking.user_id)
        if user is not None:
            _add(user.id, user.name, user.position, user.rating, confirmed=True)


def _first_pelada(db: Session, booking_id) -> Pelada | None:
    return db.execute(
        select(Pelada).where(Pelada.source_booking_id == booking_id).limit(1)
    ).scalar_one_or_none()


def active_match(db: Session, user) -> dict | None:
    now_utc = now_local().astimezone(timezone.utc).replace(tzinfo=None)
    window_start = now_utc
    window_end = now_utc + timedelta(hours=_ATIVA_WINDOW_H)
    bookings = repo.list_candidate_bookings(
        db, user.id, window_start, window_end
    )
    if not bookings:
        return None
    match = _materialize(db, bookings[0])
    return _match_dict(db, match, user)


def history(db: Session, user, limit: int = 50) -> list[dict]:
    query = (
        select(Match)
        .where(
            or_(
                Match.booking_id.in_(
                    select(Booking.id).where(Booking.user_id == user.id)
                ),
                Match.id.in_(
                    select(MatchPlayer.match_id).where(MatchPlayer.user_id == user.id)
                ),
                Match.pelada_id.in_(
                    select(Pelada.id).where(
                        Pelada.club_id.in_(
                            select(ClubMember.club_id).where(ClubMember.user_id == user.id)
                        )
                    )
                ),
            )
        )
        .order_by(Match.start_at.desc())
        .limit(limit)
    )
    matches = list(db.execute(query).scalars())
    return [_match_dict(db, m, user) for m in matches]


def _require_visible(db: Session, user, match_id) -> Match:
    match = repo.get_match(db, match_id)
    if match is None:
        raise HTTPException(status_code=404, detail="Partida nao encontrada")
    if not _is_visible(db, user, match):
        raise HTTPException(status_code=403, detail="Você não participa desta partida")
    return match


def _is_visible(db: Session, user, match: Match) -> bool:
    row = bookings_repo.get_booking(db, match.booking_id)
    if row is not None and row[0].user_id is not None and str(row[0].user_id) == str(user.id):
        return True
    if repo.get_player(db, match.id, user.id) is not None:
        return True
    if match.pelada_id is not None:
        pelada = db.get(Pelada, match.pelada_id)
        if pelada is not None and pelada.club_id is not None:
            if clubs_repo.is_member(db, pelada.club_id, user.id):
                return True
    return False


def _organizer(db: Session, user, match: Match) -> Booking:
    booking = bookings_repo.get_booking(db, match.booking_id)
    booking = booking[0] if booking else None
    if booking is None or booking.user_id is None or str(booking.user_id) != str(user.id):
        raise HTTPException(status_code=403, detail="Só quem criou a reserva pode fazer isso")
    return booking


def _audience(db: Session, match: Match) -> list[uuid.UUID]:
    ids = {p.user_id for p in repo.list_players(db, match.id)}
    row = bookings_repo.get_booking(db, match.booking_id)
    if row is not None and row[0].user_id is not None:
        ids.add(row[0].user_id)
    return list(ids)


def _broadcast(db: Session, match: Match) -> None:
    payload = None
    for uid in _audience(db, match):
        if payload is None:
            payload = _match_dict(db, match, _user_or_none(db, uid))
        publish_user_event(uid, {"type": "match.updated", "partida": payload})


def _user_or_none(db: Session, user_id) -> User:
    return db.get(User, user_id)


def update_score(db: Session, user, match_id, body) -> dict:
    match = _require_visible(db, user, match_id)
    _organizer(db, user, match)
    team_a = max(0, int(body.teamA or 0))
    team_b = max(0, int(body.teamB or 0))
    match.score = {"teamA": team_a, "teamB": team_b}
    for team in repo.list_teams(db, match.id):
        if team.name == "A":
            team.score = team_a
        elif team.name == "B":
            team.score = team_b
    db.commit()
    _broadcast(db, match)
    return _match_dict(db, match, user)


def add_goal(db: Session, user, match_id, body) -> dict:
    match = _require_visible(db, user, match_id)
    _organizer(db, user, match)
    if body.team not in ("A", "B"):
        raise HTTPException(status_code=422, detail="Time deve ser A ou B")
    team = _clean_team(body.team)
    repo.add_event(
        db, match.id, event_type=MATCH_EVENT_GOAL, team=team,
        player_id=body.playerId, player_name=body.playerName,
    )
    score = dict(match.score or {"teamA": 0, "teamB": 0})
    score[f"team{team}"] = int(score.get(f"team{team}", 0)) + 1
    match.score = score
    db.commit()
    _broadcast(db, match)
    return _match_dict(db, match, user)


def _clean_team(value: str) -> str:
    return str(value).upper()[:1]


def add_card(db: Session, user, match_id, body) -> dict:
    match = _require_visible(db, user, match_id)
    _organizer(db, user, match)
    if body.type not in _CARD_TYPES:
        raise HTTPException(status_code=422, detail="Cartão deve ser yellow ou red")
    team = _clean_team(body.team) if body.team else None
    repo.add_event(
        db, match.id, event_type=body.type, team=team,
        player_id=body.playerId, player_name=body.playerName,
    )
    db.commit()
    _broadcast(db, match)
    return _match_dict(db, match, user)


def set_teams(db: Session, user, match_id, body) -> dict:
    match = _require_visible(db, user, match_id)
    _organizer(db, user, match)
    snapshot = _teams_snapshot(body)
    match.teams = snapshot
    for entry in snapshot.get("list") or []:
        side = entry.get("side")
        repo.upsert_player(
            db, match.id, entry["playerId"], name=entry.get("name", ""),
            team_id=None,
        )
    db.commit()
    _broadcast(db, match)
    return _match_dict(db, match, user)


def _teams_snapshot(body) -> dict:
    teams = {
        "version": getattr(body, "version", None) or 2,
        "rule": getattr(body, "rule", None) or "winner-stays",
        "list": body.list or [],
        "onCourt": body.onCourt or {"A": [], "B": []},
        "queue": body.queue or [],
    }
    for entry in teams["list"]:
        if "side" not in entry:
            entry["side"] = "A"
    return teams


def end_match(db: Session, user, match_id, body) -> dict:
    match = _require_visible(db, user, match_id)
    _organizer(db, user, match)
    match.status = MATCH_STATUS_ENDED
    match.ended_at = now_local()
    if getattr(body, "score", None) is not None:
        match.score = {
            "teamA": max(0, int(body.score.get("teamA") or 0)),
            "teamB": max(0, int(body.score.get("teamB") or 0)),
        }
    db.commit()
    result = _match_dict(db, match, user)
    for uid in _audience(db, match):
        _notify(
            db, uid, NOTIF_PARTIDA_ENCERRADA, "Partida encerrada",
            f"Partida em {match.venue_name} terminou {match.score['teamA']} x {match.score['teamB']}.",
            {"matchId": str(match.id), "score": match.score},
        )
        publish_user_event(uid, {"type": "match.updated", "partida": result})
    return result


def confirm_presence(db: Session, user, match_id) -> dict:
    match = _require_visible(db, user, match_id)
    repo.upsert_player(
        db, match.id, user.id, name=user.name, position=user.position,
        rating=user.rating, confirmed=True,
    )
    db.commit()
    _notify(
        db, _organizer_id(db, match), NOTIF_PARTIDA_PRESENCA,
        "Presença confirmada",
        f"{user.name} confirmou presença na partida.",
        {"matchId": str(match.id)},
    )
    _broadcast(db, match)
    return _match_dict(db, match, user)


def _organizer_id(db: Session, match: Match) -> uuid.UUID | None:
    booking = bookings_repo.get_booking(db, match.booking_id)
    return booking[0].user_id if booking and booking[0].user_id else None


def notify_delay(db: Session, user, match_id, minutes: int) -> dict:
    match = _require_visible(db, user, match_id)
    minutes = max(0, min(180, int(minutes or 0)))
    repo.upsert_player(
        db, match.id, user.id, name=user.name, position=user.position,
        rating=user.rating, delay_minutes=minutes,
    )
    db.commit()
    if minutes > 0:
        _notify(
            db, _organizer_id(db, match), NOTIF_PARTIDA_ATRASO,
            "Jogador atrasado",
            f"{user.name} avisou que chega com {minutes}min de atraso.",
            {"matchId": str(match.id), "minutes": minutes},
        )
    _broadcast(db, match)
    return _match_dict(db, match, user)


def rate_match(db: Session, user, match_id, stars: int) -> dict:
    match = _require_visible(db, user, match_id)
    stars = int(stars)
    if stars < 1 or stars > 5:
        raise HTTPException(status_code=422, detail="Nota deve ser de 1 a 5")
    ratings = dict(match.ratings or {})
    ratings[str(user.id)] = stars
    match.ratings = ratings
    db.commit()
    return _match_dict(db, match, user)


def add_media(db: Session, user, match_id, media_type: str, url: str) -> dict:
    match = _require_visible(db, user, match_id)
    if media_type not in ("photo", "video"):
        raise HTTPException(status_code=422, detail="Tipo deve ser photo ou video")
    item = repo.add_media(db, match.id, media_type=media_type, url=url, uploaded_by=user.id)
    db.commit()
    _broadcast(db, match)
    return _media_dict(item)


def share_location(db: Session, user, match_id) -> dict:
    match = _require_visible(db, user, match_id)
    return {"ok": True, "matchId": str(match.id)}


def _notify(db: Session, user_id, type_: str, title: str, body: str, data: dict) -> None:
    if user_id is None:
        return
    from .notifications import emit_notification

    emit_notification(db, user_id, type=type_, title=title, body=body, data=data)
