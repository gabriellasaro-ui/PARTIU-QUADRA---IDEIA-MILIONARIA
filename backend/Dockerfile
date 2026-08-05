# Qadras API — imagem usada pelo EasyPanel (build context = raiz do repo)
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    TZ=America/Sao_Paulo

# tzdata garante America/Sao_Paulo dentro do container (datetime/pendente).
RUN apt-get update \
    && apt-get install -y --no-install-recommends tzdata \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend

COPY backend/requirements.txt ./requirements.txt
RUN pip install --upgrade pip && pip install -r ./requirements.txt

# Codigo do backend + frontend principal (servido pelo /api na Fase 1).
# Os apps www-usuario / www-gerente / www-admin entram como apps separados
# no EasyPanel nas fases de frontend.
COPY backend/ ./
COPY www/ /app/www/

RUN chmod +x ./docker-entrypoint.sh

EXPOSE 8000

CMD ["./docker-entrypoint.sh"]
