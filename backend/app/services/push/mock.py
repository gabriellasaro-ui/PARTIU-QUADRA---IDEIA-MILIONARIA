"""Provider mock de push — Fase 7.

Simula a entrega sem tocar na rede. A auditoria em `push_logs` e gravada
pela task Celery `enviar_notificacao_push` (mesma para mock e FCM real);
aqui so devolvemos um resultado "ok" para o fluxo seguir.
"""
from .base import PushProvider, PushResult


class MockPushProvider(PushProvider):
    name = "mock"

    def send(self, *, token: str, title: str, body: str, data: dict | None) -> PushResult:
        return PushResult(provider=self.name, token=token, ok=True)
