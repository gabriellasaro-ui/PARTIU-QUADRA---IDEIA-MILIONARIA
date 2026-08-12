"""Acesso a dados de peladas e presenca — Fase 9."""
import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..models import (
    PELADA_KIND_AVULSA,
    Pelada,
    PeladaAttendance,
)
from .venues import _uuid


def get_pelada(db: Session, pelada_id) -> Pelada | None:
    pelada_id = _uuid(pelada_id)
    if pelada_id is None:
        return None
    return db.get(Pelada, pelada_id)


def list_for_user(db: Session, user_id, limit: int = 200) -> list[Pelada]:
    """Peladas visiveis: avulsas (publicas), as que o usuario organiza e as de
    clubes em que ele e membro."""
    user_id = _uuid(user_id)
    if user_id is None:
        return []
    from ..models import ClubMember

    return list(
        db.execute(
            select(Pelada)
            .where(
                or_(
                    Pelada.kind == PELADA_KIND_AVULSA,
                    Pelada.organizer_id == user_id,
                    Pelada.club_id.in_(
                        select(ClubMember.club_id).where(ClubMember.user_id == user_id)
                    ),
                )
            )
            .order_by(Pelada.date_iso, Pelada.start_time)
            .limit(limit)
        ).scalars()
    )


def list_by_club(db: Session, club_id) -> list[Pelada]:
    club_id = _uuid(club_id)
    if club_id is None:
        return []
    return list(
        db.execute(
            select(Pelada).where(Pelada.club_id == club_id)
        ).scalars()
    )


def by_booking_date(db: Session, booking_id, date_iso: str) -> Pelada | None:
    booking_id = _uuid(booking_id)
    if booking_id is None:
        return None
    return db.execute(
        select(Pelada).where(
            Pelada.source_booking_id == booking_id, Pelada.date_iso == date_iso
        )
    ).scalar_one_or_none()


def list_attendance(db: Session, pelada_id) -> list[tuple[PeladaAttendance, uuid.UUID]]:
    """Retorna linhas de presenca com user_id (o join nao e necessario — o
    id ja esta na PK)."""
    pelada_id = _uuid(pelada_id)
    if pelada_id is None:
        return []
    return list(
        db.execute(
            select(PeladaAttendance).where(PeladaAttendance.pelada_id == pelada_id)
        ).scalars()
    )


def participant_ids(db: Session, pelada_id) -> set[uuid.UUID]:
    pelada_id = _uuid(pelada_id)
    if pelada_id is None:
        return set()
    rows = db.execute(
        select(PeladaAttendance.user_id).where(PeladaAttendance.pelada_id == pelada_id)
    ).scalars()
    return {r for r in rows if r is not None}


def upsert_attendance(db: Session, pelada_id, user_id, value: str) -> PeladaAttendance:
    pelada_id = _uuid(pelada_id)
    user_id = _uuid(user_id)
    row = db.execute(
        select(PeladaAttendance).where(
            PeladaAttendance.pelada_id == pelada_id,
            PeladaAttendance.user_id == user_id,
        )
    ).scalar_one_or_none()
    if row is None:
        row = PeladaAttendance(pelada_id=pelada_id, user_id=user_id, value=value)
        db.add(row)
    else:
        row.value = value
    return row
