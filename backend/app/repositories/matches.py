"""Acesso a dados de partidas (Game Day) — Fase 9."""
import uuid
from datetime import datetime

from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

from ..models import (
    MATCH_STATUS_ENDED,
    STATUS_CONFIRMED,
    Booking,
    ClubMember,
    Match,
    MatchEvent,
    MatchMedia,
    MatchPlayer,
    MatchTeam,
    Pelada,
)
from .venues import _uuid


def get_match(db: Session, match_id) -> Match | None:
    match_id = _uuid(match_id)
    if match_id is None:
        return None
    return db.get(Match, match_id)


def by_booking(db: Session, booking_id) -> Match | None:
    booking_id = _uuid(booking_id)
    if booking_id is None:
        return None
    return db.execute(
        select(Match).where(Match.booking_id == booking_id)
    ).scalar_one_or_none()


def _candidate_bookings_query(db: Session, user_id, start: datetime, end: datetime):
    """Reservas confirmadas em que o usuario pode ter Game Day: as que ele
    reservou + as que pertencem a peladas de clubes em que ele e membro."""
    club_pelada_ids = select(Pelada.source_booking_id).where(
        Pelada.source_booking_id.is_not(None),
        Pelada.club_id.in_(
            select(ClubMember.club_id).where(ClubMember.user_id == _uuid(user_id))
        ),
    )
    return (
        select(Booking)
        .where(
            Booking.status == STATUS_CONFIRMED,
            Booking.start_at >= start,
            Booking.start_at <= end,
            # Partida ja encerrada nao volta para a "ativa".
            ~Booking.id.in_(
                select(Match.booking_id).where(Match.status == MATCH_STATUS_ENDED)
            ),
            or_(Booking.user_id == _uuid(user_id), Booking.id.in_(club_pelada_ids)),
        )
        .order_by(Booking.start_at)
    )


def list_candidate_bookings(
    db: Session, user_id, start: datetime, end: datetime
) -> list[Booking]:
    return list(
        db.execute(_candidate_bookings_query(db, user_id, start, end)).scalars()
    )


def list_teams(db: Session, match_id) -> list[MatchTeam]:
    match_id = _uuid(match_id)
    if match_id is None:
        return []
    return list(
        db.execute(
            select(MatchTeam).where(MatchTeam.match_id == match_id)
        ).scalars()
    )


def list_players(db: Session, match_id) -> list[MatchPlayer]:
    match_id = _uuid(match_id)
    if match_id is None:
        return []
    return list(
        db.execute(
            select(MatchPlayer).where(MatchPlayer.match_id == match_id)
        ).scalars()
    )


def get_player(db: Session, match_id, user_id) -> MatchPlayer | None:
    match_id = _uuid(match_id)
    user_id = _uuid(user_id)
    if match_id is None or user_id is None:
        return None
    return db.execute(
        select(MatchPlayer).where(
            MatchPlayer.match_id == match_id, MatchPlayer.user_id == user_id
        )
    ).scalar_one_or_none()


def upsert_player(
    db: Session, match_id, user_id, *, name: str, position=None, rating=None,
    team_id=None, confirmed: bool = False, delay_minutes: int = 0,
) -> MatchPlayer:
    row = get_player(db, match_id, user_id)
    if row is None:
        row = MatchPlayer(
            match_id=_uuid(match_id),
            user_id=_uuid(user_id),
            name=name,
            position=position,
            rating=rating,
            team_id=team_id,
            confirmed=confirmed,
            delay_minutes=delay_minutes,
        )
        db.add(row)
    else:
        row.name = name
        if position is not None:
            row.position = position
        if rating is not None:
            row.rating = rating
        if team_id is not None:
            row.team_id = team_id
        if confirmed:
            row.confirmed = True
        if delay_minutes:
            row.delay_minutes = delay_minutes
    return row


def list_events(db: Session, match_id) -> list[MatchEvent]:
    match_id = _uuid(match_id)
    if match_id is None:
        return []
    return list(
        db.execute(
            select(MatchEvent).where(MatchEvent.match_id == match_id)
        ).scalars()
    )


def add_event(
    db: Session, match_id, *, event_type: str, team=None, player_id=None,
    player_name=None, text=None,
) -> MatchEvent:
    event = MatchEvent(
        id=uuid.uuid4(),
        match_id=_uuid(match_id),
        event_type=event_type,
        team=team,
        player_id=_uuid(player_id),
        player_name=player_name,
        text=text,
    )
    db.add(event)
    return event


def delete_events(db: Session, match_id) -> None:
    match_id = _uuid(match_id)
    if match_id is None:
        return
    db.execute(delete(MatchEvent).where(MatchEvent.match_id == match_id))


def list_media(db: Session, match_id) -> list[MatchMedia]:
    match_id = _uuid(match_id)
    if match_id is None:
        return []
    return list(
        db.execute(
            select(MatchMedia).where(MatchMedia.match_id == match_id)
        ).scalars()
    )


def add_media(db: Session, match_id, *, media_type: str, url: str, uploaded_by) -> MatchMedia:
    media = MatchMedia(
        id=uuid.uuid4(),
        match_id=_uuid(match_id),
        media_type=media_type,
        url=url,
        uploaded_by=_uuid(uploaded_by),
    )
    db.add(media)
    return media
