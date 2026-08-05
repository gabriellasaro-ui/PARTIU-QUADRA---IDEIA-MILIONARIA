"""Tarefas assincronas do Celery.

A Fase 1 registra apenas uma tarefa de saude para provar o wiring. As
tarefas reais (push FCM, expiracao de sessoes, repasses, webhooks) entram
nas fases seguintes junto com o agendamento em app/core/celery_app.py.
"""
from ..core.celery_app import celery_app


@celery_app.task(name="app.workers.tasks.ping")
def ping() -> str:
    return "pong"
