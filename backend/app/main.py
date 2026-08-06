"""FastAPI — Partiu Quadra (backend)
Substitui completamente o Flask.
Nao utiliza Jinja2, render_template ou qualquer template server-side.
Responde apenas com JSON e arquivos estaticos.
"""
import os
import shutil
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

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
)
from .core.config import settings
from .core.database import check_database
from .core.redis import ping_redis
from .core.ws import manager

app = FastAPI(
    title=settings.app_name,
    description="Partiu Quadra — API de reservas de quadras esportivas",
    version=settings.app_version,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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


@app.on_event("startup")
def _start_ws_subscriber():
    manager.start_subscriber()


@app.on_event("shutdown")
def _stop_ws_subscriber():
    manager.stop_subscriber()


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


ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FRONTEND_DIR = os.path.join(ROOT, "www")
BACKEND_DIR = os.path.join(ROOT, "backend")
STATE_JSON = os.path.join(BACKEND_DIR, "state.json")

old_state = os.path.join(ROOT, "shared", "state.json")
if not os.path.exists(STATE_JSON) and os.path.exists(old_state):
    shutil.copy2(old_state, STATE_JSON)

if os.path.isdir(FRONTEND_DIR) and os.listdir(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
