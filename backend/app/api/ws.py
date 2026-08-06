"""WebSocket autenticado — WS /ws?token=<access_token>.

Eventos entregues: `message.new` (conversa atualizada) e `booking.updated`
(reserva mudou de estado). O cliente pode ficar em silencio; a desconexao e
detectada pelo receive loop. Token invalido/blacklistado fecha com 1008.
"""
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from ..auth.deps import authenticate_ws
from ..core.database import get_db
from ..core.ws import manager

router = APIRouter()


@router.websocket("/ws")
async def ws_endpoint(websocket: WebSocket, token: str = Query("")):
    db = next(get_db())
    try:
        user = authenticate_ws(token, db)
        if user is None:
            await websocket.close(code=1008)
            return
        await websocket.accept()
        conn = manager.register(str(user.id), websocket)
        try:
            while True:
                msg = await websocket.receive()
                if msg["type"] == "websocket.disconnect":
                    break
        except WebSocketDisconnect:
            pass
        finally:
            manager.disconnect(conn)
    finally:
        db.close()
