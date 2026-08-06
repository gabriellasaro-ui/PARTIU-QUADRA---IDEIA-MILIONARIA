"""Webhook de pagamento + consulta do intent (Fase 5).

Rotas:
  POST /api/payments/webhook/{provider} — callback do provedor (sem auth;
       idempotente via webhook_id). Usado pelo mock e pelo teste manual.
  GET  /api/payments/{id} — intent/status do pagamento (dono ou admin).

O provedor real (Asaas/etc.) entra trocando o adapter em services/payments,
sem mudar o dominio aqui.
"""
from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from ..auth.deps import get_current_user
from ..core.database import get_db
from ..models import User
from ..services import bookings as svc
from ..services.payments import get_provider

router = APIRouter(prefix="/api/payments", tags=["payments"])


@router.post("/webhook/{provider}")
async def webhook_pagamento(
    provider: str,
    request: Request,
    db: Session = Depends(get_db),
):
    body = await request.body()
    prov = get_provider(provider)
    result = prov.parse_webhook(dict(request.headers), body)
    if result is None:
        return {"ok": False, "ignored": True}
    payment, replay = svc.confirm_payment(
        db,
        webhook_id=result.webhook_id,
        status=result.status,
        provider_ref=result.provider_ref,
        amount_cents=result.amount_cents,
        payload=result.payload,
    )
    return {"ok": True, "replay": replay, "status": payment.status}


@router.get("/{pid}")
def detalhe_pagamento(
    pid: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    payment = svc.get_payment_record(db, user, pid)
    return {"payment": svc.serialize_payment(payment)}
