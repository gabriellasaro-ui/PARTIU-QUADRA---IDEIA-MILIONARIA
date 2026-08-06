"""Contrato do provider de push — independe do provedor concreto (FCM hoje)."""
from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class PushResult:
    """Resultado de uma tentativa de entrega a um dispositivo."""
    provider: str
    token: str
    ok: bool = True
    error: str | None = None


class PushProvider(ABC):
    """Interface para MockPushProvider (agora) e provedores reais (futuro)."""

    name: str = "base"

    @abstractmethod
    def send(self, *, token: str, title: str, body: str, data: dict | None) -> PushResult:
        """Envia a notificacao ao dispositivo e devolve o resultado."""
