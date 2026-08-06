"""Provedor mock de pagamento — Fase 5.

Gera um Pix "copia-e-cola" fake (so para demonstracao) e confia no webhook.
A auto-confirmacao (tarefa Celery) usa `auto_result()` para simular o
callback do provedor alguns segundos depois da criacao.
"""
import json
import uuid

from ...core.config import settings
from ...core.timezone import now_local
from .base import PaymentIntent, PaymentProvider, WebhookResult
from datetime import timedelta

_FALLBACK_QR = "https://qadras.app/pix/mock.png"


def _copia_e_cola(provider_ref: str, amount_cents: int) -> str:
    """Pix EMV 000201 fake — apenas demo (nao e um Pix real)."""
    body = (
        "00020126580014BR.GOV.BCB.PIX0136"
        + provider_ref.lower().replace("-", "")
        + "520400005303986"
        + f"540{amount_cents // 100}00"
        + "5802BR5913QADRAS DEMO6009SAO PAULO62070503***6304"
        + ("A1B2" if amount_cents % 2 == 0 else "C3D4")
    )
    return body


class MockProvider(PaymentProvider):
    name = "mock"

    def create_payment(self, *, booking, amounts: dict) -> PaymentIntent:
        provider_ref = f"MOCK-{uuid.uuid4().hex[:12]}"
        expires_at = now_local() + timedelta(
            minutes=settings.booking_payment_expire_minutes
        )
        return PaymentIntent(
            provider=self.name,
            method=booking.payment_method or "pix",
            provider_ref=provider_ref,
            amount_cents=amounts["total_cents"],
            qr_code=_copia_e_cola(provider_ref, amounts["total_cents"]),
            qr_code_image=_FALLBACK_QR,
            expires_at=expires_at,
        )

    def parse_webhook(self, headers, body: bytes) -> WebhookResult | None:
        if not body:
            return None
        try:
            data = json.loads(body)
        except ValueError:
            return None
        webhook_id = data.get("webhookId")
        if not webhook_id:
            return None
        return WebhookResult(
            webhook_id=str(webhook_id),
            status=data.get("status", "confirmed"),
            provider_ref=data.get("paymentRef"),
            amount_cents=data.get("amountCents"),
            payload=data,
        )

    def auto_result(self, payment) -> WebhookResult:
        """Resultado fake para a auto-confirmacao (simula callback real)."""
        return WebhookResult(
            webhook_id=f"mock-auto-{payment.provider_ref}",
            status="confirmed",
            provider_ref=payment.provider_ref,
            amount_cents=payment.amount_cents,
            payload={"auto": True},
        )
