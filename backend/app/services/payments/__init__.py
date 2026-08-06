"""Adapter de provedor de pagamento (plugavel).

`get_provider()` devolve o provedor configurado em settings.payment_provider
("mock" por padrao; "asaas" entra no futuro sem reescrever o dominio).
"""
from functools import lru_cache

from fastapi import HTTPException, status

from ...core.config import settings
from .base import PaymentIntent, PaymentProvider, WebhookResult
from .mock import MockProvider

_REGISTRY: dict[str, type[PaymentProvider]] = {"mock": MockProvider}


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


__all__ = ["get_provider", "PaymentIntent", "PaymentProvider", "WebhookResult"]
