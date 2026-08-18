"""Cache Redis com fail-open (fail-safe).

Redis fora do ar nao derruba leitura: as funcoes caem para consulta direta.
O catalogo usa uma versao por chave (`catalog:version`) para invalidar em
lote no ponto de mutacao (seed agora, gerente na Fase 8).

Toda operacao passa por `redis_call`, que aplica o disjuntor: com o Redis
fora, o fallback e devolvido na hora, sem pagar timeout de rede em cada
request.
"""
import json

from .redis import redis_call, redis_client

CATALOG_VERSION_KEY = "catalog:version"


def catalog_version() -> int:
    raw = redis_call(lambda: redis_client.get(CATALOG_VERSION_KEY))
    try:
        return int(raw) if raw else 0
    except (TypeError, ValueError):
        return 0


def bump_catalog_version() -> None:
    """Invalida todo cache de catalogo ao mutar arena/court/review."""
    redis_call(lambda: redis_client.incr(CATALOG_VERSION_KEY))


def cache_get(key: str):
    raw = redis_call(lambda: redis_client.get(key))
    if not raw:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return None


def cache_set(key: str, value, ttl: int) -> None:
    payload = json.dumps(value, default=str)
    redis_call(lambda: redis_client.setex(key, ttl, payload))


def cache_delete(key: str) -> None:
    redis_call(lambda: redis_client.delete(key))
