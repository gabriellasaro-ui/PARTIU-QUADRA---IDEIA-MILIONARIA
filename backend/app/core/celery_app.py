"""Celery — fila de tarefas assincronas e agendamento (beat).

Broker e backend usam Redis. As tarefas ficam em app.workers.tasks e o
agendamento (expirar sessoes, concluir reservas, gerar repasses, push FCM)
e preenchido conforme as fases avancam.
"""
from celery import Celery
from celery.schedules import crontab

from .config import settings

celery_app = Celery(
    "qadras",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["app.workers.tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone=settings.timezone,
    enable_utc=True,
    broker_connection_retry_on_startup=True,
    beat_schedule={
        # Fase 4 (reservas): expirar cotacoes/slots nao pagos ou nao aprovados
        # e concluir reservas confirmadas apos o horario.
        "expirar-reservas": {
            "task": "app.workers.tasks.expirar_reservas",
            "schedule": 60.0,
        },
        "concluir-reservas": {
            "task": "app.workers.tasks.concluir_reservas",
            "schedule": 300.0,
        },
        # Fase 5 (pagamentos): auto-confirma intents Pix mock poucos segundos
        # apos a criacao, simulando o webhook do provedor.
        "confirmar-pagamentos-pendentes": {
            "task": "app.workers.tasks.confirmar_pagamentos_pendentes",
            "schedule": 10.0,
        },
        # Fase 8 (gerente): segunda-feira 03:00 grava os repasses da semana
        # anterior por arena (settlements pending).
        "gerar-settlements-semanais": {
            "task": "app.workers.tasks.gerar_settlements_semanais",
            "schedule": crontab(day_of_week=0, hour=3, minute=0),
        },
    },
)
