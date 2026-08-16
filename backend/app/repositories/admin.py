"""Acesso a dados do painel do admin (Fase 10).

Diferente do gerente, o admin opera sobre a plataforma inteira: nao existe
filtro por arena, apenas os filtros de leitura da tela (periodo, busca,
cidade/estado, inatividade). O financeiro usa o ledger de payments confirmados
(nunca status visual) — mesma regra da Fase 8, só que cross-arena.
"""
from datetime import datetime, timezone

from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session

from ..models import (
    PLAN_MENSALISTA,
    ROLE_GERENTE,
    ROLE_JOGADOR,
    PAYMENT_CONFIRMED,
    AdminAction,
    Arena,
    Booking,
    Club,
    ClubMember,
    Court,
    Payment,
    Pelada,
    User,
)
from .venues import _uuid


def _utc_naive(dt: datetime | None):
    """As colunas guardam paredes UTC (SQLite guarda naive). Alinha o bind."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def platform_revenue_for_period(
    db: Session, start: datetime | None, end: datetime | None
) -> tuple[int, int, int, int]:
    """(bruto, subtotal, count, compradores) dos payments confirmados.

    Comissao Qadras e calculada no service (12% do subtotal); aqui retorna o
    ledger do periodo com os compradores distintos (user_id nao nulo).
    """
    stmt = (
        select(
            func.coalesce(func.sum(Payment.amount_cents), 0),
            func.coalesce(func.sum(Booking.subtotal_cents), 0),
            func.count(Payment.id),
            func.count(func.distinct(Payment.user_id)),
        )
        .join(Booking, Booking.id == Payment.booking_id)
        .where(Payment.status == PAYMENT_CONFIRMED)
    )
    if start is not None:
        stmt = stmt.where(Payment.paid_at >= _utc_naive(start))
    if end is not None:
        stmt = stmt.where(Payment.paid_at < _utc_naive(end))
    row = db.execute(stmt).one()
    return int(row[0]), int(row[1]), int(row[2]), int(row[3])


def users_count(db: Session) -> tuple[int, int, int]:
    """(total, jogadores, donos) de usuarios nao deletados."""
    row = db.execute(
        select(
            func.count(User.id),
            func.sum(case((User.role == ROLE_JOGADOR, 1), else_=0)),
            func.sum(case((User.role == ROLE_GERENTE, 1), else_=0)),
        ).where(User.deleted_at.is_(None))
    ).one()
    return int(row[0]), int(row[1]), int(row[2])


def inactive_users(db: Session, cutoff: datetime, limit: int = 50) -> list[User]:
    """Usuarios que nao usaram o app desde `cutoff` (ou nunca entraram)."""
    return list(
        db.execute(
            select(User)
            .where(
                User.deleted_at.is_(None),
                or_(
                    User.last_active_at.is_(None),
                    User.last_active_at < _utc_naive(cutoff),
                ),
            )
            .order_by(User.last_active_at.asc())
            .limit(limit)
        ).scalars().all()
    )


def active_users_count(db: Session, cutoff: datetime) -> int:
    return int(
        db.execute(
            select(func.count(User.id)).where(
                User.deleted_at.is_(None),
                User.last_active_at.is_not(None),
                User.last_active_at >= _utc_naive(cutoff),
            )
        ).scalar_one()
    )


# --- Arenas -----------------------------------------------------------------

def arenas_list(db: Session) -> list[Arena]:
    return list(
        db.execute(
            select(Arena).where(Arena.deleted_at.is_(None)).order_by(Arena.name)
        ).scalars().all()
    )


def first_court_by_arena(db: Session) -> dict:
    """arena_id -> primeira court (cronologicamente) da arena."""
    out: dict = {}
    for court in db.execute(
        select(Court)
        .where(Court.deleted_at.is_(None))
        .order_by(Court.created_at)
    ).scalars():
        out.setdefault(str(court.arena_id), court)
    return out


def booking_counts_by_arena(db: Session) -> dict:
    """arena_id -> total de reservas (nao-sessoes)."""
    rows = db.execute(
        select(Booking.arena_id, func.count(Booking.id))
        .where(Booking.is_session.is_(False))
        .group_by(Booking.arena_id)
    ).all()
    return {str(a): int(c) for a, c in rows}


# --- Reservas ---------------------------------------------------------------

def _booking_rows_query(db: Session):
    return (
        select(Booking, Court, Arena, User)
        .join(Court, Court.id == Booking.court_id)
        .join(Arena, Arena.id == Booking.arena_id)
        .outerjoin(User, User.id == Booking.user_id)
    )


def booking_rows(
    db: Session,
    *,
    status: str | None = None,
    q: str | None = None,
    limit: int = 200,
    offset: int = 0,
):
    stmt = _booking_rows_query(db)
    if status:
        stmt = stmt.where(Booking.status == status)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                Booking.code.ilike(like),
                Booking.client_name.ilike(like),
                Booking.client_phone.ilike(like),
                Court.name.ilike(like),
                Arena.name.ilike(like),
                User.name.ilike(like),
            )
        )
    return list(
        db.execute(
            stmt.order_by(Booking.start_at.desc()).limit(limit).offset(offset)
        ).all()
    )


def booking_total(
    db: Session, *, status: str | None = None, q: str | None = None
) -> int:
    stmt = select(func.count(Booking.id))
    if status:
        stmt = stmt.where(Booking.status == status)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                Booking.code.ilike(like),
                Booking.client_name.ilike(like),
                Booking.client_phone.ilike(like),
                Court.name.ilike(like),
                Arena.name.ilike(like),
                User.name.ilike(like),
            )
        )
        stmt = stmt.join(Court, Court.id == Booking.court_id).join(
            Arena, Arena.id == Booking.arena_id
        ).outerjoin(User, User.id == Booking.user_id)
    return int(db.execute(stmt).scalar_one())


def mensalista_groups(db: Session):
    """Bookings "pai" de mensalistas (plan=mensalista, nao sessao)."""
    return list(
        db.execute(
            _booking_rows_query(db)
            .where(
                Booking.plan == PLAN_MENSALISTA,
                Booking.is_session.is_(False),
                Booking.group_id.is_not(None),
            )
            .order_by(Booking.start_at.desc())
        ).all()
    )


def pelada_count(db: Session) -> int:
    return int(db.execute(select(func.count(Pelada.id))).scalar_one())


def mensalista_group_sizes(db: Session, group_ids) -> dict:
    """group_id(str) -> total de bookings do grupo (pai + sessoes)."""
    group_ids = [g for g in group_ids if g is not None]
    if not group_ids:
        return {}
    rows = db.execute(
        select(Booking.group_id, func.count(Booking.id))
        .where(Booking.group_id.in_(group_ids))
        .group_by(Booking.group_id)
    ).all()
    return {str(g): int(n) for g, n in rows}


# --- Clubes -----------------------------------------------------------------

def clubs_list(db: Session):
    return list(
        db.execute(
            select(Club, func.count(ClubMember.user_id))
            .outerjoin(ClubMember, ClubMember.club_id == Club.id)
            .group_by(Club.id)
            .order_by(Club.name)
        ).all()
    )


def pelada_count_by_club(db: Session) -> dict:
    rows = db.execute(
        select(Pelada.club_id, func.count(Pelada.id))
        .where(Pelada.club_id.is_not(None))
        .group_by(Pelada.club_id)
    ).all()
    return {str(c): int(n) for c, n in rows}


# --- Pessoas ----------------------------------------------------------------

def _people_filter(q: str | None, cidade: str | None, estado: str | None):
    conds = [User.deleted_at.is_(None)]
    if q:
        like = f"%{q.strip()}%"
        conds.append(User.name.ilike(like))
    if cidade:
        conds.append(User.city == cidade)
    if estado:
        conds.append(User.state == estado)
    return conds


def user_rows(
    db: Session,
    *,
    q: str | None = None,
    cidade: str | None = None,
    estado: str | None = None,
    limit: int = 200,
    offset: int = 0,
):
    return list(
        db.execute(
            select(User)
            .where(*_people_filter(q, cidade, estado))
            .order_by(User.created_at.desc())
            .limit(limit)
            .offset(offset)
        ).scalars().all()
    )


def user_total(
    db: Session, *, q: str | None = None, cidade: str | None = None, estado: str | None = None
) -> int:
    return int(
        db.execute(
            select(func.count(User.id)).where(*_people_filter(q, cidade, estado))
        ).scalar_one()
    )


def distinct_cities_states(db: Session) -> tuple[list[str], list[str]]:
    cities = db.execute(
        select(User.city).where(User.city.is_not(None)).distinct().order_by(User.city)
    ).scalars().all()
    states = db.execute(
        select(User.state).where(User.state.is_not(None)).distinct().order_by(User.state)
    ).scalars().all()
    return list(cities), list(states)


def user_spend(db: Session, start: datetime | None, end: datetime | None) -> dict:
    """user_id(str) -> centavos pagos no periodo (ledger confirmado)."""
    stmt = (
        select(Payment.user_id, func.coalesce(func.sum(Payment.amount_cents), 0))
        .where(Payment.status == PAYMENT_CONFIRMED, Payment.user_id.is_not(None))
    )
    if start is not None:
        stmt = stmt.where(Payment.paid_at >= _utc_naive(start))
    if end is not None:
        stmt = stmt.where(Payment.paid_at < _utc_naive(end))
    stmt = stmt.group_by(Payment.user_id)
    return {str(uid): int(cents) for uid, cents in db.execute(stmt).all()}


# --- Auditoria --------------------------------------------------------------

def record_admin_action(
    db: Session,
    admin_id,
    action: str,
    entity_type: str,
    entity_id,
    payload: dict | None = None,
) -> AdminAction:
    from uuid import uuid4

    row = AdminAction(
        id=uuid4(),
        admin_id=_uuid(admin_id),
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id),
        payload=payload or {},
    )
    db.add(row)
    db.flush()
    return row


def admin_actions(db: Session, limit: int = 100, offset: int = 0):
    return list(
        db.execute(
            select(AdminAction, User.name)
            .join(User, User.id == AdminAction.admin_id)
            .order_by(AdminAction.created_at.desc())
            .limit(limit)
            .offset(offset)
        ).all()
    )
