"""Cliente Redis compartilhado.

Responsabilidades: cache de leitura, pub/sub do WebSocket, rate limiting,
blacklist de tokens revogados. O lock de disponibilidade de reserva e
transacional no Postgres — Redis nao decide reserva.
"""
import redis

from .config import settings

redis_client = redis.Redis.from_url(
    settings.redis_url,
    decode_responses=True,
    health_check_interval=30,
)


def ping_redis() -> bool:
    """Usado pelo /api/health — retorna True se o Redis responde PING."""
    try:
        return bool(redis_client.ping())
    except redis.RedisError:
        return False
