"""Casos de uso do painel do gerente — Fase 8.

Todo endpoint resolve a arena do gerente pelo token e opera nela. O
financeiro usa o ledger de payments confirmados (nunca status visual).
Reserva manual cria Booking(source="manual", created_by=manager) + Payment
(provider="manual") para a arena ser ressarcida pelo mesmo fluxo do app.
"""
import uuid
from datetime import datetime, time, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from ..core.config import settings
from ..core.timezone import TZ, now_local
from ..models import (
    ACTIVE_STATUSES,
    PLAN_AVULSO,
    PLAN_MENSALISTA,
    ROLE_GERENTE,
    SETTLEMENT_PENDING,
    STATUS_CANCELLED,
    STATUS_COMPLETED,
    STATUS_CONFIRMED,
    STATUS_EXPIRED,
    STATUS_PAYMENT_FAILED,
    STATUS_PENDING_PAYMENT,
    STATUS_REJECTED,
    STATUS_REQUESTED,
    Arena,
    Booking,
    BookingStatusEvent,
    Coupon,
    Court,
    Payment,
    Review,
    Settlement,
)
from ..repositories import bookings as bookings_repo
from ..repositories import gerente as repo
from ..repositories import venues as venues_repo
from .bookings import (
    _STATUS_CLASS,
    _STATUS_LABEL,
    _blocked,
    _ensure_slots_free,
    _generate_code,
    _record_event,
    _sessions,
    compute_quote,
)
from .catalog import _as_local

PAYMENT_MANUAL = "manual"


# --- Helpers --------------------------------------------------------------

def manager_arena_or_404(db: Session, manager) -> Arena:
    arena = repo.manager_arena(db, manager.id)
    if arena is None:
        raise HTTPException(
            status_code=404, detail="Arena não encontrada para este gerente"
        )
    return arena


def _price_cents(value: float | None) -> int:
    if value is None:
        raise HTTPException(status_code=422, detail="Valor inválido")
    try:
        cents = int(round(float(value) * 100))
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail="Valor inválido")
    if cents < 1:
        raise HTTPException(status_code=422, detail="Valor deve ser maior que zero")
    return cents


def _time_field(value: str, default="08:00") -> time:
    try:
        h, m = str(value).split(":")
        return time(int(h), int(m))
    except (ValueError, TypeError):
        return time(*[int(p) for p in default.split(":")])


def _client_name(booking: Booking, user) -> str:
    if booking.client_name:
        return booking.client_name
    return user.name if user else (booking.user_id and str(booking.user_id)) or ""


def _client_phone(booking: Booking, user) -> str:
    if booking.client_phone:
        return booking.client_phone
    return getattr(user, "phone", None) or ""


def serialize_booking(booking: Booking, court: Court, arena: Arena, user) -> dict:
    local = _as_local(booking.start_at)
    local_end = _as_local(booking.end_at)
    return {
        "id": str(booking.id),
        "code": booking.code,
        "cliente": _client_name(booking, user),
        "telefone": _client_phone(booking, user),
        "quadra": court.name,
        "esporte": court.sport,
        "data": local.strftime("%d/%m/%Y"),
        "dataValue": local.strftime("%Y-%m-%d"),
        "hora": f"{local.strftime('%H:%M')} – {local_end.strftime('%H:%M')}",
        "valor": booking.subtotal_cents / 100,
        "total": booking.total_cents / 100,
        "repasse": round(booking.subtotal_cents * (1 - settings.arena_fee_rate) / 100, 2),
        "status": _STATUS_LABEL.get(booking.status, booking.status),
        "statusClass": _STATUS_CLASS.get(booking.status, "pendente"),
        "statusAt": _as_local(booking.updated_at).isoformat() if booking.updated_at else None,
        "plan": booking.plan,
        "source": booking.source,
    }


def serialize_court(court: Court) -> dict:
    return {
        "id": str(court.id),
        "nome": court.name,
        "esporte": court.sport,
        "descricao": court.description,
        "preco": court.price_cents / 100,
        "precoMensalista": (court.price_monthly_cents / 100) if court.price_monthly_cents else None,
        "duracaoMinima": court.min_duration_h,
        "abertura": court.opening_time.strftime("%H:%M") if court.opening_time else "08:00",
        "fechamento": court.closing_time.strftime("%H:%M") if court.closing_time else "23:00",
        "ativa": court.is_active,
        "visivel": court.is_visible,
        "destaque": court.is_featured,
        "fotos": court.photos or [],
        "comodidades": court.amenities or [],
    }


def _serialize_settlement(s: object) -> dict:
    label, cls = "Em aberto", "pendente"
    if s.status == "paid":
        label, cls = "Pago", "pago"
    elif s.status == "failed":
        label, cls = "Falhou", "falhou"
    return {
        "id": str(s.id),
        "periodo": f"{_as_local(s.period_start).strftime('%d/%m')} a {_as_local(s.period_end).strftime('%d/%m')}",
        "reservas": s.bookings_count,
        "bruto": s.gross_cents / 100,
        "comissao": s.commission_cents / 100,
        "liquido": s.net_cents / 100,
        "status": label,
        "cls": cls,
        "vencimento": _as_local(s.due_at).strftime("%d/%m/%Y") if s.due_at else None,
        "comprovante": s.receipt_url,
    }


def _serialize_coupon(c: Coupon, arena) -> dict:
    return {
        "id": str(c.id),
        "codigo": c.code,
        "desconto": c.discount_percent,
        "courtId": str(c.court_id) if c.court_id else None,
        "quadra": None if not c.court_id else "Todas as quadras",
        "ativo": c.active,
        "expiraEm": _as_local(c.expires_at).strftime("%Y-%m-%d") if c.expires_at else None,
        "maxUsos": c.max_uses,
        "usos": c.used_count,
    }


# --- Dashboard ------------------------------------------------------------

def _week_bounds(day=None) -> tuple[datetime, datetime]:
    day = day or now_local().date()
    start = datetime.combine(day - timedelta(days=day.weekday()), time.min, tzinfo=TZ)
    return start, start + timedelta(days=7)


def _day_bounds() -> tuple[datetime, datetime]:
    today = now_local().date()
    start = datetime.combine(today, time.min, tzinfo=TZ)
    return start, start + timedelta(days=1)


def dashboard(db: Session, manager) -> dict:
    arena = manager_arena_or_404(db, manager)
    day_start, day_end = _day_bounds()
    week_start, week_end = _week_bounds()
    month_start = now_local() - timedelta(days=30)

    gross_today, _, _, cnt_today = repo.revenue_for_period(db, arena.id, day_start, day_end)
    gross_week, sub_week, com_week, cnt_week = repo.revenue_for_period(db, arena.id, week_start, week_end)
    gross_month, sub_month, com_month, cnt_month = repo.revenue_for_period(db, arena.id, month_start, day_end)

    courts = repo.list_courts_for_arena(db, arena.id)
    booked_week = repo.booked_slots_in_week(db, arena.id, week_start, week_end)
    total_slots = len(courts) * 15 * 7 or 1
    ocupacao = min(100, round(booked_week * 100 / total_slots))

    requested = repo.active_bookings_count(db, arena.id, [STATUS_REQUESTED])
    pending_pay = repo.active_bookings_count(db, arena.id, [STATUS_PENDING_PAYMENT])
    reservas_hoje = repo.booked_slots_in_week(db, arena.id, day_start, day_end)

    prox_rows = repo.next_bookings(db, arena.id, now_local())
    proximas = [serialize_booking(b, c, a, u) for b, c, a, u in prox_rows]

    return {
        "arena": {"id": str(arena.id), "name": arena.name, "visible": arena.is_active},
        "kpis": [
            {"rotulo": "Faturamento hoje", "valor": gross_today / 100, "cls": "hoje"},
            {"rotulo": "Faturamento semana", "valor": gross_week / 100, "cls": "semana"},
            {"rotulo": "Reservas da semana", "valor": booked_week, "cls": "reservas"},
            {"rotulo": "Ocupação", "valor": f"{ocupacao}%", "cls": "ocupacao"},
        ],
        "bruto": gross_month / 100,
        "comissao": com_month / 100,
        "repasse": (sub_month - round(sub_month * settings.arena_fee_rate)) / 100,
        "ticket_medio": round(gross_month / cnt_month, 2) if cnt_month else 0,
        "ocupacao": ocupacao,
        "reservas_semana": booked_week,
        "reservas_hoje": reservas_hoje,
        "solicitacoes_pendentes": requested,
        "aguardando_pagamento": pending_pay,
        "proximas": proximas,
        "data_hoje": now_local().strftime("%d/%m/%Y"),
    }


# --- Agenda ---------------------------------------------------------------

def agenda(db: Session, manager, semana: str | None = None) -> dict:
    arena = manager_arena_or_404(db, manager)
    if semana:
        try:
            day = datetime.strptime(semana, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=422, detail="Data inválida (use YYYY-MM-DD)")
    else:
        day = now_local().date()
    start, end = _week_bounds(day)

    rows = repo.bookings_between(db, arena.id, start, end)
    eventos = []
    for booking, court, arena_row, user in rows:
        local = _as_local(booking.start_at)
        eventos.append({
            "id": str(booking.id),
            "code": booking.code,
            "quadraId": str(court.id),
            "quadra": court.name,
            "dia": local.strftime("%Y-%m-%d"),
            "inicio": local.strftime("%H:%M"),
            "fim": _as_local(booking.end_at).strftime("%H:%M"),
            "cliente": _client_name(booking, user),
            "telefone": _client_phone(booking, user),
            "valor": booking.subtotal_cents / 100,
            "status": _STATUS_LABEL.get(booking.status, booking.status),
            "statusClass": _STATUS_CLASS.get(booking.status, "pendente"),
        })

    colunas = []
    for i in range(7):
        d = start.date() + timedelta(days=i)
        colunas.append({"dia": d.strftime("%Y-%m-%d"), "rotulo": d.strftime("%a, %d/%m")})
    quadras = [serialize_court(c) for c in repo.list_courts_for_arena(db, arena.id)]

    return {
        "semana": start.date().strftime("%Y-%m-%d"),
        "colunas": colunas,
        "quadras": quadras,
        "horas": list(range(8, 24)),
        "eventos": eventos,
    }


# --- Reservas -------------------------------------------------------------

def list_reservas(db: Session, manager, *, status_filtro: str | None = None, q: str | None = None) -> list:
    arena = manager_arena_or_404(db, manager)
    rows = repo.list_arena_bookings(db, arena.id, status=status_filtro or None, q=q or None)
    return [serialize_booking(b, c, a, u) for b, c, a, u in rows]


def create_manual_booking(db: Session, manager, body) -> Booking:
    """Reserva criada pelo gerente para um cliente (source=manual).

    Nasce `confirmed` (o gerente ja atendeu no balcao) e gera Payment
    provider="manual" confirmado — a arena e ressarcida pelo mesmo fluxo do
    ledger. Preco vem do court por padrao; `valor` pode sobrescrever.
    """
    arena = manager_arena_or_404(db, manager)
    court = repo.get_court_in_arena(db, body.courtId, arena.id)
    if court is None:
        raise HTTPException(status_code=404, detail="Quadra não encontrada")

    dur = max(1, min(3, int(body.dur or 1)))
    start_at = _parse_start(body.date, body.hora)
    if start_at <= now_local():
        raise HTTPException(status_code=409, detail="Não é possível reservar um horário que já passou")

    bookings_repo.lock_court(db, court.id)
    _ensure_slots_free(db, court, [start_at], dur)

    if body.valor is not None:
        subtotal = _price_cents(body.valor)
    else:
        subtotal = court.price_cents * dur
    booking = Booking(
        id=uuid.uuid4(),
        code=_generate_code(db),
        arena_id=arena.id,
        court_id=court.id,
        user_id=None,
        client_name=body.clientName or "",
        client_phone=body.clientPhone or "",
        client_email=body.clientEmail or "",
        status=STATUS_CONFIRMED,
        plan=PLAN_AVULSO,
        start_at=start_at.astimezone(timezone.utc).replace(tzinfo=None),
        end_at=(start_at + timedelta(hours=dur)).astimezone(timezone.utc).replace(tzinfo=None),
        duration_h=dur,
        subtotal_cents=subtotal,
        service_fee_cents=0,
        total_cents=subtotal,
        payment_method="pix",
        quote_snapshot={"subtotal_cents": subtotal, "service_fee_cents": 0, "total_cents": subtotal},
        source="manual",
        created_by=manager.id,
    )
    db.add(booking)
    db.flush()
    _record_event(db, booking, None, STATUS_CONFIRMED, manager.id, ROLE_GERENTE, "Reserva manual")
    db.add(Payment(
        id=uuid.uuid4(),
        booking_id=booking.id,
        user_id=None,
        provider=PAYMENT_MANUAL,
        method="pix",
        amount_cents=subtotal,
        status="confirmed",
        paid_at=now_local(),
    ))
    db.commit()
    return booking


def create_manual_mensalista(db: Session, manager, body) -> list[Booking]:
    """Mensalista criado pelo gerente: 4 sessoes semanais + Payment manual."""
    arena = manager_arena_or_404(db, manager)
    court = repo.get_court_in_arena(db, body.courtId, arena.id)
    if court is None:
        raise HTTPException(status_code=404, detail="Quadra não encontrada")

    dur = max(1, min(3, int(body.dur or 1)))
    start_at = _parse_start(body.date, body.hora)
    sessions = _sessions(start_at, dur, PLAN_MENSALISTA)

    bookings_repo.lock_court(db, court.id)
    _ensure_slots_free(db, court, sessions, dur)

    subtotal = court.price_monthly_cents or court.price_cents * dur
    group_id = uuid.uuid4()
    created: list[Booking] = []
    for index, start in enumerate(sessions):
        is_session = index > 0
        booking = Booking(
            id=uuid.uuid4(),
            code=_generate_code(db),
            arena_id=arena.id,
            court_id=court.id,
            user_id=None,
            client_name=body.clientName or "",
            client_phone=body.clientPhone or "",
            client_email=body.clientEmail or "",
            status=STATUS_CONFIRMED,
            plan=PLAN_MENSALISTA,
            start_at=start.astimezone(timezone.utc).replace(tzinfo=None),
            end_at=(start + timedelta(hours=dur)).astimezone(timezone.utc).replace(tzinfo=None),
            duration_h=dur,
            weekday=body.dia,
            subtotal_cents=0 if is_session else subtotal,
            service_fee_cents=0,
            total_cents=0 if is_session else subtotal,
            payment_method="pix",
            quote_snapshot={"subtotal_cents": subtotal, "service_fee_cents": 0, "total_cents": subtotal},
            group_id=group_id,
            is_session=is_session,
            source="manual",
            created_by=manager.id,
        )
        db.add(booking)
        db.flush()
        _record_event(db, booking, None, STATUS_CONFIRMED, manager.id, ROLE_GERENTE, "Mensalista manual")
        created.append(booking)
    db.add(Payment(
        id=uuid.uuid4(),
        booking_id=created[0].id,
        user_id=None,
        provider=PAYMENT_MANUAL,
        method="pix",
        amount_cents=subtotal,
        status="confirmed",
        paid_at=now_local(),
    ))
    db.commit()
    return created


def _parse_start(date_str: str, hora: str) -> datetime:
    try:
        day = datetime.strptime(date_str, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail="Data inválida (use YYYY-MM-DD)")
    try:
        hour = int(str(hora).split(":")[0])
    except (ValueError, TypeError):
        hour = 19
    hour = max(0, min(23, hour))
    return datetime.combine(day, time(hour, 0), tzinfo=TZ).astimezone(timezone.utc).astimezone(TZ)


# --- Mensalistas ----------------------------------------------------------

def list_mensalistas(db: Session, manager) -> list[dict]:
    arena = manager_arena_or_404(db, manager)
    out = []
    for booking, court, arena_row, user in repo.mensalist_groups(db, arena.id):
        local = _as_local(booking.start_at)
        out.append({
            "id": str(booking.id),
            "cliente": _client_name(booking, user),
            "telefone": _client_phone(booking, user),
            "quadra": court.name,
            "dia": local.strftime("%A"),
            "hora": local.strftime("%H:%M"),
            "preco": booking.subtotal_cents / 100,
            "status": "ativo" if booking.status not in (STATUS_CANCELLED, STATUS_REJECTED, STATUS_EXPIRED) else "cancelado",
            "group_id": str(booking.group_id) if booking.group_id else "",
        })
    return out


def mensalista_sessions(db: Session, manager, booking_id) -> list[dict]:
    arena = manager_arena_or_404(db, manager)
    booking, court, _, _ = _get_arena_booking(db, arena, booking_id)
    if booking.plan != PLAN_MENSALISTA or not booking.group_id:
        raise HTTPException(status_code=404, detail="Mensalista não encontrado")
    sessions = []
    for s in repo.group_bookings(db, booking.group_id):
        local = _as_local(s.start_at)
        sessions.append({
            "id": str(s.id),
            "data": local.strftime("%d/%m/%Y"),
            "dataValue": local.strftime("%Y-%m-%d"),
            "hora": f"{local.strftime('%H:%M')} – {_as_local(s.end_at).strftime('%H:%M')}",
            "valor": s.subtotal_cents / 100,
            "status": _STATUS_LABEL.get(s.status, s.status),
            "statusClass": _STATUS_CLASS.get(s.status, "pendente"),
        })
    return sessions


def cancel_mensalista(db: Session, manager, booking_id) -> dict:
    arena = manager_arena_or_404(db, manager)
    booking, _, _, _ = _get_arena_booking(db, arena, booking_id)
    if booking.plan != PLAN_MENSALISTA or not booking.group_id:
        raise HTTPException(status_code=404, detail="Mensalista não encontrado")
    ids = {b.id for b in repo.group_bookings(db, booking.group_id)}
    targets = db.execute(
        select_booking().where(Booking.id.in_(ids))
    ).scalars().all()
    from .bookings import _transition_booking as _trans

    count = 0
    for target in targets:
        if target.status not in _TERMINAL_STATUSES and target.status != STATUS_CANCELLED:
            _trans(db, target, STATUS_CANCELLED, actor_id=manager.id, actor_role=ROLE_GERENTE, reason="Mensalista cancelado pelo gerente")
            count += 1
    db.commit()
    return {"ok": True, "canceladas": count}


# --- Financeiro -----------------------------------------------------------

def financeiro(db: Session, manager, periodo: str = "30d") -> dict:
    arena = manager_arena_or_404(db, manager)
    today = now_local().date()
    if periodo == "today":
        start = datetime.combine(today, time.min, tzinfo=TZ)
    elif periodo == "7d":
        start = now_local() - timedelta(days=7)
    else:
        start = now_local() - timedelta(days=30)
    end = now_local()

    gross, subtotal, com, cnt = repo.revenue_for_period(db, arena.id, start, end)
    liquido = subtotal - round(subtotal * settings.arena_fee_rate)
    settlements = repo.settlements_for_arena(db, arena.id)

    return {
        "periodo": periodo,
        "bruto": gross / 100,
        "subtotal": subtotal / 100,
        "comissao": com / 100,
        "liquido": liquido / 100,
        "reservas": cnt,
        "ticket_medio": round(gross / cnt, 2) if cnt else 0,
        "repasses": [_serialize_settlement(s) for s in settlements],
    }


def generate_settlements(db: Session, *, now: datetime | None = None) -> int:
    """Task semanal: cria settlements pending por arena a partir do ledger.

    Usa o periodo fechado (semana anterior) e nunca duplica: um settlement ja
    existe para aquele arena+period_start.
    """
    now = now or now_local()
    week_start, week_end = _week_bounds((now - timedelta(days=7)).date())
    arenas = db.execute(select_arena().where(Arena.deleted_at.is_(None))).scalars().all()
    created = 0
    for arena in arenas:
        gross, subtotal, com, cnt = repo.revenue_for_period(db, arena.id, week_start, week_end)
        if cnt == 0:
            continue
        if repo.unpaid_settlement_for(db, arena.id, week_start):
            continue
        db.add(Settlement(
            id=uuid.uuid4(),
            arena_id=arena.id,
            period_start=week_start.astimezone(timezone.utc).replace(tzinfo=None),
            period_end=week_end.astimezone(timezone.utc).replace(tzinfo=None),
            gross_cents=gross,
            commission_cents=com,
            net_cents=subtotal - round(subtotal * settings.arena_fee_rate),
            bookings_count=cnt,
            status=SETTLEMENT_PENDING,
            due_at=(now_local() + timedelta(days=7)),
        ))
        created += 1
    db.commit()
    return created


# --- Quadras --------------------------------------------------------------

def list_quadras(db: Session, manager) -> dict:
    arena = manager_arena_or_404(db, manager)
    courts = repo.list_courts_for_arena(db, arena.id)
    return {"quadras": [serialize_court(c) for c in courts], "arena": arena.name}


def create_quadra(db: Session, manager, body) -> Court:
    arena = manager_arena_or_404(db, manager)
    court = Court(
        id=uuid.uuid4(),
        arena_id=arena.id,
        name=body.nome,
        sport=body.esporte,
        description=body.descricao,
        price_cents=_price_cents(body.preco),
        price_monthly_cents=_price_cents(body.precoMensalista) if body.precoMensalista is not None else None,
        min_duration_h=max(1, int(body.duracaoMinima or 1)),
        opening_time=_time_field(body.abertura, "08:00"),
        closing_time=_time_field(body.fechamento, "23:00"),
        photos=body.fotos or [],
        amenities=body.comodidades or [],
        is_active=True,
        is_visible=True,
    )
    db.add(court)
    db.commit()
    return court


def update_quadra(db: Session, manager, court_id, body) -> Court:
    arena = manager_arena_or_404(db, manager)
    court = repo.get_court_in_arena(db, court_id, arena.id)
    if court is None:
        raise HTTPException(status_code=404, detail="Quadra não encontrada")
    if body.nome is not None:
        court.name = body.nome
    if body.esporte is not None:
        court.sport = body.esporte
    if body.descricao is not None:
        court.description = body.descricao
    if body.preco is not None:
        court.price_cents = _price_cents(body.preco)
    if body.precoMensalista is not None:
        court.price_monthly_cents = _price_cents(body.precoMensalista)
    if body.duracaoMinima is not None:
        court.min_duration_h = max(1, int(body.duracaoMinima))
    if body.abertura is not None:
        court.opening_time = _time_field(body.abertura, "08:00")
    if body.fechamento is not None:
        court.closing_time = _time_field(body.fechamento, "23:00")
    if body.fotos is not None:
        court.photos = body.fotos
    if body.comodidades is not None:
        court.amenities = body.comodidades
    if body.ativa is not None:
        court.is_active = body.ativa
    if body.visivel is not None:
        court.is_visible = body.visivel
    if body.destaque is not None:
        court.is_featured = body.destaque
    db.commit()
    return court


# --- Avaliacoes -----------------------------------------------------------

def list_avaliacoes(db: Session, manager) -> dict:
    arena = manager_arena_or_404(db, manager)
    avaliacoes = []
    for review, author in repo.reviews_for_arena_owner(db, arena.id):
        avaliacoes.append({
            "id": str(review.id),
            "cliente": author,
            "nota": review.rating,
            "quando": _relative(review.created_at),
            "texto": review.comment or "",
            "resposta": review.reply,
        })
    dist = repo.review_distribution(db, arena.id)
    total = sum(d["qtd"] for d in dist)
    media = round(sum(d["n"] * d["qtd"] for d in dist) / total, 1) if total else 0
    return {
        "avaliacoes": avaliacoes,
        "dist": dist,
        "total": total,
        "media": media,
    }


def reply_avaliacao(db: Session, manager, review_id, resposta: str) -> dict:
    arena = manager_arena_or_404(db, manager)
    review = db.get(Review, _uuid_or_404(review_id))
    if review is None or review.arena_id != arena.id:
        raise HTTPException(status_code=404, detail="Avaliação não encontrada")
    review.reply = resposta
    review.replied_by = manager.id
    review.replied_at = now_local()
    db.commit()
    return {"ok": True, "reviewId": str(review.id)}


# --- Cupons ---------------------------------------------------------------

def list_cupons(db: Session, manager) -> list[dict]:
    arena = manager_arena_or_404(db, manager)
    return [_serialize_coupon(c, arena) for c in repo.list_coupons(db, arena.id)]


def create_cupom(db: Session, manager, body) -> Coupon:
    arena = manager_arena_or_404(db, manager)
    code = body.codigo.strip().upper()
    if repo.get_coupon_by_code(db, code):
        raise HTTPException(status_code=409, detail="Código de cupom já existe")
    court_id = _uuid_or_none(body.courtId) if body.courtId else None
    if court_id:
        court = repo.get_court_in_arena(db, court_id, arena.id)
        if court is None:
            raise HTTPException(status_code=404, detail="Quadra não encontrada")
    expires = None
    if body.expiraEm:
        try:
            expires = datetime.strptime(body.expiraEm, "%Y-%m-%d").replace(tzinfo=TZ)
        except ValueError:
            raise HTTPException(status_code=422, detail="Data de expiração inválida")
    coupon = Coupon(
        id=uuid.uuid4(),
        arena_id=arena.id,
        court_id=court_id,
        code=code,
        discount_percent=max(1, min(100, int(body.descontoPercent))),
        expires_at=expires,
        max_uses=body.maxUsos,
    )
    db.add(coupon)
    db.commit()
    return coupon


def delete_cupom(db: Session, manager, coupon_id) -> dict:
    arena = manager_arena_or_404(db, manager)
    coupon = repo.get_coupon(db, coupon_id, arena.id)
    if coupon is None:
        raise HTTPException(status_code=404, detail="Cupom não encontrado")
    db.delete(coupon)
    db.commit()
    return {"ok": True}


# --- Perfil / config / desativacao ----------------------------------------

def arena_profile(db: Session, manager) -> dict:
    arena = manager_arena_or_404(db, manager)
    return {
        "nome": arena.name,
        "descricao": arena.description or "",
        "endereco": arena.address or "",
        "cidade": arena.city or "",
        "estado": arena.state or "",
        "telefone": arena.phone or "",
        "email": arena.email or "",
        "pixChave": arena.pix_key or "",
        "ativo": arena.is_active,
    }


def update_arena_profile(db: Session, manager, body) -> dict:
    arena = manager_arena_or_404(db, manager)
    if body.nome is not None:
        arena.name = body.nome
    if body.descricao is not None:
        arena.description = body.descricao
    if body.endereco is not None:
        arena.address = body.endereco
    if body.cidade is not None:
        arena.city = body.cidade
    if body.estado is not None:
        arena.state = body.estado
    if body.telefone is not None:
        arena.phone = body.telefone
    if body.email is not None:
        arena.email = body.email
    if body.pixChave is not None:
        arena.pix_key = body.pixChave
    db.commit()
    return arena_profile(db, manager)


def arena_config(db: Session, manager) -> dict:
    arena = manager_arena_or_404(db, manager)
    notif = (arena.settings or {}).get("notifications", {})
    return {
        "notificaReserva": notif.get("reserva", True),
        "notificaPagamento": notif.get("pagamento", True),
        "notificaAvaliacao": notif.get("avaliacao", False),
        "notificaResumo": notif.get("resumo", True),
    }


def update_arena_config(db: Session, manager, body) -> dict:
    arena = manager_arena_or_404(db, manager)
    settings_ = dict(arena.settings or {})
    notif = dict((settings_.get("notifications") or {}))
    if body.notificaReserva is not None:
        notif["reserva"] = body.notificaReserva
    if body.notificaPagamento is not None:
        notif["pagamento"] = body.notificaPagamento
    if body.notificaAvaliacao is not None:
        notif["avaliacao"] = body.notificaAvaliacao
    if body.notificaResumo is not None:
        notif["resumo"] = body.notificaResumo
    settings_["notifications"] = notif
    arena.settings = settings_
    db.commit()
    return arena_config(db, manager)


def desativar_arena(db: Session, manager, motivo: str, periodo: str | None) -> dict:
    arena = manager_arena_or_404(db, manager)
    settings_ = dict(arena.settings or {})
    settings_["deactivation"] = {"motivo": motivo, "periodo": periodo, "desativada_em": now_local().isoformat()}
    arena.settings = settings_
    arena.is_active = False
    cancelled = _cancel_future_bookings(db, arena)
    db.commit()
    return {"ok": True, "canceladas": cancelled}


def _cancel_future_bookings(db: Session, arena: Arena) -> int:
    from .bookings import _transition_booking as _trans

    now_utc = now_local().astimezone(timezone.utc).replace(tzinfo=None)
    targets = db.execute(
        select_booking().where(
            Booking.arena_id == arena.id,
            Booking.status.in_(ACTIVE_STATUSES),
            Booking.start_at >= now_utc,
        )
    ).scalars().all()
    count = 0
    for b in targets:
        if b.status != STATUS_CANCELLED:
            _trans(db, b, STATUS_CANCELLED, actor_id=arena.owner_id, actor_role=ROLE_GERENTE, reason="Arena desativada")
            count += 1
    return count


# --- Internos -------------------------------------------------------------

_TERMINAL_STATUSES = {
    STATUS_PAYMENT_FAILED, STATUS_REJECTED, STATUS_CANCELLED, STATUS_EXPIRED,
}


def _uuid_or_404(value) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError):
        raise HTTPException(status_code=404, detail="Registro não encontrado")


def _uuid_or_none(value):
    if not value:
        return None
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError):
        return None


def select_booking():
    from ..models import Booking as _B
    from sqlalchemy import select as _select
    return _select(_B)


def select_arena():
    from sqlalchemy import select as _select
    return _select(Arena)


def _get_arena_booking(db: Session, arena: Arena, booking_id):
    row = bookings_repo.get_booking(db, booking_id)
    if not row:
        raise HTTPException(status_code=404, detail="Reserva não encontrada")
    booking, court, arena_row = row
    if arena_row.id != arena.id:
        raise HTTPException(status_code=403, detail="Acesso restrito à sua arena")
    return booking, court, arena_row, None


def _relative(value) -> str:
    from .catalog import _relative_date

    return _relative_date(value)
