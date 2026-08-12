"""Acesso a dados de clubes, membros e mural — Fase 9."""
import uuid

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..models import Club, ClubMember, ClubMessage, User
from .venues import _uuid


def get_club(db: Session, club_id) -> Club | None:
    club_id = _uuid(club_id)
    if club_id is None:
        return None
    return db.get(Club, club_id)


def list_clubs(db: Session, limit: int = 200) -> list[Club]:
    return list(
        db.execute(select(Club).order_by(Club.name).limit(limit)).scalars()
    )


def get_by_code(db: Session, code: str) -> Club | None:
    if not code:
        return None
    return db.execute(
        select(Club).where(Club.code == code.upper())
    ).scalar_one_or_none()


def my_club(db: Session, user_id) -> Club | None:
    user_id = _uuid(user_id)
    if user_id is None:
        return None
    return db.execute(
        select(Club)
        .join(ClubMember, ClubMember.club_id == Club.id)
        .where(ClubMember.user_id == user_id)
    ).scalar_one_or_none()


def list_members(db: Session, club_id) -> list[tuple[ClubMember, User]]:
    club_id = _uuid(club_id)
    if club_id is None:
        return []
    return list(
        db.execute(
            select(ClubMember, User)
            .join(User, User.id == ClubMember.user_id)
            .where(ClubMember.club_id == club_id)
            .order_by(ClubMember.joined_at)
        ).all()
    )


def get_member(db: Session, club_id, user_id) -> ClubMember | None:
    club_id = _uuid(club_id)
    user_id = _uuid(user_id)
    if club_id is None or user_id is None:
        return None
    return db.execute(
        select(ClubMember).where(
            ClubMember.club_id == club_id, ClubMember.user_id == user_id
        )
    ).scalar_one_or_none()


def is_member(db: Session, club_id, user_id) -> bool:
    return get_member(db, club_id, user_id) is not None


def count_members(db: Session, club_id) -> int:
    club_id = _uuid(club_id)
    if club_id is None:
        return 0
    return (
        db.execute(
            select(func.count())
            .select_from(ClubMember)
            .where(ClubMember.club_id == club_id)
        ).scalar()
        or 0
    )


def add_member(db: Session, club_id, user_id, *, role: str) -> ClubMember:
    row = ClubMember(club_id=_uuid(club_id), user_id=_uuid(user_id), role=role)
    db.add(row)
    return row


def remove_member(db: Session, club_id, user_id) -> None:
    club_id = _uuid(club_id)
    user_id = _uuid(user_id)
    if club_id is None or user_id is None:
        return
    db.execute(
        delete(ClubMember).where(
            ClubMember.club_id == club_id, ClubMember.user_id == user_id
        )
    )


def list_messages(db: Session, club_id) -> list[ClubMessage]:
    club_id = _uuid(club_id)
    if club_id is None:
        return []
    return list(
        db.execute(
            select(ClubMessage)
            .where(ClubMessage.club_id == club_id)
            .order_by(ClubMessage.created_at)
        ).scalars()
    )


def add_message(db: Session, club_id, member_id, *, name: str, text: str) -> ClubMessage:
    msg = ClubMessage(
        id=uuid.uuid4(),
        club_id=_uuid(club_id),
        member_id=_uuid(member_id),
        name=name,
        text=text,
    )
    db.add(msg)
    return msg
