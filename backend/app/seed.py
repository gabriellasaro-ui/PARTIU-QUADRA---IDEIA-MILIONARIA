"""Seed idempotente — dados demo por entidade (nunca duplica).

Cada grupo insere apenas se a tabela correspondente estiver vazia (users
sao upsert por e-mail, para redeploy nao violar FK de reviews). Rodado pelo
entrypoint no boot e manualmente com `python -m app.seed`.
"""
import secrets
import uuid
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select

from .auth.security import hash_password
from .core.cache import bump_catalog_version
from .core.config import settings
from .core.database import SessionLocal
from .models import (
    ROLE_ADMIN,
    ROLE_GERENTE,
    ROLE_JOGADOR,
    PLAN_AVULSO,
    PLAN_MENSALISTA,
    STATUS_COMPLETED,
    STATUS_CONFIRMED,
    STATUS_PENDING_PAYMENT,
    STATUS_REQUESTED,
    PAYMENT_CONFIRMED,
    SETTLEMENT_PAID,
    CONVERSATION_ACTIVE,
    CONVERSATION_KIND_ARENA,
    MESSAGE_TYPE_TEXT,
    CLUB_JOIN_ABERTO,
    CLUB_JOIN_SOLICITACAO,
    CLUB_ROLE_ADMIN,
    CLUB_ROLE_DONO,
    CLUB_ROLE_MEMBRO,
    ATTENDANCE_SIM,
    PELADA_KIND_AVULSA,
    PELADA_KIND_CLUBE,
    PELADA_STATUS_AGENDADA,
    MATCH_STATUS_SCHEDULED,
    ADMIN_ACTION_ARENA_PAUSE,
    AdminAction,
    Arena,
    Booking,
    BookingStatusEvent,
    Club,
    ClubMember,
    ClubMessage,
    Conversation,
    ConversationParticipant,
    Coupon,
    Court,
    CourtBlock,
    CourtRecurringAvailability,
    Match,
    MatchEvent,
    MatchMedia,
    MatchPlayer,
    MatchTeam,
    Message,
    Notification,
    Payment,
    Pelada,
    PeladaAttendance,
    Review,
    Settlement,
    User,
    UserDevice,
    UserFavorite,
)

DEMO_PASSWORD = "qadras123"

# Em producao, o admin recebe uma senha aleatoria impressa no log.
# Se RESET_ADMIN_PASSWORD=true, a senha e regenerada e atualizada no banco.
_reset_admin = str(getattr(settings, "reset_admin_password", "")).lower() in ("true", "1", "yes")

if settings.environment == "production":
    _admin_password = secrets.token_urlsafe(16)
    import logging
    if _reset_admin:
        logging.getLogger("app.seed").warning(
            "RESET_ADMIN_PASSWORD=true: senha do admin sera REGENERADA: %s",
            _admin_password,
        )
    else:
        logging.getLogger("app.seed").warning(
            "SENHA DO ADMIN (producao): %s  —  "
            "guarde esta senha; ela NAO sera exibida novamente.",
            _admin_password,
        )
else:
    _admin_password = DEMO_PASSWORD

TZ = ZoneInfo(settings.timezone)

IMG = "https://images.unsplash.com/"
Q = "?auto=format&fit=crop&w=900&q=80"

DEMO_USERS = [
    {"email": "gabriel@email.com", "name": "Gabriel Lisboa", "role": ROLE_JOGADOR},
    {"email": "dono@arenabolanarede.com.br", "name": "Dono Arena Bola na Rede", "role": ROLE_GERENTE},
    {"email": "admin@qadras.com.br", "name": "Admin Qadras", "role": ROLE_ADMIN},
    {"email": "mariana@email.com", "name": "Mariana Alves", "role": ROLE_JOGADOR},
    {"email": "joao@email.com", "name": "João Pedro", "role": ROLE_JOGADOR},
    {"email": "rafael@email.com", "name": "Rafael Costa", "role": ROLE_JOGADOR},
    {"email": "camila@email.com", "name": "Camila Rocha", "role": ROLE_JOGADOR},
]

# UMA arena de demonstracao, e nao seis.
#
# As outras cinco (beach tennis, futsal, volei, tenis, basquete) sairam a
# pedido: existiam so para encher o mapa, e quadra falsa em tela de teste
# esconde o que o fluxo real faz. Sobra a Bola na Rede porque e a unica com
# gerente dono (dono@arenabolanarede.com.br) — sem dono nao ha quem aprove
# a reserva, e o pagamento morreria parado em "requested".
#
# Para voltar a ter varias, o historico deste arquivo guarda as cinco.
ARENAS = [
    {"key": "bolanarede", "name": "Arena Bola na Rede", "owner": "dono@arenabolanarede.com.br",
     "address": "Savassi", "city": "Belo Horizonte", "state": "MG",
     "lat": -19.9386, "lng": -43.9333,
     "sport": "Futebol Society", "price_cents": 12000, "price_monthly_cents": 40800,
     "photo": "photo-1556056504-5c7696c4c28d",
     "gallery": ["photo-1556056504-5c7696c4c28d", "photo-1577223625816-7546f13df25d",
                 "photo-1459865264687-595d652de67e"],
     "amenities": ["Grama sintética", "Iluminada", "Vestiário"],
     "rating": 4.8},
]

REVIEW_COMMENTS = [
    "Quadra muito bem cuidada, iluminação ótima e atendimento rápido.",
    "A reserva foi tranquila. O vestiário estava limpo e o horário começou pontualmente.",
    "Boa estrutura para jogar com a turma. Voltaria a reservar sem dúvida.",
    "Espaço organizado, fácil de encontrar e com uma equipe muito atenciosa.",
    "Ótima experiência, estrutura impecável e pontualidade total.",
    "Gostei bastante, recomendo para quem joga com frequência.",
]

# Numero de notas 5 para 10 avaliacoes somarem `rating*10` (media = rating).
def _fives_for(rating: float) -> int:
    return int(round(rating * 10)) - 40


def _photo(pid: str) -> str:
    return IMG + pid + Q


def _seed_users(db) -> int:
    created = 0
    for data in DEMO_USERS:
        user = db.execute(select(User).where(User.email == data["email"])).scalar_one_or_none()
        if user:
            if _reset_admin and data.get("role") == ROLE_ADMIN:
                user.password_hash = hash_password(_admin_password)
                created += 1
            continue
        pwd = _admin_password if data.get("role") == ROLE_ADMIN else DEMO_PASSWORD
        db.add(
            User(
                id=uuid.uuid4(),
                password_hash=hash_password(pwd),
                provider="password",
                city="Belo Horizonte",
                state="MG",
                **data,
            )
        )
        created += 1
    db.flush()
    return created


def _seed_arenas(db) -> int:
    if db.execute(select(Arena.id).limit(1)).first():
        return 0
    users = {u.email: u for u in db.execute(select(User)).scalars()}
    for data in ARENAS:
        owner = users.get(data["owner"]) if data["owner"] else None
        db.add(
            Arena(
                id=uuid.uuid4(),
                owner_id=owner.id if owner else None,
                name=data["name"],
                address=data["address"],
                city=data["city"],
                state=data["state"],
                lat=data["lat"],
                lng=data["lng"],
                is_active=True,
            )
        )
    db.flush()
    return len(ARENAS)


def _seed_courts(db) -> int:
    if db.execute(select(Court.id).limit(1)).first():
        return 0
    arenas = {a.name: a for a in db.execute(select(Arena)).scalars()}
    for data in ARENAS:
        arena = arenas.get(data["name"])
        db.add(
            Court(
                id=uuid.uuid4(),
                arena_id=arena.id,
                name=data["name"],
                sport=data["sport"],
                price_cents=data["price_cents"],
                price_monthly_cents=data["price_monthly_cents"],
                opening_time=time(8, 0),
                closing_time=time(23, 0),
                photos=[_photo(p) for p in data["gallery"]],
                amenities=data["amenities"],
                is_active=True,
                is_visible=True,
            )
        )
    db.flush()
    return len(ARENAS)


def _seed_availability(db) -> int:
    if db.execute(select(CourtRecurringAvailability.id).limit(1)).first():
        return 0
    court_ids = [c.id for c in db.execute(select(Court)).scalars()]
    for court_id in court_ids:
        for dow in range(7):
            db.add(
                CourtRecurringAvailability(
                    court_id=court_id, day_of_week=dow,
                    start_time=time(8, 0), end_time=time(23, 0),
                )
            )
    db.flush()
    return len(court_ids) * 7


def _seed_blocks(db) -> int:
    if db.execute(select(CourtBlock.id).limit(1)).first():
        return 0
    courts = list(db.execute(select(Court)).scalars())
    if len(courts) < 2:
        return 0
    today = datetime.now(TZ).date()

    def local_dt(day_offset: int, hour: int) -> datetime:
        return datetime.combine(
            today + timedelta(days=day_offset), time(hour, 0), tzinfo=TZ
        ).astimezone(timezone.utc)

    db.add(CourtBlock(
        court_id=courts[0].id,
        start_at=local_dt(1, 12), end_at=local_dt(1, 14),
        reason="Manutenção",
    ))
    db.add(CourtBlock(
        court_id=courts[2].id,
        start_at=local_dt(2, 9), end_at=local_dt(2, 10),
        reason="Evento",
    ))
    db.flush()
    return 2


def _seed_reviews(db) -> int:
    """Avaliacoes semeadas AMARRADAS A UMA RESERVA, e por isso a uma quadra.

    Antes elas nasciam com `booking_id` nulo, e `reviews` nao tem court_id — a
    quadra sai da reserva avaliada. Resultado: as dez avaliacoes de cada arena
    caiam todas em "Sem quadra identificada", e a nota por quadra do painel
    ficava invisivel em desenvolvimento. A funcionalidade existia e nao dava
    para ver que existia.

    Nao e so cosmetica de seed: uma arena com quatro quadras precisa saber que
    a nota 4,8 e media de uma quadra 5,0 e uma 3,2. As notas sao distribuidas
    em ordem crescente entre as quadras justamente para que uma delas fique
    visivelmente pior — que e o caso que a tela existe para mostrar.

    Roda DEPOIS de _seed_bookings (veja a ordem em `seed()`): antes disso nao
    havia reserva nenhuma a que se amarrar.
    """
    if db.execute(select(Review.id).limit(1)).first():
        return 0
    arenas = list(db.execute(select(Arena)).scalars())
    reviewers = [u for u in db.execute(select(User)).scalars() if u.email != "admin@qadras.com.br"]
    total = 0
    now = datetime.now(TZ)
    for arena in arenas:
        data = next(a for a in ARENAS if a["name"] == arena.name)
        fives = _fives_for(data["rating"])
        ratings = [5] * fives + [4] * (10 - fives)

        # Uma reserva por quadra da arena serve de ancora. Sem reserva, a
        # avaliacao fica sem quadra — e continua sendo devolvida assim, em vez
        # de chutada para a primeira quadra da lista.
        ancora = {}
        for booking in db.execute(
            select(Booking).where(Booking.arena_id == arena.id).order_by(Booking.start_at)
        ).scalars():
            ancora.setdefault(booking.court_id, booking.id)
        ancoras = list(ancora.values())

        for i, rating in enumerate(ratings):
            reviewer = reviewers[i % len(reviewers)]
            db.add(Review(
                id=uuid.uuid4(),
                booking_id=ancoras[i % len(ancoras)] if ancoras else None,
                arena_id=arena.id,
                user_id=reviewer.id,
                rating=rating,
                comment=REVIEW_COMMENTS[i % len(REVIEW_COMMENTS)],
                created_at=now - timedelta(days=2 + i * 3),
            ))
            total += 1
    db.flush()
    return total


def _seed_favorites(db) -> int:
    if db.execute(select(UserFavorite.user_id).limit(1)).first():
        return 0
    user = db.execute(
        select(User).where(User.email == "gabriel@email.com")
    ).scalar_one_or_none()
    arenas = {a.name: a for a in db.execute(select(Arena)).scalars()}
    if not user:
        return 0
    for name in ("Arena Bola na Rede", "Beach Point Arena", "Volei Sand Club"):
        arena = arenas.get(name)
        if arena:
            db.add(UserFavorite(user_id=user.id, arena_id=arena.id))
    db.flush()
    return 3


def _add_booking(
    db, user, court, *, days, hour, dur=1, plan=PLAN_AVULSO, weekday=None,
    status=STATUS_PENDING_PAYMENT, price_base=None, group_id=None,
    is_session=False, reason=None,
) -> Booking:
    """Cria uma booking direto no formato do servico (UTC-aware)."""
    today = datetime.now(TZ).date()
    start = datetime.combine(
        today + timedelta(days=days), time(hour, 0), tzinfo=TZ
    ).astimezone(timezone.utc).replace(tzinfo=None)
    if is_session:
        subtotal = fee = total = 0
    else:
        base = price_base or court.price_cents
        subtotal = base * dur
        fee = round(subtotal * settings.player_fee_rate)
        total = subtotal + fee
    booking = Booking(
        id=uuid.uuid4(),
        code=f"{settings.booking_code_prefix}{uuid.uuid4().int % 90_000 + 10_000}",
        arena_id=court.arena_id,
        court_id=court.id,
        user_id=user.id,
        status=status,
        plan=plan,
        start_at=start,
        end_at=start + timedelta(hours=dur),
        duration_h=dur,
        weekday=weekday,
        subtotal_cents=subtotal,
        service_fee_cents=fee,
        total_cents=total,
        payment_method="pix",
        quote_snapshot={"subtotal_cents": subtotal, "service_fee_cents": fee, "total_cents": total},
        group_id=group_id,
        is_session=is_session,
        source="app",
        created_by=user.id,
    )
    db.add(booking)
    db.flush()
    db.add(BookingStatusEvent(
        id=uuid.uuid4(), booking_id=booking.id, from_status=None,
        to_status=status, actor_id=user.id, actor_role=ROLE_JOGADOR, reason=reason,
    ))
    return booking


def _seed_bookings(db) -> int:
    """Reservas demo do gabriel espelhando INITIAL_RESERVATIONS do app."""
    if db.execute(select(Booking.id).limit(1)).first():
        return 0
    user = db.execute(
        select(User).where(User.email == "gabriel@email.com")
    ).scalar_one_or_none()
    courts = list(db.execute(select(Court)).scalars())
    if not user or len(courts) < 4:
        return 0

    count = 0
    # Confirmada (amanha 19h, Bola na Rede, R$120 -> R$130,80).
    b = _add_booking(db, user, courts[0], days=1, hour=19, status=STATUS_CONFIRMED)
    db.add(BookingStatusEvent(
        id=uuid.uuid4(), booking_id=b.id, from_status=STATUS_PENDING_PAYMENT,
        to_status=STATUS_REQUESTED, actor_id=None, actor_role="sistema",
    ))
    db.add(BookingStatusEvent(
        id=uuid.uuid4(), booking_id=b.id, from_status=STATUS_REQUESTED,
        to_status=STATUS_CONFIRMED, actor_id=user.id, actor_role=ROLE_GERENTE,
    ))
    count += 1

    # Aguardando pagamento (em +2 dias, Beach Point 08h).
    _add_booking(db, user, courts[1], days=2, hour=8, status=STATUS_PENDING_PAYMENT)
    count += 1

    # Mensalista confirmado: 4 sessoes semanais no mesmo slot (Quadra do Ze).
    group_id = uuid.uuid4()
    for week in range(4):
        session = week > 0
        b = _add_booking(
            db, user, courts[2], days=3 + week * 7, hour=20, plan=PLAN_MENSALISTA,
            weekday=2, status=STATUS_CONFIRMED, price_base=courts[2].price_monthly_cents,
            group_id=group_id, is_session=session,
        )
        if not session:
            db.add(BookingStatusEvent(
                id=uuid.uuid4(), booking_id=b.id, from_status=STATUS_PENDING_PAYMENT,
                to_status=STATUS_REQUESTED, actor_id=None, actor_role="sistema",
            ))
            db.add(BookingStatusEvent(
                id=uuid.uuid4(), booking_id=b.id, from_status=STATUS_REQUESTED,
                to_status=STATUS_CONFIRMED, actor_id=user.id, actor_role=ROLE_GERENTE,
            ))
        count += 1

    # Concluida no passado (Volei Sand) — usada para testar avaliacao.
    _add_booking(db, user, courts[3], days=-3, hour=15, status=STATUS_COMPLETED)
    count += 1

    db.flush()
    return count


def _seed_conversations(db) -> int:
    """Conversa demo Gabriel <-> Arena Bola na Rede (reserva confirmada).

    A conversa so existe a partir do pagamento confirmado; o seed espelha isso
    criando a conversa da reserva confirmada do gabriel.
    """
    if db.execute(select(Conversation.id).limit(1)).first():
        return 0
    user = db.execute(
        select(User).where(User.email == "gabriel@email.com")
    ).scalar_one_or_none()
    arena = db.execute(
        select(Arena).where(Arena.name == "Arena Bola na Rede")
    ).scalar_one_or_none()
    booking = None
    if user:
        booking = db.execute(
            select(Booking).where(
                Booking.user_id == user.id,
                Booking.status == STATUS_CONFIRMED,
                Booking.is_session.is_(False),
            )
        ).scalars().first()
    if not (user and arena and arena.owner_id and booking):
        return 0
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    conv = Conversation(
        id=uuid.uuid4(),
        kind=CONVERSATION_KIND_ARENA,
        arena_id=arena.id,
        player_id=user.id,
        booking_id=booking.id,
        status=CONVERSATION_ACTIVE,
        created_at=now,
        updated_at=now,
    )
    db.add(conv)
    db.flush()
    db.add(ConversationParticipant(
        conversation_id=conv.id, user_id=user.id, created_at=now
    ))
    db.add(ConversationParticipant(
        conversation_id=conv.id, user_id=arena.owner_id, created_at=now
    ))
    db.add(Message(
        id=uuid.uuid4(), conversation_id=conv.id, sender_id=arena.owner_id,
        content="Obrigado pela reserva! Estamos esperando você no horário. Precisa de algo, é só chamar.",
        message_type=MESSAGE_TYPE_TEXT, created_at=now - timedelta(minutes=30),
    ))
    db.add(Message(
        id=uuid.uuid4(), conversation_id=conv.id, sender_id=user.id,
        content="Perfeito! Vamos chegar com uns 15 minutos de antecedência.",
        message_type=MESSAGE_TYPE_TEXT, created_at=now - timedelta(minutes=10),
    ))
    db.flush()
    return 1


def _seed_notifications(db) -> int:
    """Notificacoes demo do gabriel (Fase 7) — badge e central funcionam."""
    if db.execute(select(Notification.id).limit(1)).first():
        return 0
    user = db.execute(
        select(User).where(User.email == "gabriel@email.com")
    ).scalar_one_or_none()
    if not user:
        return 0
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    arena = db.execute(
        select(Arena).where(Arena.name == "Arena Bola na Rede")
    ).scalar_one_or_none()
    arena_id = str(arena.id) if arena else ""
    db.add(Notification(
        id=uuid.uuid4(), user_id=user.id, type="payment.confirmed",
        title="Pagamento confirmado",
        body="Sua reserva em Arena Bola na Rede foi paga e enviada à arena.",
        data={"bookingId": "", "bookingCode": "PQ-12345", "arenaId": arena_id,
              "arenaName": "Arena Bola na Rede", "event": "payment.confirmed"},
        created_at=now - timedelta(days=1),
    ))
    db.add(Notification(
        id=uuid.uuid4(), user_id=user.id, type="booking.approved",
        title="Reserva confirmada",
        body="Sua reserva em Arena Bola na Rede foi confirmada pela arena.",
        data={"bookingId": "", "bookingCode": "PQ-12345", "arenaId": arena_id,
              "arenaName": "Arena Bola na Rede", "event": "booking.approved"},
        read_at=now - timedelta(hours=2),
        created_at=now - timedelta(days=1, hours=-1),
    ))
    db.flush()
    return 2


def _seed_devices(db) -> int:
    """Um device demo para o push do gabriel aparecer em push_logs."""
    if db.execute(select(UserDevice.id).limit(1)).first():
        return 0
    user = db.execute(
        select(User).where(User.email == "gabriel@email.com")
    ).scalar_one_or_none()
    if not user:
        return 0
    db.add(UserDevice(
        id=uuid.uuid4(), user_id=user.id,
        fcm_token="demo-fcm-token-gabriel-0001", platform="fcm",
    ))
    db.flush()
    return 1


def _seed_payments(db) -> int:
    """Ledger demo (Fase 5/8): payments confirmados do financeiro.

    Cria um payment confirmado por booking ativo/concluido nao-sessao (1 por
    booking). Reservas manuais trazem o proprio Payment provider=manual.
    """
    if db.execute(select(Payment.id).limit(1)).first():
        return 0
    bookings = db.execute(
        select(Booking).where(
            Booking.status.in_((STATUS_CONFIRMED, STATUS_COMPLETED)),
            Booking.is_session.is_(False),
            Booking.source != "manual",
        )
    ).scalars().all()
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    count = 0
    for b in bookings:
        db.add(Payment(
            id=uuid.uuid4(),
            booking_id=b.id,
            user_id=b.user_id,
            provider="mock",
            method="pix",
            amount_cents=b.total_cents or b.subtotal_cents,
            status=PAYMENT_CONFIRMED,
            paid_at=now - timedelta(days=1),
        ))
        count += 1
    db.flush()
    return count


def _seed_manual_booking(db) -> int:
    """Reserva manual demo (Fase 8): criada no balcao pelo gerente.

    `source=manual` + Payment provider="manual" — a arena e ressarcida pelo
    mesmo fluxo do ledger; nao ha usuario (user_id nulo, client_* preenchido).
    """
    if db.execute(
        select(Booking.id).where(Booking.source == "manual").limit(1)
    ).first():
        return 0
    arena = db.execute(
        select(Arena).where(Arena.name == "Arena Bola na Rede")
    ).scalar_one_or_none()
    court = None
    if arena:
        court = db.execute(
            select(Court).where(Court.arena_id == arena.id)
        ).scalars().first()
    if not (arena and court):
        return 0
    today = datetime.now(TZ).date()
    start = datetime.combine(
        today + timedelta(days=4), time(21, 0), tzinfo=TZ
    ).astimezone(timezone.utc).replace(tzinfo=None)
    subtotal = court.price_cents
    booking = Booking(
        id=uuid.uuid4(),
        code=f"{settings.booking_code_prefix}{uuid.uuid4().int % 90_000 + 10_000}",
        arena_id=arena.id,
        court_id=court.id,
        user_id=None,
        client_name="Time da Firma",
        client_phone="(62) 99999-0000",
        client_email="",
        status=STATUS_CONFIRMED,
        plan=PLAN_AVULSO,
        start_at=start,
        end_at=start + timedelta(hours=1),
        duration_h=1,
        subtotal_cents=subtotal,
        service_fee_cents=0,
        total_cents=subtotal,
        payment_method="pix",
        quote_snapshot={"subtotal_cents": subtotal, "service_fee_cents": 0, "total_cents": subtotal},
        source="manual",
        created_by=arena.owner_id,
    )
    db.add(booking)
    db.flush()
    db.add(BookingStatusEvent(
        id=uuid.uuid4(), booking_id=booking.id, from_status=None,
        to_status=STATUS_CONFIRMED, actor_id=arena.owner_id,
        actor_role=ROLE_GERENTE, reason="Reserva manual",
    ))
    db.add(Payment(
        id=uuid.uuid4(),
        booking_id=booking.id,
        user_id=None,
        provider="manual",
        method="pix",
        amount_cents=subtotal,
        status=PAYMENT_CONFIRMED,
        paid_at=datetime.now(timezone.utc).replace(tzinfo=None),
    ))
    db.flush()
    return 1


def _seed_coupons(db) -> int:
    """Um cupom demo (Fase 8) para a Arena Bola na Rede."""
    if db.execute(select(Coupon.id).limit(1)).first():
        return 0
    arena = db.execute(
        select(Arena).where(Arena.name == "Arena Bola na Rede")
    ).scalar_one_or_none()
    if not arena:
        return 0
    db.add(Coupon(
        id=uuid.uuid4(),
        arena_id=arena.id,
        code="QADRAS10",
        discount_percent=10,
        active=True,
        expires_at=datetime.now(TZ) + timedelta(days=30),
        max_uses=50,
    ))
    db.flush()
    return 1


def _seed_settlements(db) -> int:
    """Um repasse pago demo (Fase 8) para a arena do gerente."""
    if db.execute(select(Settlement.id).limit(1)).first():
        return 0
    arena = db.execute(
        select(Arena).where(Arena.name == "Arena Bola na Rede")
    ).scalar_one_or_none()
    if not arena:
        return 0
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    today = datetime.now(TZ).date()
    last_monday = today - timedelta(days=today.weekday())
    week_start = datetime.combine(
        last_monday - timedelta(days=7), time(0, 0), tzinfo=TZ
    ).astimezone(timezone.utc).replace(tzinfo=None)
    subtotal = 440_000  # R$4.400
    gross = round(subtotal * 1.09)  # +9% fee do jogador
    db.add(Settlement(
        id=uuid.uuid4(),
        arena_id=arena.id,
        period_start=week_start,
        period_end=week_start + timedelta(days=7),
        gross_cents=gross,
        commission_cents=round(subtotal * 0.12),  # 9% jogador + 3% arena
        net_cents=round(subtotal * 0.97),
        bookings_count=8,
        status=SETTLEMENT_PAID,
        due_at=week_start + timedelta(days=7),
        paid_at=now - timedelta(days=1),
        receipt_url="qadras.app/pix/comprovante-demo",
    ))
    db.flush()
    return 1


def _seed_clubs(db) -> int:
    """Nao semeia mais clube nenhum.

    Havia dois de demonstracao ("Bola na Rede F.C." e "Quinta Suada"), criados
    quando a tela de clube nao tinha o que mostrar. Agora que da para criar
    clube pelo app, eles so poluem: apareciam na busca de todo mundo, com
    membros que nao existem, competindo com os clubes de verdade.

    A funcao fica (em vez de sumir) porque `seed()` conta o retorno de cada
    etapa no resumo, e porque o dia em que houver motivo para semear algo aqui
    o lugar ja esta pronto.
    """
    return 0


def _local_date_of(dt) -> str:
    """Data local (America/Sao_Paulo) de uma dt armazenada como UTC naive."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(TZ).strftime("%Y-%m-%d")


def _local_time_of(dt) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(TZ).strftime("%H:%M")


def _mensal_dates(booking) -> list[str]:
    today = datetime.now(TZ).date()
    start_day = _as_local_date(booking.start_at)
    delta = (start_day - today).days if start_day > today else 0
    return [
        (today + timedelta(days=delta + week * 7)).strftime("%Y-%m-%d")
        for week in range(4)
    ]


def _as_local_date(dt) -> object:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(TZ).date()


def _seed_peladas(db) -> int:
    """Peladas demo (Fase 9): avulsa da reserva confirmada de amanha + as 4
    sessoes do mensalista, vinculadas ao clube demo."""
    if db.execute(select(Pelada.id).limit(1)).first():
        return 0
    user = db.execute(
        select(User).where(User.email == "gabriel@email.com")
    ).scalar_one_or_none()
    # Sem clube: o seed nao cria mais nenhum. Antes isto pegava "o primeiro
    # clube que existir" — o que, num banco onde alguem ja criou o seu, faria
    # peladas de demonstracao aparecerem dentro do clube DE VERDADE da pessoa.
    club = None
    if not user:
        return 0
    courts = {c.id: c for c in db.execute(select(Court)).scalars()}
    arenas = {a.id: a for a in db.execute(select(Arena)).scalars()}
    bookings = db.execute(
        select(Booking).where(
            Booking.user_id == user.id,
            Booking.status == STATUS_CONFIRMED,
            Booking.is_session.is_(False),
        )
    ).scalars().all()
    count = 0
    for b in bookings:
        arena = arenas.get(b.arena_id)
        court = courts.get(b.court_id)
        if not arena:
            continue
        is_club = b.plan == PLAN_MENSALISTA and club is not None
        if b.plan == PLAN_MENSALISTA:
            dates = _mensal_dates(b)
        else:
            dates = [_local_date_of(b.start_at)]
        for date_iso in dates:
            pelada = Pelada(
                id=uuid.uuid4(),
                club_id=club.id if is_club else None,
                source_booking_id=b.id,
                kind=PELADA_KIND_CLUBE if is_club else PELADA_KIND_AVULSA,
                title="Pelada de Quarta" if is_club else f"Jogo na {arena.name}",
                arena_id=arena.id,
                venue_name=arena.name,
                sport=court.sport if court else arena.name,
                date_iso=date_iso,
                start_time=_local_time_of(b.start_at),
                duration_min=b.duration_h * 60,
                max_players=14,
                organizer_id=user.id,
                plan=b.plan,
                reservation_code=b.code,
                status=PELADA_STATUS_AGENDADA,
            )
            db.add(pelada)
            db.flush()
            seen = {user.id}
            db.add(PeladaAttendance(pelada_id=pelada.id, user_id=user.id, value=ATTENDANCE_SIM))
            if is_club:
                for m in db.execute(
                    select(ClubMember).where(ClubMember.club_id == club.id)
                ).scalars():
                    if m.user_id in seen:
                        continue
                    seen.add(m.user_id)
                    db.add(PeladaAttendance(pelada_id=pelada.id, user_id=m.user_id, value=ATTENDANCE_SIM))
            count += 1
    db.flush()
    return count


def _seed_match(db) -> int:
    """Uma partida demo (Fase 9) da reserva confirmada de amanha, com times e
    jogadores, espelhando ACTIVE_MATCH do mock-data.js."""
    if db.execute(select(Match.id).limit(1)).first():
        return 0
    user = db.execute(
        select(User).where(User.email == "gabriel@email.com")
    ).scalar_one_or_none()
    booking = None
    if user:
        booking = db.execute(
            select(Booking).where(
                Booking.user_id == user.id,
                Booking.status == STATUS_CONFIRMED,
                Booking.plan == PLAN_AVULSO,
            )
        ).scalars().first()
    if not (user and booking):
        return 0
    match = Match(
        id=uuid.uuid4(),
        booking_id=booking.id,
        arena_id=booking.arena_id,
        venue_name="Arena Bola na Rede",
        sport="Futebol Society",
        start_at=booking.start_at,
        end_at=booking.end_at,
        duration_min=booking.duration_h * 60,
        status=MATCH_STATUS_SCHEDULED,
        score={"teamA": 0, "teamB": 0},
    )
    db.add(match)
    db.flush()
    for email in ("gabriel@email.com", "mariana@email.com", "joao@email.com",
                  "rafael@email.com", "camila@email.com"):
        member = db.execute(
            select(User).where(User.email == email)
        ).scalar_one_or_none()
        if member:
            db.add(MatchPlayer(
                match_id=match.id, user_id=member.id, name=member.name,
                position=member.position, rating=member.rating, confirmed=True,
            ))
    db.flush()
    return 1


def _seed_admin_actions(db) -> int:
    """Uma acao demo (Fase 10): o admin pausou a Top Spin para auditoria."""
    if db.execute(select(AdminAction.id).limit(1)).first():
        return 0
    admin = db.execute(
        select(User).where(User.email == "admin@qadras.com.br")
    ).scalar_one_or_none()
    arena = db.execute(
        select(Arena).where(Arena.name == "Top Spin Tenis")
    ).scalar_one_or_none()
    if not (admin and arena):
        return 0
    db.add(AdminAction(
        id=uuid.uuid4(),
        admin_id=admin.id,
        action=ADMIN_ACTION_ARENA_PAUSE,
        entity_type="arena",
        entity_id=str(arena.id),
        payload={"motivo": "Exemplo de auditoria", "arena": arena.name, "canceladas": 0},
        created_at=datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=1),
    ))
    db.flush()
    return 1


def seed() -> dict:
    with SessionLocal() as db:
        counts = {
            "users": _seed_users(db),
            "arenas": _seed_arenas(db),
            "courts": _seed_courts(db),
            "availability": _seed_availability(db),
            "blocks": _seed_blocks(db),
            "favorites": _seed_favorites(db),
            "bookings": _seed_bookings(db),
            # DEPOIS de bookings: a avaliacao se amarra a uma reserva, e e da
            # reserva que sai a quadra avaliada.
            "reviews": _seed_reviews(db),
            "conversations": _seed_conversations(db),
            "notifications": _seed_notifications(db),
            "devices": _seed_devices(db),
            "payments": _seed_payments(db),
            "manual_bookings": _seed_manual_booking(db),
            "coupons": _seed_coupons(db),
            "settlements": _seed_settlements(db),
            "clubs": _seed_clubs(db),
            "peladas": _seed_peladas(db),
            "match": _seed_match(db),
            "admin_actions": _seed_admin_actions(db),
        }
        db.commit()
    bump_catalog_version()
    return counts


if __name__ == "__main__":
    for entity, count in seed().items():
        print(f"seed: {entity} -> {count}")
