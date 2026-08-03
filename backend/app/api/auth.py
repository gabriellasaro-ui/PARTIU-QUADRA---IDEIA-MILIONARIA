"""Autenticacao.

Os endpoints de sessao estao declarados com resposta mockada, no mesmo
espirito das rotas de clube que services/venues.js ja chama antes do backend
existir: o contrato fica fechado dos dois lados e a implementacao real entra
sem mexer no cliente.

O que falta para valer de verdade, em ordem:
  1. persistir usuario (models/ e repositories/ ainda estao vazios)
  2. hash de senha (passlib/bcrypt) — nunca guardar senha em texto
  3. emitir e validar JWT no lugar do token fixo
  4. POST /google: validar o idToken junto ao Google e so entao criar ou
     reaproveitar a conta
"""

from datetime import datetime, timezone

from fastapi import APIRouter

from ..core import data
from ..schemas.auth import (
    GoogleRequest,
    LoginRequest,
    OnboardingRequest,
    RegisterRequest,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _usuario(
    user_id: str,
    name: str,
    email: str,
    provider: str = "password",
    onboarded: bool = False,
) -> dict:
    """Chaves iguais as do objeto que o cliente guarda em pq:auth_user, para
    nao precisar de traducao no meio do caminho."""
    return {
        "id": user_id,
        "name": name,
        "email": email,
        "phone": "",
        "city": "",
        "photo": "",
        "position": "",
        "level": "",
        "birthDate": "",
        "foot": "",
        "favoriteSport": "",
        "rating": None,
        "memberSince": datetime.now(timezone.utc).strftime("%b/%Y"),
        "provider": provider,
        "onboardedAt": datetime.now(timezone.utc).isoformat() if onboarded else None,
    }


def _sessao(user: dict, is_new: bool = False) -> dict:
    return {"token": "mock-session-token", "user": user, "isNew": is_new}


@router.post("/login")
def login(payload: LoginRequest):
    # TODO: buscar usuario, conferir o hash da senha, emitir JWT.
    return _sessao(
        _usuario("u-gabriel", data.LOGGED_JOGADOR, payload.email, onboarded=True)
    )


@router.post("/register")
def register(payload: RegisterRequest):
    # TODO: recusar e-mail duplicado (409) e gravar o hash da senha.
    return _sessao(_usuario("u-novo", payload.name, payload.email), is_new=True)


@router.post("/google")
def google(payload: GoogleRequest):
    # TODO: validar payload.idToken junto ao Google antes de confiar nele.
    del payload
    return _sessao(
        _usuario("u-google", "Jogador Google", "jogador@gmail.com", provider="google"),
        is_new=True,
    )


@router.post("/logout")
def logout():
    # TODO: invalidar o token no servidor. Hoje quem limpa e o cliente.
    return {"ok": True}


@router.patch("/onboarding")
def onboarding(payload: OnboardingRequest):
    user = _usuario(
        "u-gabriel", data.LOGGED_JOGADOR, "gabriel@email.com", onboarded=True
    )
    user["position"] = payload.position
    user["level"] = payload.level
    return user


@router.get("/user")
def usuario_atual():
    return {
        "nome": data.LOGGED_JOGADOR,
        "email": "gabriel@email.com",
        "avatar": None,
    }


@router.get("/gerente/user")
def gerente_usuario():
    return {
        "nome": data.LOGGED_ARENA,
        "email": "contato@arenabolanarede.com.br",
        "avatar": None,
        "role": "gerente",
    }
