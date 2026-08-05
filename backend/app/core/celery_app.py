"""Celery — fila de tarefas assincronas e agendamento (beat).

Broker e backend usam Redis. As tarefas ficam em app.workers.tasks e o
agendamento (expirar sessoes, concluir reservas, gerar repasses, push FCM)
e preenchido conforme as fases avancam.
"""
from celery import Celery

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
        # Fase 4 (reservas): expirar cotacoes/slots pending_payment nao pagos.
        # "expirar-sessoes": {
        #     "task": "app.workers.tasks.expirar_sessoes",
        #     "schedule": 60.0,
        # },
    },
)
