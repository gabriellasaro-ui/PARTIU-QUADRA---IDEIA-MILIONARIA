"""Contrato do provider de pagamento — independe do provedor concreto."""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class PaymentIntent:
    """Intent criado no provedor (Pix/cartao). Devolvido ao cliente."""
    provider: str
    method: str
    provider_ref: str
    status: str = "pending"
    amount_cents: int = 0
    qr_code: str | None = None
    qr_code_image: str | None = None
    expires_at: datetime | None = None
    payload: dict = field(default_factory=dict)


@dataclass
class WebhookResult:
    """Decodificado do callback do provedor."""
    webhook_id: str
    status: str  # confirmed | failed
    provider_ref: str | None = None
    amount_cents: int | None = None
    payload: dict = field(default_factory=dict)


class PaymentProvider(ABC):
    """Interface para MercadoPagoProvider (producao) e MockProvider (dev)."""

    name: str = "base"

    @abstractmethod
    def create_payment(self, *, booking, amounts: dict) -> PaymentIntent:
        """Cria o intent de cobranca e devolve o que o cliente precisa exibir."""

    @abstractmethod
    def parse_webhook(self, headers, body: bytes, query=None) -> WebhookResult | None:
        """Valida assinatura/payload e devolve o resultado do pagamento.

        Devolve None quando o payload nao e reconhecido (nao e um evento
        de pagamento deste provedor), e tambem quando a assinatura nao
        confere: a rota responde 200/ignored e nada se move.

        `query` sao os parametros da URL do callback. O Mercado Pago assina um
        manifesto montado com o `data.id` que vem NA QUERY, entao sem ele a
        assinatura nao pode ser conferida. Opcional porque nem todo provedor
        precisa.
        """

    def refund(self, payment) -> bool:
        """Estorno mock: sem acao. Provedores reais implementam a chamada."""
        return True
