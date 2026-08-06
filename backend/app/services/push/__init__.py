"""Adapter de provider de push (plugavel) — Fase 7.

`get_push_provider()` devolve o provider de settings.push_provider:
- "mock" (padrao): simula entrega, sem rede, exige so o SQLite/Postgres.
- "fcm": real, somente se FCM_CREDENTIALS_PATH estiver configurado; senao
  responde 503 (mesmo comportamento do login Google sem GOOGLE_CLIENT_ID).
"""
from functools import lru_cache

from fastapi import HTTPException, status

from ...core.config import settings
from .base import PushProvider, PushResult
from .mock import MockPushProvider


@lru_cache(maxsize=4)
def get_push_provider(name: str | None = None) -> PushProvider:
    provider_name = (name or settings.push_provider).lower()
    if provider_name == "mock":
        return MockPushProvider()
    if provider_name == "fcm":
        if not settings.fcm_credentials_path:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Push FCM não configurado (defina FCM_CREDENTIALS_PATH).",
            )
        from .fcm import FcmPushProvider

        return FcmPushProvider()
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail=f"Provedor de push não configurado: {provider_name}",
    )


__all__ = ["get_push_provider", "PushProvider", "PushResult"]
