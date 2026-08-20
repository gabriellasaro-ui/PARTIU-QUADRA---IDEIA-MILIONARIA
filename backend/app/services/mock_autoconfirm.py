"""Auto-confirmacao dos pagamentos do provedor mock.

Por que isto existe fora do Celery
----------------------------------
Pix de verdade e confirmado por webhook do adquirente. Com o provedor `mock`
nao existe adquirente, entao alguem precisa fazer o papel dele. A tarefa
`confirmar_pagamentos_pendentes` do Celery ja fazia isso — mas so roda se
houver Redis e um worker de pe, o que em desenvolvimento quase nunca ha.

Sem ninguem confirmando, a reserva ficava parada em "Aguardando pagamento"
para sempre: o gerente nunca via o pedido. O front tapava o buraco postando
`/api/payments/webhook/mock` do proprio navegador. Isso e um callback forjado
pelo cliente — e parou de funcionar no instante em que PAYMENT_WEBHOOK_SECRET
entrou no .env, silenciosamente, porque o endpoint responde 200 com
`{"ok": false, "ignored": true}` em vez de erro.

A logica agora mora aqui, e uma so: a tarefa do Celery chama esta funcao, e o
servidor tambem a chama em intervalos quando esta rodando com o mock. O
navegador nao confirma pagamento nenhum.

Producao nunca chega aqui: Settings recusa o boot com PAYMENT_PROVIDER=mock.
"""
from datetime import timedelta

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..core.config import settings
from ..core.timezone import utc_now
from ..repositories import payments as pay_repo
from . import bookings as bookings_svc
from .payments import get_provider


def confirmar_pendentes(db: Session) -> int:
    """Confirma os intents mock que ja passaram do tempo de espera.

    Devolve quantos foram confirmados. Erros de um pagamento nao derrubam os
    outros: `confirm_payment` levanta HTTPException para caso ja confirmado ou
    valor divergente, e ai o certo e seguir para o proximo.
    """
    cutoff = (
        utc_now() - timedelta(seconds=settings.payment_mock_confirm_seconds)
    ).replace(tzinfo=None)

    confirmados = 0
    for payment in pay_repo.list_pending_mock(db, cutoff):
        provider = get_provider(payment.provider)
        resultado = provider.auto_result(payment)
        try:
            bookings_svc.confirm_payment(
                db,
                webhook_id=resultado.webhook_id,
                status=resultado.status,
                provider_ref=resultado.provider_ref,
                # Obrigatorio desde a conferencia de valor em confirm_payment;
                # `auto_result` devolve o valor cobrado.
                amount_cents=resultado.amount_cents,
                payload=resultado.payload,
            )
            confirmados += 1
        except HTTPException:
            continue
    return confirmados
