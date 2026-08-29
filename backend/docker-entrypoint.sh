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

# --- Migracoes, com paciencia --------------------------------------------
#
# Dois containers subindo juntos rodam `alembic upgrade head` ao MESMO TEMPO e
# disputam o lock da tabela no Postgres. Com `set -e`, quem perde morre — e o
# orquestrador reinicia, os dois colidem de novo, e o laco se alimenta sozinho:
# CPU no talo, 502 constante, e nenhum traceback no log, porque o alembic so
# devolve um codigo de saida.
#
# Tentar de novo quebra o ciclo: quem perdeu espera, e na segunda volta a
# migracao do outro ja terminou (alembic e idempotente, entao repetir e
# inofensivo).
echo "==> rodando migracoes (alembic upgrade head)"
_migrou=0
for _tentativa in 1 2 3 4 5; do
  if alembic upgrade head; then
    _migrou=1
    break
  fi
  echo "    migracao falhou (tentativa $_tentativa/5) — outro container pode estar migrando; nova tentativa em 10s"
  sleep 10
done
if [ "$_migrou" != "1" ]; then
  echo "    ERRO: migracoes nao concluiram apos 5 tentativas." >&2
  exit 1
fi

# --- Seed: NAO derruba a API ---------------------------------------------
#
# Em producao o banco ja esta semeado e o seed nao tem nada a fazer. Deixar uma
# falha aqui abortar o boot troca "faltou um dado de demonstracao" por "a API
# inteira fora do ar" — e com `set -e` era exatamente isso.
#
# O erro aparece em maiusculas no log; quem esta subindo pela PRIMEIRA vez ve
# na hora que o banco ficou vazio.
echo "==> seed (somente se tabelas vazias)"
if ! python -m app.seed; then
  echo "    ATENCAO: o seed falhou. A API sobe assim mesmo — se este for o" >&2
  echo "    primeiro boot, o banco ficou VAZIO e precisa ser semeado a mao." >&2
fi

echo "==> subindo API na porta 8000"
WORKERS="${UVICORN_WORKERS:-2}"
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers "$WORKERS"
