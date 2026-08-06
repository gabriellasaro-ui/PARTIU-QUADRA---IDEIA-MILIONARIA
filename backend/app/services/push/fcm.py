"""Provider FCM real — Fase 7 (import lazy).

So e instanciado quando settings.fcm_credentials_path aponta para o service
account JSON do Firebase (igual ao login Google: vazio => 503). O import de
firebase-admin acontece apenas aqui, por isso o provider mock nao exige o
pacote instalado para rodar.
"""
from ...core.config import settings
from .base import PushProvider, PushResult


class FcmPushProvider(PushProvider):
    name = "fcm"

    def __init__(self) -> None:
        if not settings.fcm_credentials_path:
            raise RuntimeError(
                "FCM nao configurado: defina FCM_CREDENTIALS_PATH "
                "(service account JSON do Firebase)."
            )
        # Import lazy: o pacote firebase-admin so e carregado quando o FCM
        # e realmente usado (producao). Mock/desenvolvimento nao o importam.
        import firebase_admin
        from firebase_admin import credentials, messaging

        self._messaging = messaging
        app_name = "qadras-fcm"
        try:
            self._app = firebase_admin.get_app(app_name)
        except ValueError:
            self._app = firebase_admin.initialize_app(
                credentials.Certificate(settings.fcm_credentials_path),
                name=app_name,
            )
        if settings.fcm_project_id:
            self._app.project_id = settings.fcm_project_id

    def send(self, *, token: str, title: str, body: str, data: dict | None) -> PushResult:
        try:
            message = self._messaging.Message(
                notification=self._messaging.Notification(title=title, body=body),
                data=data or {},
                token=token,
            )
            self._messaging.send(message, app=self._app)
            return PushResult(provider=self.name, token=token, ok=True)
        except Exception as exc:  # noqa: BLE001 — auditoria registra qualquer falha
            return PushResult(provider=self.name, token=token, ok=False, error=str(exc))
