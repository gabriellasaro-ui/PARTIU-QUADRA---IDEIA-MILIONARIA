"""Seed idempotente — dados demo por entidade (nunca duplica).

Cada grupo insere apenas se a tabela correspondente estiver vazia (users
sao upsert por e-mail, para redeploy nao violar FK de reviews). Rodado pelo
entrypoint no boot e manualmente com `python -m app.seed`.
"""
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
    CONVERSATION_ACTIVE,
    CONVERSATION_KIND_ARENA,
    MESSAGE_TYPE_TEXT,
    Arena,
    Booking,
    BookingStatusEvent,
    Conversation,
    ConversationParticipant,
    Court,
    CourtBlock,
    CourtRecurringAvailability,
    Message,
    Notification,
    Review,
    User,
    UserDevice,
    UserFavorite,
)

DEMO_PASSWORD = "qadras123"
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

# Espelha www-usuario/config/mock-data.js VENUES (uma arena + uma court demo).
ARENAS = [
    {"key": "bolanarede", "name": "Arena Bola na Rede", "owner": "dono@arenabolanarede.com.br",
     "address": "Jardim Goiás", "city": "Goiania", "state": "GO",
     "lat": -16.7060, "lng": -49.2350,
     "sport": "Futebol Society", "price_cents": 12000, "price_monthly_cents": 40800,
     "photo": "photo-1556056504-5c7696c4c28d",
     "gallery": ["photo-1556056504-5c7696c4c28d", "photo-1577223625816-7546f13df25d",
                 "photo-1459865264687-595d652de67e"],
     "amenities": ["Grama sintética", "Iluminada", "Vestiário"],
     "rating": 4.8},
    {"key": "beachpoint", "name": "Beach Point Arena", "owner": None,
     "address": "Setor Bueno", "city": "Goiania", "state": "GO",
     "lat": -16.7050, "lng": -49.2770,
     "sport": "Beach Tennis", "price_cents": 9000, "price_monthly_cents": 30600,
     "photo": "photo-1626224583764-f87db24ac4ea",
     "gallery": ["photo-1626224583764-f87db24ac4ea", "photo-1612872087720-bb876e2e67d1",
                 "photo-1592656094267-764a45160876"],
     "amenities": ["Areia", "Coberta", "Bar"],
     "rating": 4.9},
    {"key": "zedoquadra", "name": "Quadra do Ze", "owner": None,
     "address": "Setor Sul", "city": "Goiania", "state": "GO",
     "lat": -16.6870, "lng": -49.2620,
     "sport": "Futsal", "price_cents": 8000, "price_monthly_cents": 27200,
     "photo": "photo-1577223625816-7546f13df25d",
     "gallery": ["photo-1577223625816-7546f13df25d", "photo-1556056504-5c7696c4c28d",
                 "photo-1546519638-68e109498ffc"],
     "amenities": ["Piso oficial", "Coberta", "Vestiário"],
     "rating": 4.5},
    {"key": "voleisand", "name": "Volei Sand Club", "owner": None,
     "address": "Setor Oeste", "city": "Goiania", "state": "GO",
     "lat": -16.6780, "lng": -49.2720,
     "sport": "Volei", "price_cents": 7000, "price_monthly_cents": 23800,
     "photo": "photo-1612872087720-bb876e2e67d1",
     "gallery": ["photo-1612872087720-bb876e2e67d1", "photo-1626224583764-f87db24ac4ea",
                 "photo-1592656094267-764a45160876"],
     "amenities": ["Areia", "Estacionamento", "Bar"],
     "rating": 4.7},
    {"key": "topspin", "name": "Top Spin Tenis", "owner": None,
     "address": "Alto da Glória", "city": "Goiania", "state": "GO",
     "lat": -16.7150, "lng": -49.2470,
     "sport": "Tenis", "price_cents": 11000, "price_monthly_cents": 37400,
     "photo": "photo-1595435934249-5df7ed86e1c0",
     "gallery": ["photo-1595435934249-5df7ed86e1c0", "photo-1592656094267-764a45160876",
                 "photo-1626224583764-f87db24ac4ea"],
     "amenities": ["Saibro", "Iluminada", "Aulas"],
     "rating": 4.6},
    {"key": "cestacheia", "name": "Cesta Cheia Basquete", "owner": None,
     "address": "Setor Marista", "city": "Goiania", "state": "GO",
     "lat": -16.6950, "lng": -49.2650,
     "sport": "Basquete", "price_cents": 7500, "price_monthly_cents": 25500,
     "photo": "photo-1546519638-68e109498ffc",
     "gallery": ["photo-1546519638-68e109498ffc", "photo-1577223625816-7546f13df25d",
                 "photo-1556056504-5c7696c4c28d"],
     "amenities": ["Coberta", "Arquibancada", "Vestiário"],
     "rating": 4.4},
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
        exists = db.execute(select(User.id).where(User.email == data["email"])).first()
        if exists:
            continue
        db.add(
            User(
                id=uuid.uuid4(),
                password_hash=hash_password(DEMO_PASSWORD),
                provider="password",
                city="Goiania",
                state="GO",
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
        for i, rating in enumerate(ratings):
            reviewer = reviewers[i % len(reviewers)]
            db.add(Review(
                id=uuid.uuid4(),
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


def seed() -> dict:
    with SessionLocal() as db:
        counts = {
            "users": _seed_users(db),
            "arenas": _seed_arenas(db),
            "courts": _seed_courts(db),
            "availability": _seed_availability(db),
            "blocks": _seed_blocks(db),
            "reviews": _seed_reviews(db),
            "favorites": _seed_favorites(db),
            "bookings": _seed_bookings(db),
            "conversations": _seed_conversations(db),
            "notifications": _seed_notifications(db),
            "devices": _seed_devices(db),
        }
        db.commit()
    bump_catalog_version()
    return counts


if __name__ == "__main__":
    for entity, count in seed().items():
        print(f"seed: {entity} -> {count}")
