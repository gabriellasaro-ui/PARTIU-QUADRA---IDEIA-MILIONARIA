"""Configuracoes compartilhadas da suite pytest (Fase 12).

Env vars sao setadas ANTES de qualquer import do `app` (o settings e um
singleton criado no import). RATE_LIMIT_ENABLED=false desliga o slowapi nos
testes; o DB e SQLite isolado em /tmp; LOG_LEVEL=WARNING silencia os logs.
"""
import os

_PQ_DB = "/tmp/opencode/pq_pytest.db"

os.environ["DATABASE_URL"] = f"sqlite:///{_PQ_DB}"
os.environ["ENVIRONMENT"] = "test"
os.environ["RATE_LIMIT_ENABLED"] = "false"
os.environ["JWT_SECRET"] = "test-only-secret-0123456789abcdef-xyz"
os.environ["PAYMENT_PROVIDER"] = "mock"
# Com segredo definido, a suite exercita o webhook PROTEGIDO (o caminho que
# vale em qualquer ambiente que rode o mock), nao o aberto.
os.environ["PAYMENT_WEBHOOK_SECRET"] = WEBHOOK_SECRET = "segredo-de-teste-do-webhook"
os.environ["PUSH_PROVIDER"] = "mock"
os.environ["LOG_LEVEL"] = "WARNING"

import pytest  # noqa: E402

#: Header que o provider mock exige para aceitar um callback de pagamento.
WEBHOOK_HEADERS = {"X-Qadras-Webhook-Secret": WEBHOOK_SECRET}


@pytest.fixture(scope="session", autouse=True)
def _app_db():
    if os.path.exists(_PQ_DB):
        os.remove(_PQ_DB)
    from app.core.database import Base, engine
    from app.seed import seed

    Base.metadata.create_all(engine)
    seed()
    yield
    engine.dispose()


@pytest.fixture()
def client():
    from fastapi.testclient import TestClient
    from app.main import app

    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture()
def login(client):
    def _login(email: str, senha: str = "qadras123") -> dict:
        r = client.post("/api/auth/login", json={"email": email, "senha": senha})
        assert r.status_code == 200, r.text
        data = r.json()
        return {"Authorization": f"Bearer {data['token']}"}

    return _login


@pytest.fixture()
def db_session():
    """Sessao direta no banco de teste.

    Existe para os testes que precisam olhar o DOMINIO, e nao a resposta HTTP —
    por exemplo conferir que uma preferencia salva pela API de fato governa o
    envio de push. Pelo cliente HTTP isso nao da para ver: o push nao aparece
    em resposta nenhuma.
    """
    from app.core.database import SessionLocal

    sessao = SessionLocal()
    try:
        yield sessao
    finally:
        sessao.close()
