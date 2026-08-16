# Qadras API — imagem usada pelo EasyPanel (build context = raiz do repo)
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    TZ=America/Sao_Paulo

# tzdata garante America/Sao_Paulo dentro do container (datetime/pendente).
# curl para HEALTHCHECK.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tzdata curl \
    && rm -rf /var/lib/apt/lists/*

# Usuario nao-root por seguranca.
RUN useradd -m -r -s /bin/bash appuser

WORKDIR /app/backend

COPY backend/requirements.txt ./requirements.txt
RUN pip install --upgrade pip && pip install -r ./requirements.txt

# Codigo do backend + frontend principal (servido pelo /api na Fase 1).
# Os apps www-usuario / www-gerente / www-admin entram como apps separados
# no EasyPanel nas fases de frontend.
COPY backend/ ./
COPY www/ /app/www/

# Permissoes para o usuario nao-root.
RUN chown -R appuser:appuser /app

USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8000/api/health/ready || exit 1

CMD ["./docker-entrypoint.sh"]
