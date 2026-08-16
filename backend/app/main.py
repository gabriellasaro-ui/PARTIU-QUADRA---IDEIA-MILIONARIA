"""FastAPI — Partiu Quadra (backend)
Substitui completamente o Flask.
Nao utiliza Jinja2, render_template ou qualquer template server-side.
Responde apenas com JSON e arquivos estaticos.
"""
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from slowapi.errors import RateLimitExceeded

from .api import (
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


@asynccontextmanager
async def lifespan(application: FastAPI):
    manager.start_subscriber()
    yield
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

if os.path.isdir(FRONTEND_DIR) and os.listdir(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
