"""Webhook de pagamento + consulta do intent (Fase 5).

Rotas:
  POST /api/payments/webhook/{provider} — callback do provedor (sem auth;
       idempotente via webhook_id). Usado pelo mock e pelo teste manual.
  GET  /api/payments/{id} — intent/status do pagamento (dono ou admin).

O provedor real (Mercado Pago) entra trocando o adapter em services/payments,
sem mudar o dominio aqui.
"""
from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from ..auth.deps import get_current_user
from ..core.database import get_db
from ..models import User
from ..services import bookings as svc
from ..core.config import settings
from ..services.payments import get_provider
from ..services.payments.mercadopago import MercadoPagoProvider

router = APIRouter(prefix="/api/payments", tags=["payments"])


@router.post("/webhook/{provider}")
async def webhook_pagamento(
    provider: str,
    request: Request,
    db: Session = Depends(get_db),
):
    body = await request.body()
    prov = get_provider(provider)
    # A query vai junto: o Mercado Pago assina um manifesto montado com o
    # data.id que chega NA URL, e sem ele nao da para conferir a assinatura.
    cabecalhos = dict(request.headers)
    query = dict(request.query_params)

    if settings.mercadopago_split_enabled and isinstance(prov, MercadoPagoProvider):
        # NO SPLIT A CONSULTA PRECISA DO TOKEN DA ARENA.
        #
        # Por isso o webhook vira duas etapas: primeiro confere a assinatura e
        # extrai o id (sem chamar a API), depois descobre de quem e o pagamento
        # e so entao pergunta o status com o token de quem cobrou.
        ident = prov.extrair_id_verificado(cabecalhos, body, query)
        if ident is None:
            return {"ok": False, "ignored": True}
        # Sem conexao encontrada, cai no token global: e o caso de pagamento
        # antigo, criado antes de a arena conectar.
        prov = svc.provider_do_pagamento(db, ident) or prov
        result = prov.consultar_status(ident)
    else:
        result = prov.parse_webhook(cabecalhos, body, query)
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
