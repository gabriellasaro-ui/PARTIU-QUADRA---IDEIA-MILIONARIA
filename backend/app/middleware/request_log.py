"""Request log + request-id (Fase 12).

Loga cada request com: method, path, status, duracao (ms), client_ip e
user_id (best-effort a partir do Bearer token). Injeta/sete X-Request-Id na
resposta para rastreabilidade. Nao quebra o request se o log falhar.
"""
import logging
import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

logger = logging.getLogger("app.http")


def _decode_user_id(authorization: str | None) -> str | None:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    try:
        from ..auth.security import decode_token

        payload = decode_token(authorization.split(" ", 1)[1].strip())
        return payload.get("sub")
    except Exception:
        return None


class RequestLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        start = time.perf_counter()
        request_id = request.headers.get("X-Request-Id") or uuid.uuid4().hex[:16]
        user_id = _decode_user_id(request.headers.get("Authorization"))
        client_ip = request.client.host if request.client else None

        status_code = 500
        error = None
        try:
            response = await call_next(request)
            status_code = response.status_code
            response.headers.setdefault("X-Request-Id", request_id)
            return response
        except Exception as exc:  # noqa: BLE001 — nao deixar o log derrubar a app
            error = str(exc)
            raise
        finally:
            duration_ms = round((time.perf_counter() - start) * 1000, 2)
            try:
                logger.info(
                    "http request",
                    extra={
                        "extra_fields": {
                            "request_id": request_id,
                            "method": request.method,
                            "path": request.url.path,
                            "status": status_code,
                            "duration_ms": duration_ms,
                            "client_ip": client_ip,
                            "user_id": user_id or "-",
                            "error": error or "",
                        }
                    },
                )
            except Exception:  # noqa: BLE001 — log nunca derruba o request
                pass
