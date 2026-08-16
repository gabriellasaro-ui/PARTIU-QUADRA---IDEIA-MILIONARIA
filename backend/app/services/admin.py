"""Casos de uso do painel do admin — Fase 10.

O admin enxerga a plataforma inteira (nao ha filtro por arena, como no
gerente). O financeiro usa o ledger de payments confirmados e a receita da
plataforma e 12% do subtotal (9% do jogador por cima + 3% da arena por
dentro) — regra fixada na Fase 1. Toda escrita grava uma `AdminAction`
(auditoria): quem, o que, em qual entidade e quando.
"""
import uuid
from datetime import datetime, time, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.config import settings
from ..core.timezone import TZ, now_local
from ..models import (
    ACTIVE_STATUSES,
    ADMIN_ACTION_ARENA_PAUSE,
    ADMIN_ACTION_ARENA_REACTIVATE,
    ROLE_ADMIN,
    STATUS_CANCELLED,
    Arena,
    Booking,
)
from ..repositories import admin as repo
from .bookings import _STATUS_CLASS, _STATUS_LABEL, _transition_booking
from .catalog import _as_local

PERIODS = {"today", "7d", "30d", "90d", "tudo"}


# --- Helpers ----------------------------------------------------------------

def _period_bounds(periodo: str | None) -> tuple[datetime | None, None]:
    key = periodo or "30d"
    if key == "today":
        today = now_local().date()
        return datetime.combine(today, time.min, tzinfo=TZ), None
    if key not in PERIODS:
        raise HTTPException(status_code=422, detail="Período inválido (today|7d|30d|90d|tudo)")
    if key == "tudo":
        return None, None
    return now_local() - timedelta(days=int(key[:-1])), None


def _dias_inativo(user) -> int | None:
    last = _as_local(user.last_active_at)
    if last is None:
        return None
    return max(0, (now_local() - last).days)


def _papel(role: str) -> str:
    return "Dono de quadra" if role == "gerente" else "Jogador"


def _cliente(booking: Booking, user) -> str:
    if booking.client_name:
        return booking.client_name
    return user.name if user else ""


def _arena_or_404(db: Session, arena_id) -> Arena:
    try:
        aid = uuid.UUID(str(arena_id))
    except (ValueError, TypeError):
        raise HTTPException(status_code=404, detail="Arena não encontrada")
    arena = db.get(Arena, aid)
    if arena is None or arena.deleted_at:
        raise HTTPException(status_code=404, detail="Arena não encontrada")
    return arena


def _cancel_future_bookings(db: Session, arena: Arena, *, actor_id) -> int:
    """Cancela as reservas futuras da arena (mesma regra da desativacao F8,
    porem com papel admin e auditoria)."""
    now_utc = now_local().astimezone(timezone.utc).replace(tzinfo=None)
    targets = db.execute(
        select(Booking).where(
            Booking.arena_id == arena.id,
            Booking.status.in_(ACTIVE_STATUSES),
            Booking.start_at >= now_utc,
        )
    ).scalars().all()
    count = 0
    for b in targets:
        if b.status != STATUS_CANCELLED:
            _transition_booking(
                db, b, STATUS_CANCELLED,
                actor_id=actor_id, actor_role=ROLE_ADMIN,
                reason="Arena pausada pelo admin",
            )
            count += 1
    return count


# --- Visao geral ------------------------------------------------------------

def overview(db: Session, *, periodo: str = "30d", inatividade: int = 7) -> dict:
    start, _end = _period_bounds(periodo)
    corte_inat = max(0, int(inatividade or 7))
    cutoff = now_local() - timedelta(days=corte_inat)

    gross, subtotal, reservas, compradores = repo.platform_revenue_for_period(db, start, None)
    comissao = round(subtotal * (settings.player_fee_rate + settings.arena_fee_rate))
    total_users, jogadores, donos = repo.users_count(db)
    ativos = repo.active_users_count(db, cutoff)
    arenas = repo.arenas_list(db)

    return {
        "periodo": periodo,
        "inatividade": corte_inat,
        "receitaPlataforma": round(comissao / 100, 2),
        "volume": round(gross / 100, 2),
        "reservas": reservas,
        "jogosMarcados": repo.pelada_count(db),
        "planosMensalistas": len(repo.mensalista_groups(db)),
        "cadastrados": total_users,
        "jogadores": jogadores,
        "donos": donos,
        "ativos": ativos,
        "inativos": total_users - ativos,
        "arenasAtivas": sum(1 for a in arenas if a.is_active),
        "arenasTotal": len(arenas),
        "compradores": compradores,
        "rpu": round(comissao / compradores / 100, 2) if compradores else 0,
        "ticketMedio": round(gross / reservas / 100, 2) if reservas else 0,
        "filaReativacao": [_serialize_fila(u) for u in repo.inactive_users(db, cutoff)],
        "ultimasReservas": [_serialize_reserva(r) for r in repo.booking_rows(db, limit=10)],
    }


def _serialize_fila(user) -> dict:
    dias = _dias_inativo(user)
    return {
        "id": str(user.id),
        "nome": user.name,
        "papel": _papel(user.role),
        "cidade": user.city or "",
        "ultimaAtividade": _as_local(user.last_active_at).isoformat() if user.last_active_at else None,
        "diasInativo": dias,
        "cadastro": _as_local(user.created_at).strftime("%Y-%m-%d") if user.created_at else None,
    }


# --- Arenas -----------------------------------------------------------------

def arenas(db: Session, *, q: str | None = None, limit: int = 200, offset: int = 0) -> dict:
    courts = repo.first_court_by_arena(db)
    counts = repo.booking_counts_by_arena(db)
    rows = repo.arenas_list(db)
    if q:
        like = q.strip().lower()
        rows = [a for a in rows if like in (a.name or "").lower() or like in (a.city or "").lower()]
    total = len(rows)
    out = []
    for a in rows[offset:offset + max(1, limit)]:
        court = courts.get(str(a.id))
        out.append({
            "id": str(a.id),
            "nome": a.name,
            "bairro": a.address or "",
            "cidade": a.city or "",
            "esporte": court.sport if court else "",
            "avulso": court.price_cents / 100 if court else None,
            "mensalista": court.price_monthly_cents / 100 if court and court.price_monthly_cents else None,
            "reservas": counts.get(str(a.id), 0),
            "ativa": a.is_active,
        })
    return {"arenas": out, "total": total}


# --- Reservas ---------------------------------------------------------------

def reservas(
    db: Session,
    *,
    status: str | None = None,
    q: str | None = None,
    limit: int = 200,
    offset: int = 0,
) -> dict:
    rows = repo.booking_rows(db, status=status, q=q, limit=limit, offset=offset)
    grupos = repo.mensalista_groups(db)
    planos = [_serialize_plano(db, r) for r in grupos]
    return {
        "reservas": [_serialize_reserva(r) for r in rows],
        "total": repo.booking_total(db, status=status, q=q),
        "mensalistas": len(grupos),
        "avulsas": repo.booking_total(db, status=status, q=q) - len(grupos),
        "sessoesAgendadas": repo.pelada_count(db),
        "planos": planos,
    }


def _serialize_reserva(row) -> dict:
    booking, court, arena, user = row
    local = _as_local(booking.start_at)
    local_end = _as_local(booking.end_at)
    return {
        "id": str(booking.id),
        "code": booking.code,
        "cliente": _cliente(booking, user),
        "arena": arena.name,
        "quadra": court.name,
        "data": local.strftime("%d/%m/%Y") if local else None,
        "dataValue": local.strftime("%Y-%m-%d") if local else None,
        "hora": f"{local.strftime('%H:%M')} – {local_end.strftime('%H:%M')}" if local else "",
        "valor": round(booking.subtotal_cents / 100, 2),
        "plataforma": round(booking.subtotal_cents * (settings.player_fee_rate + settings.arena_fee_rate) / 100, 2),
        "status": _STATUS_LABEL.get(booking.status, booking.status),
        "statusClass": _STATUS_CLASS.get(booking.status, "pendente"),
        "plano": booking.plan,
        "source": booking.source,
    }


def _serialize_plano(db: Session, row) -> dict:
    booking, _court, arena, _user = row
    local = _as_local(booking.start_at)
    sizes = repo.mensalista_group_sizes(db, [booking.group_id])
    return {
        "code": booking.code,
        "arena": arena.name,
        "compromisso": f"Toda {local.strftime('%A')} às {local.strftime('%H:%M')}" if local else "",
        "sessoes": sizes.get(str(booking.group_id), 0),
    }


# --- Clubes -----------------------------------------------------------------

def clubes(db: Session) -> dict:
    counts = repo.pelada_count_by_club(db)
    return {
        "clubes": [
            {
                "id": str(c.id),
                "nome": c.name,
                "esporte": c.sport,
                "cidade": c.city,
                "estado": c.state or "",
                "codigo": c.code,
                "membros": int(membros),
                "peladas": counts.get(str(c.id), 0),
            }
            for c, membros in repo.clubs_list(db)
        ]
    }


# --- Pessoas ----------------------------------------------------------------

def pessoas(
    db: Session,
    *,
    q: str | None = None,
    cidade: str | None = None,
    estado: str | None = None,
    periodo: str = "30d",
    inatividade: int = 7,
    limit: int = 200,
    offset: int = 0,
) -> dict:
    start, _end = _period_bounds(periodo)
    spend = repo.user_spend(db, start, None)
    corte = max(0, int(inatividade or 7))
    cutoff = now_local() - timedelta(days=corte)
    rows = repo.user_rows(db, q=q, cidade=cidade, estado=estado, limit=limit, offset=offset)
    cidades, estados = repo.distinct_cities_states(db)
    out = []
    for u in rows:
        dias = _dias_inativo(u)
        out.append({
            "id": str(u.id),
            "nome": u.name,
            "papel": _papel(u.role),
            "cidade": u.city or "",
            "estado": u.state or "",
            "gastou": round(spend.get(str(u.id), 0) / 100, 2),
            "cadastro": _as_local(u.created_at).strftime("%Y-%m-%d") if u.created_at else None,
            "ultimaAtividade": _as_local(u.last_active_at).isoformat() if u.last_active_at else None,
            "diasInativo": dias,
            "ativo": dias is not None and dias <= corte,
        })
    return {
        "pessoas": out,
        "total": repo.user_total(db, q=q, cidade=cidade, estado=estado),
        "cidades": cidades,
        "estados": estados,
        "periodo": periodo,
    }


# --- Acoes administrativas (com auditoria) ----------------------------------

def pause_arena(db: Session, admin, arena_id, motivo: str) -> dict:
    arena = _arena_or_404(db, arena_id)
    if not arena.is_active:
        raise HTTPException(status_code=409, detail="Arena já está pausada")
    arena.is_active = False
    cancelled = _cancel_future_bookings(db, arena, actor_id=admin.id)
    repo.record_admin_action(
        db, admin.id, ADMIN_ACTION_ARENA_PAUSE, "arena", arena.id,
        {"motivo": motivo, "arena": arena.name, "canceladas": cancelled},
    )
    db.commit()
    return {"ok": True, "arena": str(arena.id), "canceladas": cancelled}


def reactivate_arena(db: Session, admin, arena_id, motivo: str | None) -> dict:
    arena = _arena_or_404(db, arena_id)
    if arena.is_active:
        raise HTTPException(status_code=409, detail="Arena já está ativa")
    arena.is_active = True
    repo.record_admin_action(
        db, admin.id, ADMIN_ACTION_ARENA_REACTIVATE, "arena", arena.id,
        {"motivo": motivo, "arena": arena.name},
    )
    db.commit()
    return {"ok": True, "arena": str(arena.id)}


def auditoria(db: Session, *, limit: int = 100, offset: int = 0) -> dict:
    return {
        "acoes": [
            {
                "id": str(a.id),
                "admin": nome,
                "adminId": str(a.admin_id),
                "acao": a.action,
                "entidade": a.entity_type,
                "entidadeId": a.entity_id,
                "dados": a.payload or {},
                "quando": _as_local(a.created_at).isoformat() if a.created_at else None,
            }
            for a, nome in repo.admin_actions(db, limit=limit, offset=offset)
        ]
    }
