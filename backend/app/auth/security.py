"""Seguranca: hash de senha (bcrypt), JWT de acesso e refresh token opaco."""
import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
import jwt

from ..core.config import settings

TOKEN_TYPE_ACCESS = "access"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# --- Senha ---------------------------------------------------------------

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str | None) -> bool:
    if not password_hash:
        return False
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False


# --- JWT de acesso -------------------------------------------------------

def create_access_token(user_id: Any, session_id: Any, jti: str | None = None) -> str:
    """JWT com claims: sub (usuario), sid (sessao), jti (anti-replay/blacklist)."""
    now = utcnow()
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "sid": str(session_id),
        "jti": jti or uuid.uuid4().hex,
        "type": TOKEN_TYPE_ACCESS,
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_expire_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict[str, Any]:
    """Decodifica e valida expiracao/assinatura. Levanta jwt.PyJWTError."""
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])


# --- Refresh token opaco -------------------------------------------------

def generate_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()
