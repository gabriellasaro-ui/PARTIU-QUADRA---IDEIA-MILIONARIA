"""Catalogo publico: casos de uso de arenas/quadras + serializer do contrato.

Contrato do venue (camelCase) e o mesmo que www-usuario/services/venues.js
ja consome (mock-data.js VENUES): id, name, sport, neighborhood, distance,
rating, reviews, price, priceMonthly, image, gallery, tags, map, reviewItems.
"""
from datetime import datetime, timedelta, time, timezone

from sqlalchemy.orm import Session

from ..core.cache import cache_get, cache_set, catalog_version
from ..core.config import settings
from ..core.geo import haversine_km
from ..core.timezone import TZ, now_local
from ..models import Arena, Court
from ..repositories import venues as repo

DEFAULT_LOC = (-19.9227, -43.9451)  # Centro de Belo Horizonte
HERO_IMG = (
    "https://images.unsplash.com/photo-1459865264687-595d652de67e"
    "?auto=format&fit=crop&w=1600&q=80"
)
# Espelha FEATURED_SPORTS do app: rail da home e um atalho, nao um indice.
FEATURED_SPORTS = ["Futebol Society", "Futsal", "Volei"]

LIST_TTL = 60
SPORTS_TTL = 15 * 60
DEFAULT_LIMIT = 100
MAX_LIMIT = 200


def _as_local(value) -> datetime | None:
    """Normaliza datetime do banco (aware no Postgres, naive no SQLite) para
    o fuso do produto. O seed grava sempre UTC; no SQLite o valor volta naive
    com parede em UTC — por isso naive aqui significa UTC, nao fuso local."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc).astimezone(TZ)
    return value.astimezone(TZ)


def _money(cents: int | None) -> float | None:
    if cents is None:
        return None
    return round(cents / 100, 2)


def _map_xy(lat: float | None, lng: float | None) -> dict:
    x = round(50 + ((lng or DEFAULT_LOC[1]) - DEFAULT_LOC[1]) * 500, 1)
    y = round(50 - ((lat or DEFAULT_LOC[0]) - DEFAULT_LOC[0]) * 500, 1)
    return {"x": x, "y": y, "lat": lat, "lng": lng}


def _relative_date(value) -> str:
    dt = _as_local(value)
    if dt is None:
        return ""
    diff = now_local() - dt
    days = diff.days
    if days <= 0:
        return "Hoje"
    if days == 1:
        return "Ontem"
    if days < 7:
        return f"Há {days} dias"
    weeks = days // 7
    if weeks < 5:
        return f"Há {weeks} semana{'s' if weeks > 1 else ''}"
    months = days // 30
    if months < 12:
        return f"Há {months} mês{'es' if months > 1 else ''}"
    years = days // 365
    return f"Há {years} ano{'s' if years > 1 else ''}"


def bairro_da_arena(arena) -> str:
    """O bairro que o jogador ve — de `neighborhood`, e nao de `address`.

    O painel do gerente grava o bairro em `Arena.neighborhood` desde que o
    cadastro passou a separar bairro de rua (e o CEP passou a preencher os
    dois). Mas TRES lugares do lado do jogador montavam o campo "neighborhood"
    a partir de `arena.address`, que e a RUA. Resultado: o dono trocava o
    bairro no painel, salvava, e o app continuava mostrando o valor antigo —
    parecia que a alteracao nao tinha sido gravada, quando na verdade estava
    sendo gravada num campo que ninguem lia.

    Um comentario em api/quadras.py chegava a afirmar que "nao ha coluna
    neighborhood em Arena". Ha, e indexada, desde models/arena.py.

    `address` NAO ENTRA NA CASCATA, e isso e deliberado.

    A primeira versao caia em `arena.address` quando o bairro estava vazio,
    para nao deixar arena antiga sem nada. So que `address` e texto livre e na
    pratica guarda a RUA: a API chegou a devolver
    `"neighborhood": "Rua Senador Campos Vergueiro 222"`. Publicar a rua da
    arena e justamente o que a plataforma nao faz — quem tem o endereco e o
    telefone fecha por fora, e o app perde a reserva que sustenta o negocio.
    A mesma regra ja vale para o chat, que so abre depois da reserva paga.

    Sem bairro, entao, mostra a CIDADE: menos preciso, nunca o endereco.
    """
    return arena.neighborhood or arena.city or ""


def _distance_to(arena: Arena, lat: float | None, lng: float | None) -> float:
    user_loc = (lat, lng) if lat is not None and lng is not None else DEFAULT_LOC
    if arena.lat is None or arena.lng is None:
        return 0.0
    return round(haversine_km(user_loc, (arena.lat, arena.lng)), 1)


def to_venue(
    arena: Arena,
    court: Court,
    *,
    stats: dict | None = None,
    lat: float | None = None,
    lng: float | None = None,
    reviews: list | None = None,
    db: Session | None = None,
    arena_court_count: int | None = None,
) -> dict:
    photos = court.photos or []
    avg, count = (stats or {}).get(arena.id, (0, 0)) or (0, 0)
    return {
        "id": str(court.id),
        "arenaId": str(arena.id),
        "name": arena.name,
        # NOME DA QUADRA, alem do nome da arena.
        #
        # Toda quadra se apresentava com o nome da ARENA. Numa arena com tres
        # quadras, o jogador via "Arena Bola na Rede" tres vezes na lista e nao
        # tinha como saber qual era qual — nem depois de reservar, porque o
        # comprovante repetia o mesmo nome.
        #
        # `name` continua sendo o da arena: e o que a tela usa como titulo e o
        # que o resto do app ja consome. `courtName` entra como a linha de
        # baixo, e `arenaCourtCount` deixa a tela decidir se vale mostra-la —
        # arena de uma quadra so nao ganha subtitulo que nao distingue nada.
        "arenaName": arena.name,
        "courtName": court.name,
        "arenaCourtCount": arena_court_count if arena_court_count is not None else 1,
        # A LOGO EXISTIA E NUNCA SAIA DAQUI.
        #
        # `Arena.logo` esta no banco desde sempre e o painel do gerente ja
        # deixa o dono subir a dele. Mas nenhum payload do jogador carregava o
        # campo, entao a tela da quadra — que TEM um bloco de identidade da
        # arena pronto — desenhava as INICIAIS do nome num circulo. A arena
        # aparecia sem cara, e a marca que o dono cadastrou nao chegava a
        # ninguem. Vazio continua caindo nas iniciais, que e o fallback certo.
        "arenaLogo": arena.logo or "",
        "sport": court.sport,
        "neighborhood": bairro_da_arena(arena),
        "distance": _distance_to(arena, lat, lng),
        "rating": avg,
        "reviews": count,
        "price": _money(court.price_cents),
        "priceMonthly": _money(court.price_monthly_cents),
        "image": photos[0] if photos else "",
        "gallery": photos or [],
        "tags": court.amenities or [],
        "map": _map_xy(arena.lat, arena.lng),
        # "Aberta agora" de VERDADE. O card do app decidia isso com
        # `venue.id % 3`, e como o id e UUID a conta dava NaN: todo mundo
        # aparecia como "Livre agora", inclusive quadra fechada. `db` e
        # opcional porque nem todo chamador tem sessao a mao; sem ela o campo
        # sai como None e a tela simplesmente nao mostra o selo.
        "openNow": _is_open_now(db, court) if db is not None else None,
        "reviewItems": [
            {
                "author": author,
                "date": _relative_date(review.created_at),
                "rating": review.rating,
                "text": review.comment or "",
            }
            for review, author in (reviews or [])
        ],
    }


# --- Casos de uso -------------------------------------------------------

def list_venues(
    db: Session,
    *,
    sport: str | None = None,
    search: str | None = None,
    lat: float | None = None,
    lng: float | None = None,
    agora: bool = False,
    limit: int = DEFAULT_LIMIT,
    offset: int = 0,
) -> dict:
    limit = max(1, min(int(limit or DEFAULT_LIMIT), MAX_LIMIT))
    offset = max(0, int(offset or 0))
    key = (
        f"{catalog_version()}:q:list:{sport or '-'}:{search or '-'}:"
        f"{lat or '-'}:{lng or '-'}:{agora}:{limit}:{offset}"
    )
    cached = cache_get(key)
    if cached is not None:
        return cached

    rows = repo.list_visible_courts(db, sport=sport, search=search)
    if agora:
        rows = [r for r in rows if _is_open_now(db, r[0])]

    stats = repo.review_stats(db, [r[1].id for r in rows]) if rows else {}
    total = len(rows)
    page = rows[offset : offset + limit]
    # Contagem por arena calculada UMA vez para a pagina inteira: dentro do
    # to_venue seria uma consulta por quadra listada.
    contagens = repo.court_counts(db, [a.id for _, a in page]) if page else {}
    venues = [
        to_venue(arena, court, stats=stats, lat=lat, lng=lng, db=db,
                 arena_court_count=contagens.get(arena.id))
        for court, arena in page
    ]
    # boost > rating > distancia — mesma regra que o app aplica do lado dele.
    venues.sort(key=lambda v: (v["rating"] or 0, -v["distance"]), reverse=True)

    payload = {
        "quadras": venues,
        "total": total,
        "esportes": repo.sports_list(db),
        "user_loc": [lat or DEFAULT_LOC[0], lng or DEFAULT_LOC[1]],
    }
    cache_set(key, payload, LIST_TTL)
    return payload


def get_venue_detail(db: Session, court_id, *, lat=None, lng=None) -> dict | None:
    row = repo.get_visible_court(db, court_id)
    if not row:
        return None
    court, arena = row
    stats = repo.review_stats(db, [arena.id])
    reviews = repo.reviews_for_arena(db, arena.id, limit=3)
    contagens = repo.court_counts(db, [arena.id])
    return to_venue(arena, court, stats=stats, lat=lat, lng=lng, reviews=reviews, db=db,
                    arena_court_count=contagens.get(arena.id))


def get_arena_profile(db: Session, arena_id, *, lat=None, lng=None) -> dict | None:
    """A vitrine da arena: quem ela e, e tudo o que ela tem para alugar.

    O app listava quadras soltas. Uma arena com tres quadras aparecia tres
    vezes na busca e nao existia lugar nenhum onde ela fosse UMA coisa — com
    logo, descricao, avaliacoes e catalogo. E o modelo do iFood invertido: la
    voce entra no restaurante e ve os produtos; aqui so havia produtos.

    O QUE ESTA PAGINA NAO MOSTRA, e por que:

    Nada de telefone, e-mail ou rua. Nao e descuido nem falta de espaco — quem
    sai daqui com o contato e o endereco fecha por fora, e a plataforma perde
    a reserva que a sustenta. A mesma regra ja governa o chat com a arena, que
    so abre depois da reserva paga. Localizacao aqui e bairro/cidade mais o
    NOSSO mapa; `arena.phone`, `arena.email`, `arena.pix_key` e `arena.address`
    nao entram no retorno em hipotese nenhuma.

    Devolve None quando a arena nao existe ou esta fora do ar — a API traduz
    para 404.
    """
    arena = repo.get_visible_arena(db, arena_id)
    if arena is None:
        return None

    rows = repo.list_visible_courts(db, arena_ids=[arena.id])
    stats = repo.review_stats(db, [arena.id])
    avg, count = stats.get(arena.id, (0, 0)) or (0, 0)

    # `arena_court_count` sai de len(rows) e nao de repo.court_counts: e a
    # mesma contagem, ja em memoria, e uma consulta a menos.
    quadras = [
        to_venue(arena, court, stats=stats, lat=lat, lng=lng, db=db,
                 arena_court_count=len(rows))
        for court, _ in rows
    ]

    # GALERIA DA ARENA = as fotos das quadras, sem repetir.
    #
    # Arena nao tem album proprio no banco, e criar um agora obrigaria o dono a
    # subir tudo de novo para a vitrine aparecer. As fotos das quadras SAO as
    # fotos da arena; dedup porque a mesma imagem as vezes esta em duas quadras,
    # e a vitrine mostraria o mesmo campo duas vezes seguidas.
    fotos: list[str] = []
    for court, _ in rows:
        for foto in (court.photos or []):
            if foto and foto not in fotos:
                fotos.append(foto)

    precos = [q["price"] for q in quadras if q["price"] is not None]
    esportes = sorted({q["sport"] for q in quadras if q["sport"]})

    return {
        "id": str(arena.id),
        "nome": arena.name,
        "logo": arena.logo or "",
        "descricao": arena.description or "",
        "bairro": bairro_da_arena(arena),
        "cidade": arena.city or "",
        "estado": arena.state or "",
        "rating": avg,
        "reviews": count,
        "distancia": _distance_to(arena, lat, lng),
        "map": _map_xy(arena.lat, arena.lng),
        "fotos": fotos,
        "quadras": quadras,
        "totalQuadras": len(quadras),
        "precoMin": min(precos) if precos else None,
        "esportes": esportes,
        "avaliacoes": [
            {
                "author": autor,
                "date": _relative_date(review.created_at),
                "rating": review.rating,
                "text": review.comment or "",
            }
            for review, autor in repo.reviews_for_arena(db, arena.id)
        ],
    }


def list_arenas(db: Session, *, lat=None, lng=None, limit: int = 20) -> list[dict]:
    """Arenas com quadra disponivel, da mais perto para a mais longe.

    Alimenta a faixa "Arenas perto de voce" da home. Sai da MESMA consulta da
    busca de quadras, agrupada por arena: assim a faixa nunca mostra arena que
    a lista de baixo nao mostraria, e nao ha um segundo conceito de
    "visivel" para manter em dia.

    Resumo curto de proposito — logo, bairro, nota, quantas quadras e a partir
    de quanto. O resto e o perfil que conta; repetir tudo aqui so faria a faixa
    competir com a tela para onde ela leva.
    """
    rows = repo.list_visible_courts(db)
    if not rows:
        return []

    stats = repo.review_stats(db, [arena.id for _, arena in rows])

    por_arena: dict = {}
    for court, arena in rows:
        item = por_arena.get(arena.id)
        if item is None:
            avg, count = stats.get(arena.id, (0, 0)) or (0, 0)
            item = {
                "id": str(arena.id),
                "nome": arena.name,
                "logo": arena.logo or "",
                "bairro": bairro_da_arena(arena),
                "cidade": arena.city or "",
                "rating": avg,
                "reviews": count,
                "distancia": _distance_to(arena, lat, lng),
                "map": _map_xy(arena.lat, arena.lng),
                "quadras": 0,
                "precoMin": None,
                "esportes": [],
                # Uma foto para a faixa nao ficar so de logo: arena sem logo
                # cairia num circulo de iniciais e nada mais.
                "foto": "",
            }
            por_arena[arena.id] = item

        item["quadras"] += 1
        preco = _money(court.price_cents)
        if preco is not None and (item["precoMin"] is None or preco < item["precoMin"]):
            item["precoMin"] = preco
        if court.sport and court.sport not in item["esportes"]:
            item["esportes"].append(court.sport)
        if not item["foto"] and (court.photos or []):
            item["foto"] = court.photos[0]

    arenas = list(por_arena.values())
    for item in arenas:
        item["esportes"].sort()
    arenas.sort(key=lambda a: a["distancia"])
    return arenas[: max(1, int(limit or 20))]


def _day_window(db: Session, court: Court, day: datetime) -> list[tuple[time, time]]:
    """Faixas de funcionamento do dia. Lista vazia = FECHADO.

    Tres situacoes distintas, que antes eram duas:

      linha com closed=True  -> o gerente disse que nao abre. Devolve [].
      linha com horario      -> abre nessas faixas.
      nenhuma linha          -> nao configurado ainda; cai no padrao do court.

    O terceiro caso e o fallback, e ele so vale para quem NUNCA mexeu na grade.
    Antes ele tambem engolia o segundo: apagar o domingo caia no padrao e a
    quadra aparecia aberta — o oposto do que o gerente tinha feito.
    """
    rec = repo.recurring_for_court(db, court.id, day.weekday())
    if rec:
        # Basta uma linha marcada como fechada para o dia inteiro fechar: e
        # assim que o gerente desliga o dia, e ter faixa junto seria
        # contraditorio.
        if any(getattr(r, "closed", False) for r in rec):
            return []
        return [(r.start_time, r.end_time) for r in rec]
    return [(court.opening_time, court.closing_time)]


def _is_open_now(db: Session, court: Court) -> bool:
    now = now_local()
    return any(
        start <= now.time() < end for start, end in _day_window(db, court, now)
    )


def court_exists(db: Session, court_id) -> bool:
    """Existe e esta visivel — o que separa 404 de "sem horario nesse dia"."""
    return repo.get_visible_court(db, court_id) is not None


def get_availability(db: Session, court_id, date_str: str | None = None) -> list:
    """Slots de {hour, status} para a data (padrao: hoje).

    `busy`: horario ja passou (hoje), bloqueado por manutencao/evento, ou
    fora da janela do court. Reservas ocupam slots a partir da Fase 4.
    """
    row = repo.get_visible_court(db, court_id)
    if not row:
        return []
    court, _ = row

    today = now_local().date()
    if date_str:
        day = datetime.strptime(date_str, "%Y-%m-%d").date()
    else:
        day = today
    day_start = datetime.combine(day, time.min, tzinfo=TZ)
    day_end = day_start + timedelta(days=1)
    blocks = repo.blocks_for_court(db, court_id, day_start, day_end)
    # Fase 4: reservas ativas ocupam o slot (pending_payment -> completed).
    bookings = _active_bookings(db, court_id, day_start, day_end)
    now = now_local()

    slots: list[dict] = []
    for start_t, end_t in _day_window(db, court, day_start):
        cur = day_start.replace(hour=start_t.hour, minute=start_t.minute)
        end_dt = day_start.replace(hour=end_t.hour, minute=end_t.minute)
        while cur < end_dt:
            status = "free"
            if day == today and cur <= now:
                status = "busy"
            for block in blocks:
                b_start = _as_local(block.start_at)
                b_end = _as_local(block.end_at)
                if b_start <= cur < b_end:
                    status = "busy"
                    break
            if status != "busy" and _booked(cur, bookings):
                status = "busy"
            slots.append({"hour": cur.strftime("%H:%M"), "status": status})
            cur += timedelta(hours=1)
    return slots


def _active_bookings(db, court_id, start, end):
    from ..repositories import bookings as bookings_repo

    return bookings_repo.active_bookings_for_court(db, court_id, start, end)


def _booked(cur: datetime, bookings) -> bool:
    for booking in bookings:
        b_start = _as_local(booking.start_at)
        b_end = _as_local(booking.end_at)
        if b_start <= cur < b_end:
            return True
    return False


def get_resumo(db: Session, court_id, hora: str, dur: int) -> dict | None:
    row = repo.get_visible_court(db, court_id)
    if not row:
        return None
    court, arena = row
    try:
        dur = max(1, min(3, int(dur)))
    except (TypeError, ValueError):
        dur = 1
    price = _money(court.price_cents) or 0
    subtotal = round(price * dur, 2)
    service_fee = round(subtotal * settings.player_fee_rate, 2)
    h_start = int(str(hora).split(":")[0])
    h_end = h_start + dur
    return {
        "quadra": to_venue(arena, court, stats=repo.review_stats(db, [arena.id]), db=db,
                           arena_court_count=repo.court_counts(db, [arena.id]).get(arena.id)),
        "hora": hora,
        "hora_fim": f"{h_end:02d}:00",
        "dur": dur,
        "preco": price,
        "subtotal": subtotal,
        "service_fee": service_fee,
        "total": round(subtotal + service_fee, 2),
    }


def get_sports(db: Session, destaque: bool = False) -> list[str]:
    key = f"{catalog_version()}:q:sports:{destaque}"
    cached = cache_get(key)
    if cached is not None:
        return cached
    sports = repo.sports_list(db)
    if destaque:
        sports = [s for s in sports if s in FEATURED_SPORTS]
    cache_set(key, sports, SPORTS_TTL)
    return sports


def get_featured(db: Session, lat: float | None = None, lng: float | None = None) -> dict:
    """Destaques da Home.

    Recebe lat/lng porque a distancia vai no payload. Sem elas, `to_venue`
    media tudo a partir do centro de Goiania (DEFAULT_LOC): uma arena a 600 km
    de quem estava olhando aparecia como "3,8 km" na Home.

    A coordenada entra na CHAVE do cache pelo mesmo motivo — senao o primeiro
    visitante fixaria a distancia dele para todo mundo pelo tempo do TTL.
    """
    origem = f"{lat:.3f},{lng:.3f}" if lat is not None and lng is not None else "padrao"
    key = f"{catalog_version()}:q:featured:{origem}"
    cached = cache_get(key)
    if cached is not None:
        return cached
    rows = repo.list_visible_courts(db)
    stats = repo.review_stats(db, [r[1].id for r in rows]) if rows else {}
    contagens = repo.court_counts(db, [a.id for _, a in rows]) if rows else {}
    venues = [to_venue(arena, court, stats=stats, lat=lat, lng=lng, db=db,
                       arena_court_count=contagens.get(arena.id)) for court, arena in rows]
    venues.sort(key=lambda v: (v["rating"] or 0), reverse=True)
    payload = {
        "destaques": venues[:4],
        "hero": HERO_IMG,
        "esportes": get_sports(db),
    }
    cache_set(key, payload, LIST_TTL)
    return payload


def get_venue_reviews(db: Session, court_id) -> list | None:
    row = repo.get_visible_court(db, court_id)
    if not row:
        return None
    _, arena = row
    return [
        {
            "author": author,
            "date": _relative_date(review.created_at),
            "rating": review.rating,
            "text": review.comment or "",
        }
        for review, author in repo.reviews_for_arena(db, arena.id)
    ]


def get_favorite_venues(db: Session, user_id) -> list:
    arena_ids = repo.favorite_arena_ids(db, user_id)
    if not arena_ids:
        return []
    rows = repo.list_visible_courts(db, arena_ids=arena_ids)
    stats = repo.review_stats(db, arena_ids) if rows else {}
    contagens = repo.court_counts(db, arena_ids) if rows else {}
    return [to_venue(arena, court, stats=stats, db=db, arena_court_count=contagens.get(arena.id))
            for court, arena in rows]


def registrar_interesse(db: Session, court_id, date_str: str | None, hora: str, dur: int) -> None:
    """Conta interesse nas horas do bloco escolhido.

    A versao anterior contava na ABERTURA da agenda, somando 1 em cada hora
    livre do dia. Media quantas vezes o dia foi aberto, e nao qual horario
    interessa — a grade saia com o mesmo numero em todas as colunas.

    Aqui conta so o bloco que a pessoa de fato escolheu: 3h a partir das 19h
    somam 19, 20 e 21. E o unico sinal que responde "quando enche?".
    """
    from ..repositories import gerente as gerente_repo

    dia = now_local().date()
    if date_str:
        try:
            dia = datetime.strptime(date_str, "%Y-%m-%d").date()
        except ValueError:
            return
    try:
        inicio = int(str(hora).split(":")[0])
    except (ValueError, TypeError):
        return
    if not 0 <= inicio <= 23:
        return

    dur = max(1, min(3, int(dur or 1)))
    horas = [h for h in range(inicio, inicio + dur) if h <= 23]
    # 0 = domingo (como a grade e desenhada), e nao segunda como no Python.
    dia_semana = (dia.weekday() + 1) % 7
    gerente_repo.registrar_procura(db, court_id, dia_semana, horas)
