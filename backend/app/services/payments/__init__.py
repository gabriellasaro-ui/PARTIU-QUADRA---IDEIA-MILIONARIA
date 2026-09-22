"""Adapter de provedor de pagamento (plugavel).

`get_provider()` devolve o provedor configurado em settings.payment_provider
("mercadopago" em producao; "mock" so em desenvolvimento, e Settings recusa
o boot com ele fora de dev).
"""
from functools import lru_cache

from fastapi import HTTPException, status

from ...core.config import settings
from .base import PaymentIntent, PaymentProvider, WebhookResult
from .mercadopago import MercadoPagoProvider
from .mock import MockProvider

_REGISTRY: dict[str, type[PaymentProvider]] = {
    "mercadopago": MercadoPagoProvider,
    # Mantido para desenvolvimento sem chave de adquirente. Nao chega a
    # producao: a guarda em Settings recusa o boot com mock fora de dev.
    "mock": MockProvider,
}


@lru_cache(maxsize=4)
def get_provider(name: str | None = None) -> PaymentProvider:
    provider_name = (name or settings.payment_provider).lower()
    cls = _REGISTRY.get(provider_name)
    if not cls:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Provedor de pagamento não configurado: {provider_name}",
        )
    return cls()


def provider_para_conexao(conexao) -> PaymentProvider:
    """Provider que cobra na conta DAQUELA arena (split 1:1).

    SEM cache, ao contrario de `get_provider`: o token e por vendedor e muda a
    cada renovacao. Um `lru_cache` aqui continuaria servindo o token velho
    depois do refresh, e o sintoma seria 401 intermitente numa arena so.
    """
    return MercadoPagoProvider(access_token=conexao.access_token)


__all__ = [
    "get_provider",
    "provider_para_conexao",
    "PaymentIntent",
    "PaymentProvider",
    "WebhookResult",
]
