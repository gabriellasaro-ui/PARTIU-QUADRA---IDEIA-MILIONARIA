"""Dependencias FastAPI de autenticacao e autorizacao.

current_user       -> qualquer usuario autenticado (401 se invalido)
current_manager    -> exige role=gerente (403 caso contrario)
current_admin      -> exige role=admin
"""
from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session
import uuid

from ..core.database import get_db
from ..core.redis import redis_client
from ..models import ROLE_ADMIN, ROLE_GERENTE, User
from .security import TOKEN_TYPE_ACCESS, decode_token

_credentials_error = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Sessão inválida",
    headers={"WWW-Authenticate": "Bearer"},
)


def _is_blacklisted(jti: str | None) -> bool:
    """Redis fora do ar nao derruba autenticacao (fail-open)."""
    if not jti:
        return False
    try:
        return bool(redis_client.get(f"auth:blacklist:{jti}"))
    except Exception:
        return False


def get_current_user(
    authorization: str | None = Header(None),
    db: Session = Depends(get_db),
) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise _credentials_error
    token = authorization.split(" ", 1)[1].strip()
    try:
        payload = decode_token(token)
    except Exception:
        raise _credentials_error

    if payload.get("type") != TOKEN_TYPE_ACCESS:
        raise _credentials_error
    if _is_blacklisted(payload.get("jti")):
        raise _credentials_error

    user_id = payload.get("sub")
    if not user_id:
        raise _credentials_error

    try:
        parsed_id = uuid.UUID(user_id)
    except (ValueError, TypeError):
        raise _credentials_error

    user = db.get(User, parsed_id)
    if not user or user.deleted_at:
        raise _credentials_error
    return user


def get_current_manager(user: User = Depends(get_current_user)) -> User:
    if user.role != ROLE_GERENTE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acesso restrito a gerentes de arena",
        )
    return user


def get_current_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != ROLE_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acesso restrito a administradores",
        )
    return user
