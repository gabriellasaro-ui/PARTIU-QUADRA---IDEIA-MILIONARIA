#!/usr/bin/env sh
# Entrypoint do container: migra -> seed (se vazio) -> uvicorn.
# Alembic upgrade e idempotente; o seed nunca duplica dados em redeploys.
set -e

echo "==> rodando migracoes (alembic upgrade head)"
alembic upgrade head

echo "==> seed (somente se tabelas vazias)"
python -m app.seed

echo "==> subindo API na porta 8000"
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
