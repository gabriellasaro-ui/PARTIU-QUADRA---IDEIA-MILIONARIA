#!/usr/bin/env sh
# Entrypoint do container: espera DB -> migra -> seed (se vazio) -> uvicorn.
# Alembic upgrade e idempotente; o seed nunca duplica dados em redeploys.
set -e

# --- Espera o Postgres ficar pronto (max 30s) ------------------------------
echo "==> aguardando PostgreSQL..."
python -c "
import os, sys, time
from sqlalchemy import create_engine, text
url = os.environ.get('DATABASE_URL', '')
if not url:
    sys.exit(0)
engine = create_engine(url)
for i in range(30):
    try:
        with engine.connect() as conn:
            conn.execute(text('SELECT 1'))
        print('    PostgreSQL pronto.')
        sys.exit(0)
    except Exception:
        time.sleep(1)
print('    ERRO: PostgreSQL indisponivel apos 30s.', file=sys.stderr)
sys.exit(1)
"

echo "==> rodando migracoes (alembic upgrade head)"
alembic upgrade head

echo "==> seed (somente se tabelas vazias)"
python -m app.seed

echo "==> subindo API na porta 8000"
WORKERS="${UVICORN_WORKERS:-2}"
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers "$WORKERS"
