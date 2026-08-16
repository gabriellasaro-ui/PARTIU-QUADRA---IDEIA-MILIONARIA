"""Teste isolado do rate limit — mini-app com Limiter em memória (Fase 12).

O app principal tem RATE_LIMIT_ENABLED=false nos testes; este modulo cria
uma mini-app com Limiter(enabled=True) para validar que o 429 funciona.
"""
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address


def _make_app(limit: str = "3/minute"):
    app = FastAPI()
    limiter = Limiter(
        key_func=get_remote_address,
        enabled=True,
        storage_uri="memory://",
    )
    app.state.limiter = limiter

    @app.exception_handler(RateLimitExceeded)
    async def handler(request: Request, exc: RateLimitExceeded):
        return JSONResponse(status_code=429, content={"rate_limited": True})

    @app.get("/limited")
    @limiter.limit(limit)
    def limited(request: Request):
        return {"ok": True}

    return app


def test_rate_limit_429():
    from fastapi.testclient import TestClient

    app = _make_app(limit="2/minute")
    c = TestClient(app, raise_server_exceptions=False)

    r1 = c.get("/limited")
    assert r1.status_code == 200
    r2 = c.get("/limited")
    assert r2.status_code == 200
    r3 = c.get("/limited")
    assert r3.status_code == 429
    assert r3.json()["rate_limited"] is True


def test_disabled_limiter_no_429():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    app = FastAPI()
    limiter = Limiter(key_func=get_remote_address, enabled=False, storage_uri="memory://")
    app.state.limiter = limiter

    @app.get("/limited")
    @limiter.limit("1/minute")
    def limited(request: Request):
        return {"ok": True}

    c = TestClient(app, raise_server_exceptions=False)
    for _ in range(10):
        r = c.get("/limited")
        assert r.status_code == 200
