"""Dependencias FastAPI de autenticacao e autorizacao.

current_user       -> qualquer usuario autenticado (401 se invalido)
current_manager    -> exige role=gerente (403 caso contrario)
current_admin      -> exige role=admin
"""
from datetime import timezone

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session
import uuid

from ..core.database import get_db
from ..core.redis import redis_call, redis_client
from ..models import ROLE_ADMIN, ROLE_GERENTE, User, UserSession
from .security import TOKEN_TYPE_ACCESS, decode_token, utcnow

_credentials_error = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Sessão inválida",
    headers={"WWW-Authenticate": "Bearer"},
)


def _is_blacklisted(jti: str | None) -> bool:
    """Redis fora do ar nao derruba autenticacao (fail-open, via disjuntor).

    A revogacao de verdade nao depende disto: `_session_is_live` consulta o
    banco. Aqui e so o caminho rapido.
    """
    if not jti:
        return False
    return bool(redis_call(lambda: redis_client.get(f"auth:blacklist:{jti}")))


def _session_is_live(db: Session, sid: str | None) -> bool:
    """A sessao (claim `sid`) ainda vale? Consulta o banco, nao o Redis.

    A blacklist do Redis e fail-open de proposito — Redis fora do ar nao pode
    derrubar todo mundo. Mas isso significa que ela sozinha nao revoga nada de
    verdade: sem Redis, o token de quem deslogou valeria ate expirar sozinho
    (ate 60 min). `user_sessions.revoked_at` e a fonte da verdade; a blacklist
    fica como caminho rapido.
    """
    if not sid:
        return False
    try:
        parsed = uuid.UUID(str(sid))
    except (ValueError, TypeError):
        return False
    session = db.get(UserSession, parsed)
    if session is None or session.revoked_at is not None:
        return False
    expires = session.expires_at
    if expires is not None:
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires < utcnow():
            return False
    return True


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
    if not _session_is_live(db, payload.get("sid")):
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


def authenticate_ws(token: str | None, db: Session) -> User | None:
    """Autentica um WebSocket pelo token de acesso (query ?token=)."""
    if not token:
        return None
    try:
        payload = decode_token(token)
    except Exception:
        return None
    if payload.get("type") != TOKEN_TYPE_ACCESS:
        return None
    if _is_blacklisted(payload.get("jti")):
        return None
    if not _session_is_live(db, payload.get("sid")):
        return None
    try:
        parsed_id = uuid.UUID(payload.get("sub", ""))
    except (ValueError, TypeError):
        return None
    user = db.get(User, parsed_id)
    if not user or user.deleted_at:
        return None
    return user


def get_optional_user(
    authorization: str | None = Header(None),
    db: Session = Depends(get_db),
) -> User | None:
    """Igual a current_user, mas devolve None (em vez de 401) sem sessao."""
    try:
        return get_current_user(authorization=authorization, db=db)
    except HTTPException:
        return None
