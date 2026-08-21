"""FastAPI — Partiu Quadra (backend)
Substitui completamente o Flask.
Nao utiliza Jinja2, render_template ou qualquer template server-side.
Responde apenas com JSON e arquivos estaticos.
"""
import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from slowapi.errors import RateLimitExceeded

from .api import (
    localidades,
    quadras,
    reservas,
    mensagens,
    gerente,
    carteira,
    perfil,
    favoritos,
    auth,
    payments,
    notifications,
    devices,
    ws,
    clubes,
    peladas,
    partidas,
    admin,
)
from .core.config import settings
from .core.database import check_database
from .core.logging import setup_logging
from .core.ratelimit import limiter
from .core.redis import ping_redis
from .core.ws import manager
from .middleware.request_log import RequestLogMiddleware

setup_logging(settings.log_level)


logger = logging.getLogger(__name__)

#: De quanto em quanto tempo a manutencao roda. Nao e o tempo de espera de
#: nada: quem manda nisso e payment_mock_confirm_seconds e
#: booking_payment_expire_minutes.
INTERVALO_MANUTENCAO_S = 5.0


def _rodar_manutencao() -> dict:
    """As tres tarefas periodicas, rodadas em processo.

    Todas ja existem em workers/tasks.py, mas o Celery precisa de Redis e de
    um worker de pe — que em desenvolvimento quase nunca estao. Sem elas:

      confirmar  — a reserva nunca sai de "Aguardando pagamento";
      expirar    — quem reservou e nao pagou segura o horario PARA SEMPRE,
                   e nenhum outro jogador consegue aquele slot;
      concluir   — a partida jogada nunca vira "concluida".

    A segunda e a mais cara: o indice unico de slot considera
    `pending_payment` ocupado (que e o certo — o horario tem de ficar preso
    enquanto a pessoa paga), entao sem ninguem expirando, uma desistencia
    silenciosa tira o horario do mercado de vez.
    """
    from .core.database import SessionLocal
    from .services import bookings as bookings_svc
    from .services import mock_autoconfirm

    with SessionLocal() as db:
        confirmados = mock_autoconfirm.confirmar_pendentes(db)
    with SessionLocal() as db:
        expiradas = bookings_svc.expire_stale(db)
        db.commit()
    with SessionLocal() as db:
        concluidas = bookings_svc.complete_finished(db)
        db.commit()
    return {"confirmados": confirmados, "expiradas": expiradas, "concluidas": concluidas}


async def _laco_manutencao() -> None:
    """Substitui o Celery beat quando se roda em desenvolvimento.

    Confirmar pagamento fica no SERVIDOR, e nao no navegador: um callback
    disparado pelo cliente e callback forjado. O front fazia isso e quebrou em
    silencio quando PAYMENT_WEBHOOK_SECRET entrou no .env.

    Expirar reserva importa tanto quanto: o horario fica preso enquanto a
    pessoa paga (correto), mas se ninguem expirar, quem desistiu leva o
    horario junto — nenhum outro jogador consegue reservar aquele slot,
    nunca mais.

    A sessao do banco e sincrona, entao roda em thread para nao travar o loop.
    """
    while True:
        await asyncio.sleep(INTERVALO_MANUTENCAO_S)
        try:
            feito = await asyncio.to_thread(_rodar_manutencao)
            if any(feito.values()):
                logger.info("Manutencao de reservas: %s", feito)
        except asyncio.CancelledError:
            raise
        except Exception:
            # Uma falha aqui nao pode derrubar o servidor: o proximo ciclo
            # tenta de novo daqui a pouco.
            logger.warning("Falha na manutencao de reservas", exc_info=True)


@asynccontextmanager
async def lifespan(application: FastAPI):
    manager.start_subscriber()

    # So com o provedor mock. Producao nem chega aqui: Settings recusa o boot
    # com PAYMENT_PROVIDER=mock.
    manutencao = None
    if settings.payment_provider.strip().lower() == "mock":
        manutencao = asyncio.create_task(_laco_manutencao())

    yield

    if manutencao:
        manutencao.cancel()
        try:
            await manutencao
        except asyncio.CancelledError:
            pass
    manager.stop_subscriber()


app = FastAPI(
    title=settings.app_name,
    description="Partiu Quadra — API de reservas de quadras esportivas",
    version=settings.app_version,
    lifespan=lifespan,
)

app.state.limiter = limiter

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(RequestLogMiddleware)

app.include_router(localidades.router)
app.include_router(quadras.router)
app.include_router(reservas.router)
app.include_router(mensagens.router)
app.include_router(gerente.router)
app.include_router(carteira.router)
app.include_router(perfil.router)
app.include_router(favoritos.router)
app.include_router(auth.router)
app.include_router(payments.router)
app.include_router(notifications.router)
app.include_router(devices.router)
app.include_router(ws.router)
app.include_router(clubes.router)
app.include_router(peladas.router)
app.include_router(partidas.router)
app.include_router(admin.router)


@app.get("/api/health")
def health():
    db_ok = check_database()
    redis_ok = ping_redis()
    return {
        "status": "ok" if db_ok and redis_ok else "degraded",
        "db": "ok" if db_ok else "error",
        "redis": "ok" if redis_ok else "error",
        "app": settings.app_name,
        "version": settings.app_version,
        "environment": settings.environment,
    }


@app.get("/api/health/ready")
def ready():
    """Readiness para o deploy: so o banco decide 200/503.

    Redis nao bloqueia (a app roda degradada sem ele); rate limiting tem
    fallback em memoria. O frontend/SPA esta montado junto, entao um 200
    aqui tambem implica estaticos servidos.
    """
    db_ok = check_database()
    if not db_ok:
        return JSONResponse(status_code=503, content={"status": "unavailable", "db": "error"})
    return {
        "status": "ready",
        "db": "ok",
        "app": settings.app_name,
        "version": settings.app_version,
    }


@app.exception_handler(RateLimitExceeded)
async def _rate_limit_exceeded(request: Request, exc: RateLimitExceeded):
    response = JSONResponse(
        status_code=429,
        content={
            "detail": "Muitas requisições. Tente novamente em instantes.",
            "rate_limited": True,
        },
    )
    response.headers["Retry-After"] = "60"
    response.headers["X-RateLimit-Limit"] = str(getattr(exc.limit, "limit", ""))
    return response


ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FRONTEND_DIR = os.path.join(ROOT, "www")


# Config de runtime e paginas nunca podem ficar presas no cache do navegador.
# StaticFiles so manda ETag/Last-Modified; sem Cache-Control o navegador aplica
# cache heuristico e serve a copia velha SEM revalidar. Foi assim que uma
# GOOGLE_CLIENT_ID recem-preenchida continuou chegando vazia no front, e o
# botao do Google seguiu dizendo "em breve" com tudo ja configurado.
#
# no-cache nao quer dizer "nao guarde": guarda, mas revalida antes de usar.
# Com o ETag que ja existe, a revalidacao devolve 304 e nao custa banda.
_SEM_CACHE = ("/config/", "/sw.js")


@app.middleware("http")
async def _no_cache_config(request: Request, call_next):
    response = await call_next(request)
    caminho = request.url.path
    if caminho.startswith(_SEM_CACHE) or caminho.endswith(".html") or caminho == "/":
        response.headers["Cache-Control"] = "no-cache"
    return response


if os.path.isdir(FRONTEND_DIR) and os.listdir(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
