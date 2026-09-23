"""Webhook de pagamento + consulta do intent (Fase 5).

Rotas:
  POST /api/payments/webhook/{provider} — callback do provedor (sem auth;
       idempotente via webhook_id). Usado pelo mock e pelo teste manual.
  GET  /api/payments/{id} — intent/status do pagamento (dono ou admin).

O provedor real (Mercado Pago) entra trocando o adapter em services/payments,
sem mudar o dominio aqui.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from ..auth.deps import get_current_user
from ..core.database import get_db
from ..models import PAYMENT_PENDING, Booking, User
from ..services import bookings as svc
from ..core.config import settings
from ..services.payments import get_provider
from ..services.payments.mercadopago import MercadoPagoError, MercadoPagoProvider

logger = logging.getLogger(__name__)

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


@router.post("/{pid}/sincronizar")
def sincronizar_pagamento(
    pid: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Pergunta ao provedor o estado real e concilia. A rede de seguranca.

    POR QUE ISTO EXISTE: o webhook e a unica coisa que move uma reserva de
    `pending_payment` para paga, e webhook falha — rede, deploy no instante
    errado, `notification_url` esquecida no ambiente. Quando falha, o dinheiro
    entrou e a reserva morre esperando, ate expirar. O jogador pagou e perdeu
    a quadra, e a unica saida era mexer no banco a mao.

    Aqui quem pergunta somos nos, entao nao depende de o provedor conseguir
    nos alcancar. Idempotente pela mesma chave do webhook (`confirm_payment`):
    chamar duas vezes nao confirma duas vezes, e se o webhook chegar depois,
    ele vira replay silencioso.

    Autorizacao: dono do pagamento ou admin — a mesma da consulta. O jogador
    que pagou e quem mais quer destravar, e faz sentido que consiga.
    """
    payment = svc.get_payment_record(db, user, pid)
    if payment.status != PAYMENT_PENDING:
        return {"ok": True, "mudou": False, "status": payment.status}
    if not payment.provider_ref:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Pagamento sem referencia no provedor; nada a consultar",
        )

    prov = get_provider(payment.provider)
    if not isinstance(prov, MercadoPagoProvider):
        # O mock se confirma sozinho pela task; nao ha o que conciliar.
        return {"ok": True, "mudou": False, "status": payment.status}

    # No split, quem consulta precisa ser o token da arena que cobrou.
    if settings.mercadopago_split_enabled:
        prov = svc.provider_do_pagamento(db, payment.provider_ref) or prov

    try:
        resultado = prov.consultar_status(payment.provider_ref)
    except MercadoPagoError as erro:
        logger.warning("sincronizacao falhou pagamento=%s: %s", pid, erro)
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(erro))

    if resultado is None:
        # Ainda pendente do lado do provedor: nada mudou, e isso nao e erro.
        return {"ok": True, "mudou": False, "status": payment.status}

    atualizado, replay = svc.confirm_payment(
        db,
        webhook_id=resultado.webhook_id,
        status=resultado.status,
        provider_ref=resultado.provider_ref,
        amount_cents=resultado.amount_cents,
        payload=resultado.payload,
    )
    return {
        "ok": True,
        "mudou": not replay,
        "status": atualizado.status,
        "reserva": svc.serialize(db, db.get(Booking, atualizado.booking_id)),
    }


@router.get("/{pid}")
def detalhe_pagamento(
    pid: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    payment = svc.get_payment_record(db, user, pid)
    return {"payment": svc.serialize_payment(payment)}
