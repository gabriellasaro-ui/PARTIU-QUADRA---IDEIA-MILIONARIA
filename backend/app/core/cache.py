"""Cache Redis com fail-open (fail-safe).

Redis fora do ar nao derruba leitura: as funcoes caem para consulta direta.
O catalogo usa uma versao por chave (`catalog:version`) para invalidar em
lote no ponto de mutacao (seed agora, gerente na Fase 8).
"""
import json

from .redis import redis_client

CATALOG_VERSION_KEY = "catalog:version"


def catalog_version() -> int:
    try:
        raw = redis_client.get(CATALOG_VERSION_KEY)
        return int(raw) if raw else 0
    except Exception:
        return 0


def bump_catalog_version() -> None:
    """Invalida todo cache de catalogo ao mutar arena/court/review."""
    try:
        redis_client.incr(CATALOG_VERSION_KEY)
    except Exception:
        pass


def cache_get(key: str):
    try:
        raw = redis_client.get(key)
        return json.loads(raw) if raw else None
    except Exception:
        return None


def cache_set(key: str, value, ttl: int) -> None:
    try:
        redis_client.setex(key, ttl, json.dumps(value, default=str))
    except Exception:
        pass


def cache_delete(key: str) -> None:
    try:
        redis_client.delete(key)
    except Exception:
        pass
