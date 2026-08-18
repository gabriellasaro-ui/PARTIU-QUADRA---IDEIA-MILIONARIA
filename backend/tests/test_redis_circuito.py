"""Disjuntor do Redis (core/redis.py).

Contexto: com o Redis fora do ar, cada operacao custava ~4s de retry e o
/api/quadras (3 operacoes de cache) levava 12s. O fail-open existia no
codigo, mas era lento — e fail-open lento e indistinguivel de API fora,
porque os requests empilham. O disjuntor faz o fallback ser imediato.
"""
import time

import pytest

from app.core import cache
from app.core import redis as R


@pytest.fixture(autouse=True)
def _circuito_limpo():
    R._fechar_circuito()
    yield
    R._fechar_circuito()


class _ClienteFalso:
    """Suficiente para o que cache.py chama."""

    def __init__(self, quebrado=False):
        self.quebrado = quebrado
        self.dados = {}
        self.chamadas = 0

    def _check(self):
        self.chamadas += 1
        if self.quebrado:
            raise ConnectionError("redis fora do ar")

    def get(self, chave):
        self._check()
        return self.dados.get(chave)

    def setex(self, chave, ttl, valor):
        self._check()
        self.dados[chave] = valor
        return True

    def incr(self, chave):
        self._check()
        self.dados[chave] = str(int(self.dados.get(chave, 0)) + 1)

    def delete(self, chave):
        self._check()
        self.dados.pop(chave, None)


def test_operacao_bem_sucedida_mantem_circuito_fechado():
    assert R.redis_call(lambda: "valor") == "valor"
    assert R.redis_operacional() is True


def test_falha_abre_o_circuito_e_devolve_o_padrao():
    def explode():
        raise ConnectionError("redis fora do ar")

    assert R.redis_call(explode, default="fallback") == "fallback"
    assert R.redis_operacional() is False


def test_circuito_aberto_nao_toca_a_rede():
    """O ganho todo esta aqui: a 2a chamada nao chega no cliente."""
    cliente = _ClienteFalso(quebrado=True)

    R.redis_call(lambda: cliente.get("k"))
    assert cliente.chamadas == 1, "a primeira chamada tenta de verdade"
    assert R.redis_operacional() is False

    for _ in range(20):
        R.redis_call(lambda: cliente.get("k"))
    assert cliente.chamadas == 1, (
        f"circuito aberto deixou passar {cliente.chamadas - 1} chamadas extras"
    )


def test_circuito_reabre_sozinho_depois_da_pausa(monkeypatch):
    cliente = _ClienteFalso(quebrado=True)
    monkeypatch.setattr(R.settings, "redis_circuit_seconds", 0.05)

    R.redis_call(lambda: cliente.get("k"))
    assert R.redis_operacional() is False

    time.sleep(0.08)
    assert R.redis_operacional() is True, "o circuito precisa voltar a sondar"

    cliente.quebrado = False
    assert R.redis_call(lambda: cliente.setex("k", 10, "v")) is True
    assert R.redis_operacional() is True


def test_cache_funciona_quando_o_redis_responde(monkeypatch):
    cliente = _ClienteFalso()
    monkeypatch.setattr(R, "redis_client", cliente)
    monkeypatch.setattr(cache, "redis_client", cliente)

    cache.cache_set("quadras:1", {"nome": "Bola na Rede"}, 60)
    assert cache.cache_get("quadras:1") == {"nome": "Bola na Rede"}

    cache.bump_catalog_version()
    assert cache.catalog_version() == 1

    cache.cache_delete("quadras:1")
    assert cache.cache_get("quadras:1") is None


def test_cache_devolve_none_com_redis_fora(monkeypatch):
    cliente = _ClienteFalso(quebrado=True)
    monkeypatch.setattr(R, "redis_client", cliente)
    monkeypatch.setattr(cache, "redis_client", cliente)

    assert cache.cache_get("qualquer") is None
    assert cache.catalog_version() == 0
    cache.cache_set("x", {"a": 1}, 10)  # nao pode levantar
    cache.cache_delete("x")  # nao pode levantar
