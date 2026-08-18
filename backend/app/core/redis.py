"""Cliente Redis compartilhado.

Responsabilidades: cache de leitura, pub/sub do WebSocket, rate limiting,
blacklist de tokens revogados. O lock de disponibilidade de reserva e
transacional no Postgres — Redis nao decide reserva.
"""
import time

import redis
from redis.backoff import NoBackoff
from redis.retry import Retry

from .config import settings

# Timeouts curtos + zero retry sao o que torna o fail-open do cache/blacklist
# REAL. Sem isso, o redis-py tenta reconectar com backoff e cada operacao
# custa ~4s com o Redis fora do ar: /api/quadras (3 operacoes de cache)
# levava 12s. Fail-open que demora 12s nao e fail-open — e a API fora do ar,
# porque os requests empilham. Com Redis saudavel na mesma rede a resposta
# vem em milissegundos, entao 0.5s de folga para conectar e muita margem.
redis_client = redis.Redis.from_url(
    settings.redis_url,
    decode_responses=True,
    health_check_interval=30,
    socket_connect_timeout=settings.redis_connect_timeout,
    socket_timeout=settings.redis_socket_timeout,
    retry=Retry(NoBackoff(), 0),
)


# --- Disjuntor ------------------------------------------------------------
#
# Timeout curto resolve o pior caso, mas pagar 1s em TODO request enquanto o
# Redis esta fora ainda derruba o app na pratica. Como aqui o Redis e sempre
# opcional (cache, blacklist, pub/sub — todos com fallback), depois de uma
# falha paramos de tentar por alguns segundos e devolvemos o fallback na
# hora. A primeira tentativa depois da pausa reabre o circuito sozinha.
_circuito_aberto_ate: float = 0.0


def redis_operacional() -> bool:
    """False enquanto o circuito estiver aberto (falha recente)."""
    return time.monotonic() >= _circuito_aberto_ate


def _abrir_circuito() -> None:
    global _circuito_aberto_ate
    _circuito_aberto_ate = time.monotonic() + settings.redis_circuit_seconds


def _fechar_circuito() -> None:
    global _circuito_aberto_ate
    _circuito_aberto_ate = 0.0


def redis_call(operacao, default=None):
    """Roda uma operacao OPCIONAL no Redis.

    Circuito aberto -> devolve `default` sem tocar na rede. Falha -> abre o
    circuito e devolve `default`. Quem precisa de garantia (nada aqui) nao
    deve usar esta funcao.
    """
    if not redis_operacional():
        return default
    try:
        resultado = operacao()
    except Exception:  # noqa: BLE001 — Redis e opcional em todos os usos
        _abrir_circuito()
        return default
    _fechar_circuito()
    return resultado


def ping_redis() -> bool:
    """Usado pelo /api/health — retorna True se o Redis responde PING."""
    return bool(redis_call(redis_client.ping, default=False))
