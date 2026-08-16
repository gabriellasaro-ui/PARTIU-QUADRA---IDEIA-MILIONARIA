"""Rate limiting (Fase 12) — slowapi sobre Redis com fallback em memoria.

- Storage: REDIS_URL em DB 1 por padrao (DB 0 fica para cache/blacklist).
  Sobrescreva com `RATE_LIMIT_STORAGE` (ex.: redis://redis:6379/1).
- `RATE_LIMIT_ENABLED=false` (testes/dev) desliga os contadores (enabled=False).
- Redis fora do ar: `in_memory_fallback_enabled` ativa um storage em memoria
  (fail-open), igual ao comportamento do cache.
- Rotas publicas de leitura (catalogo) NAO sao limitadas — ja sao cacheadas.
"""
from starlette.requests import Request

from slowapi import Limiter
from slowapi.util import get_remote_address

from .config import settings


def _storage_uri() -> str:
    base = settings.rate_limit_storage or settings.redis_url
    if not base or base.startswith("memory://"):
        return "memory://"
    scheme, sep, rest = base.partition("://")
    if not sep:
        return "memory://"
    host_port = rest.rsplit("/", 1)[0]
    return f"{scheme}://{host_port}/1"


def user_or_ip_key(request: Request) -> str:
    """Chave por usuario autenticado; sem token valido, cai para IP."""
    auth = request.headers.get("Authorization")
    if auth and auth.lower().startswith("bearer "):
        try:
            from ..auth.security import decode_token

            sub = decode_token(auth.split(" ", 1)[1].strip()).get("sub")
            if sub:
                return f"user:{sub}"
        except Exception:
            pass
    return f"ip:{get_remote_address(request)}"


# Limites fixos (documentados em .env.example e docs/CHECKPOINT.md).
LIMIT_AUTH_IP = "10/minute"        # register / login por IP
LIMIT_AUTH_REFRESH_IP = "20/minute"  # refresh / google por IP
LIMIT_WRITE_USER = "20/minute"     # criar reserva / pagar por usuario
LIMIT_CHAT_USER = "30/minute"      # enviar mensagem por usuario


limiter = Limiter(
    key_func=get_remote_address,
    storage_uri=_storage_uri(),
    in_memory_fallback_enabled=True,
    headers_enabled=True,
    enabled=settings.rate_limit_enabled,
)
