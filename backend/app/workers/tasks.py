"""Tarefas assincronas do Celery.

A Fase 1 registra apenas uma tarefa de saude para provar o wiring. A Fase 4
adiciona as tarefas de expiracao e conclusao de reservas; push FCM, repasses
e webhooks entram nas fases seguintes.
"""
from ..core.celery_app import celery_app
from ..core.config import settings
from ..core.database import SessionLocal
from ..models import PUSH_STATUS_ERRORED, PUSH_STATUS_OK
from ..repositories import notifications as notif_repo
from ..services import bookings as bookings_svc
from ..services import mock_autoconfirm
from ..services.push import get_push_provider


@celery_app.task(name="app.workers.tasks.ping")
def ping() -> str:
    return "pong"


@celery_app.task(name="app.workers.tasks.expirar_reservas")
def expirar_reservas() -> dict:
    """Move para `expired` reservas cujo prazo de pagamento/aprovacao venceu."""
    with SessionLocal() as db:
        count = bookings_svc.expire_stale(db)
    return {"expiradas": count}


@celery_app.task(name="app.workers.tasks.concluir_reservas")
def concluir_reservas() -> dict:
    """Confirmadas com horario encerrado -> completed."""
    with SessionLocal() as db:
        count = bookings_svc.complete_finished(db)
    return {"concluidas": count}


@celery_app.task(name="app.workers.tasks.confirmar_pagamentos_pendentes")
def confirmar_pagamentos_pendentes() -> dict:
    """Fase 5: simula o webhook do provedor para intents mock pendentes.

    Depois de `payment_mock_confirm_seconds`, o pagamento mock e confirmado
    (como se o Pix tivesse sido pago) — assim o fluxo de ponta a ponta
    funciona sem um provedor real.

    A logica vive em services/mock_autoconfirm porque o servidor tambem
    precisa dela: em desenvolvimento nao ha worker de pe, e sem ninguem
    confirmando a reserva ficava presa em "Aguardando pagamento".
    """
    with SessionLocal() as db:
        return {"confirmados": mock_autoconfirm.confirmar_pendentes(db)}


@celery_app.task(name="app.workers.tasks.encerrar_chats_vencidos")
def encerrar_chats_vencidos() -> dict:
    """Fecha o atendimento cuja reserva ja acabou.

    O fechamento manual sozinho nao basta: gerente ocupado nao fecha conversa
    nenhuma, e o canal fica aberto para sempre.
    """
    from ..services import messages as messages_svc

    with SessionLocal() as db:
        return {"encerrados": messages_svc.encerrar_vencidas(db)}


@celery_app.task(name="app.workers.tasks.convocar_faltantes")
def convocar_faltantes() -> dict:
    """Fase 21: chama quem nao respondeu quando falta gente para a pelada.

    E o que fecha o ciclo do clube — o grupo existe para a pelada nao ficar
    vazia, e ate aqui ninguem era lembrado de confirmar.
    """
    from ..services import peladas as peladas_svc

    with SessionLocal() as db:
        return {"convocadas": peladas_svc.convocar_faltantes(db)}


@celery_app.task(name="app.workers.tasks.enviar_notificacao_push")
def enviar_notificacao_push(
    user_id,
    notification_id=None,
    type: str = "",
    title: str = "",
    body: str = "",
    data: dict | None = None,
) -> dict:
    """Fase 7: entrega push de uma notificacao aos dispositivos do usuario.

    O provider vem de settings.push_provider: "mock" grava em push_logs sem
    tocar a rede; "fcm" envia de verdade (requer FCM_CREDENTIALS_PATH). Cada
    tentativa gera uma linha em push_logs (auditoria).
    """
    with SessionLocal() as db:
        devices = notif_repo.list_devices(db, user_id)
        provider = get_push_provider()
        enviados = 0
        for device in devices:
            result = provider.send(
                token=device.fcm_token, title=title, body=body, data=data or {}
            )
            notif_repo.add_push_log(
                db,
                user_id=user_id,
                notification_id=notification_id,
                provider=result.provider,
                status=PUSH_STATUS_OK if result.ok else PUSH_STATUS_ERRORED,
                error=result.error,
            )
            if result.ok:
                enviados += 1
        db.commit()
    return {"destinatario": user_id, "dispositivos": len(devices), "enviados": enviados}


@celery_app.task(name="app.workers.tasks.gerar_settlements_semanais")
def gerar_settlements_semanais() -> dict:
    """Fase 8: grava um settlement `pending` por arena (semana anterior).

    Roda uma vez por semana (beat). Nunca duplica: o repositorio verifica se
    ja existe settlement para arena+period_start antes de inserir.
    """
    from ..services import gerente as gerente_svc

    with SessionLocal() as db:
        created = gerente_svc.generate_settlements(db)
    return {"criados": created}
