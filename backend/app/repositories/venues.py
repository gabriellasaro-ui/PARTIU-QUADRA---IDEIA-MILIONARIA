"""Acesso a dados do catalogo: arenas + courts + stats de reviews.

Toda query de catalogo considera apenas arena ativa (sem soft delete) e
court ativo/visivel — a regra que esconde arena desativada vem daqui.
"""
import uuid
from datetime import datetime, time, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import Arena, Court, CourtBlock, CourtRecurringAvailability, Review


def _uuid(value):
    if isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError):
        return None


VISIBLE = (
    Arena.deleted_at.is_(None),
    Arena.is_active.is_(True),
    Court.deleted_at.is_(None),
    Court.is_active.is_(True),
    Court.is_visible.is_(True),
)


def _base_court_query(db: Session):
    return (
        select(Court, Arena)
        .join(Arena, Arena.id == Court.arena_id)
        .where(*VISIBLE)
    )


def list_visible_courts(
    db: Session,
    *,
    sport: str | None = None,
    search: str | None = None,
    arena_ids: list | None = None,
):
    """Lista de (Court, Arena) visiveis, com filtros opcionais."""
    stmt = _base_court_query(db)
    if sport:
        stmt = stmt.where(Court.sport == sport)
    if search:
        like = f"%{search.strip()}%"
        stmt = stmt.where(
            Arena.name.ilike(like) | Court.name.ilike(like) | Arena.city.ilike(like)
        )
    if arena_ids:
        stmt = stmt.where(Arena.id.in_(arena_ids))
    return db.execute(stmt).all()


def get_visible_court(db: Session, court_id):
    court_id = _uuid(court_id)
    if court_id is None:
        return None
    stmt = _base_court_query(db).where(Court.id == court_id)
    return db.execute(stmt).one_or_none()


def court_counts(db: Session, arena_ids: list) -> dict:
    """arena_id -> quantas quadras VISIVEIS aquela arena tem.

    Serve para a tela decidir se mostra o nome da quadra embaixo do nome da
    arena: com uma quadra so o subtitulo nao distingue nada e vira ruido; com
    tres, e a unica forma de saber qual e qual.

    Conta pelo mesmo VISIBLE da listagem — se a quadra nao aparece na busca,
    ela nao pode contar para decidir o rotulo do que aparece. Uma arena com
    duas quadras e uma pausada volta a ser "arena de uma quadra" aos olhos do
    jogador, que e a verdade que ele ve.
    """
    if not arena_ids:
        return {}
    rows = db.execute(
        select(Court.arena_id, func.count(Court.id))
        .join(Arena, Arena.id == Court.arena_id)
        .where(*VISIBLE)
        .where(Court.arena_id.in_(arena_ids))
        .group_by(Court.arena_id)
    ).all()
    return {r[0]: r[1] for r in rows}


def review_stats(db: Session, arena_ids: list) -> dict:
    """arena_id -> (media, total) das avaliacoes."""
    if not arena_ids:
        return {}
    rows = db.execute(
        select(
            Review.arena_id,
            func.avg(Review.rating),
            func.count(Review.id),
        )
        .where(Review.arena_id.in_(arena_ids))
        .group_by(Review.arena_id)
    ).all()
    return {r[0]: (round(r[1], 1), r[2]) for r in rows}


def reviews_for_arena(db: Session, arena_id, limit: int = 20):
    """Lista (Review, nome_do_autor) da arena, mais recentes primeiro."""
    from ..models import User

    arena_id = _uuid(arena_id)
    if arena_id is None:
        return []

    rows = db.execute(
        select(Review, User.name)
        .join(User, User.id == Review.user_id)
        .where(Review.arena_id == arena_id)
        .order_by(Review.created_at.desc())
        .limit(limit)
    ).all()
    return [(row[0], row[1]) for row in rows]


def recurring_for_court(db: Session, court_id, day_of_week: int):
    """Horarios fixos do dia. Vazio => usa opening/closing do court."""
    court_id = _uuid(court_id)
    if court_id is None:
        return []
    return db.execute(
        select(CourtRecurringAvailability).where(
            CourtRecurringAvailability.court_id == court_id,
            CourtRecurringAvailability.day_of_week == day_of_week,
        )
    ).scalars().all()


def blocks_for_court(db: Session, court_id, start: datetime, end: datetime):
    court_id = _uuid(court_id)
    if court_id is None:
        return []

    def _utc_naive(dt):
        if dt.tzinfo is None:
            return dt
        return dt.astimezone(timezone.utc).replace(tzinfo=None)

    return db.execute(
        select(CourtBlock).where(
            CourtBlock.court_id == court_id,
            CourtBlock.start_at < _utc_naive(end),
            CourtBlock.end_at > _utc_naive(start),
        )
    ).scalars().all()


def sports_list(db: Session) -> list[str]:
    stmt = (
        select(Court.sport)
        .join(Arena, Arena.id == Court.arena_id)
        .where(*VISIBLE)
        .distinct()
        .order_by(Court.sport)
    )
    return [row[0] for row in db.execute(stmt).all()]


def favorite_arena_ids(db: Session, user_id) -> list:
    from ..models import UserFavorite

    rows = db.execute(
        select(UserFavorite.arena_id).where(UserFavorite.user_id == user_id)
    ).all()
    return [row[0] for row in rows]
