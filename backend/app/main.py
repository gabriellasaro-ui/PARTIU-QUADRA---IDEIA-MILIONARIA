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
)

app = FastAPI(
    title="Qadras API",
    description="Partiu Quadra — API de reservas de quadras esportivas",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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


@app.get("/api/health")
def health():
    return {"status": "ok", "app": "Qadras API"}


ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FRONTEND_DIR = os.path.join(ROOT, "www")
BACKEND_DIR = os.path.join(ROOT, "backend")
STATE_JSON = os.path.join(BACKEND_DIR, "state.json")

old_state = os.path.join(ROOT, "shared", "state.json")
if not os.path.exists(STATE_JSON) and os.path.exists(old_state):
    shutil.copy2(old_state, STATE_JSON)

if os.path.isdir(FRONTEND_DIR) and os.listdir(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
