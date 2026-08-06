"""WebSocket — ConnectionManager com fanout local + Redis pub/sub (Fase 6).

Multi-worker seguro: `publish()` entrega localmente (fila por conexao no loop
do processo) e publica no canal Redis; um thread subscritor re-distribui
eventos vindos de outros workers (marca worker_id para nao devolver o proprio
evento). Sem Redis no ar: fail-open, entrega so local.

O endpoint /ws autentica por token e registra a conexao; eventos sao
pulicados pelos servicos (message.new, booking.updated) via `publish_user_event`.
"""
import asyncio
import itertools
import json
import logging
import threading
import uuid

from ..core.redis import redis_client

logger = logging.getLogger(__name__)

_WS_CHANNEL = "qadras:ws"


class _Conn:
    __slots__ = ("cid", "queue", "loop", "task", "ws")
    _ids = itertools.count(1)

    def __init__(self, queue, loop, ws):
        self.cid = next(self._ids)
        self.queue = queue
        self.loop = loop
        self.task = None
        self.ws = ws


class ConnectionManager:
    """Registro de conexoes por user_id com entrega thread-safe."""

    def __init__(self):
        self._registry: dict[str, dict[int, _Conn]] = {}
        self.worker_id = uuid.uuid4().hex
        self._sub_thread: threading.Thread | None = None
        self._sub_active = False
        self._lock = threading.Lock()

    # --- registro ---------------------------------------------------------

    def register(self, user_id: str, ws) -> _Conn:
        loop = asyncio.get_running_loop()
        conn = _Conn(asyncio.Queue(), loop, ws)
        conn.task = asyncio.ensure_future(self._sender(conn))
        with self._lock:
            self._registry.setdefault(user_id, {})[conn.cid] = conn
        return conn

    async def _sender(self, conn: _Conn) -> None:
        try:
            while True:
                event = await conn.queue.get()
                await conn.ws.send_json(event)
        except Exception:
            self.disconnect(conn)

    def disconnect(self, conn: _Conn) -> None:
        with self._lock:
            for uid, by_id in list(self._registry.items()):
                if conn.cid in by_id:
                    del by_id[conn.cid]
                    if not by_id:
                        del self._registry[uid]
                    break
        if conn.task and not conn.task.done():
            conn.task.cancel()

    # --- publicacao ---------------------------------------------------------

    def publish(self, user_id, event: dict) -> None:
        self._publish_local(user_id, event)
        if self._sub_active:
            self._publish_redis(user_id, event)

    def _publish_local(self, user_id, event: dict) -> None:
        with self._lock:
            conns = list(self._registry.get(str(user_id), {}).values())
        for conn in conns:
            conn.loop.call_soon_threadsafe(conn.queue.put_nowait, event)

    def _publish_redis(self, user_id, event: dict) -> None:
        try:
            redis_client.publish(
                _WS_CHANNEL,
                json.dumps(
                    {
                        "worker_id": self.worker_id,
                        "user_id": str(user_id),
                        "event": event,
                    },
                    ensure_ascii=False,
                ),
            )
        except Exception:
            logger.debug("redis pub/sub indisponivel (fail-open)", exc_info=True)

    # --- subscritor (outros workers) ----------------------------------------

    def start_subscriber(self) -> None:
        if self._sub_thread is not None and self._sub_thread.is_alive():
            return

        def _run() -> None:
            try:
                ps = redis_client.pubsub()
                ps.subscribe(_WS_CHANNEL)
                self._sub_active = True
                for msg in ps.listen():
                    if msg.get("type") != "message":
                        continue
                    try:
                        data = json.loads(msg["data"])
                    except (ValueError, TypeError):
                        continue
                    if data.get("worker_id") == self.worker_id:
                        continue
                    self._publish_local(data["user_id"], data["event"])
            except Exception:
                self._sub_active = False

        self._sub_thread = threading.Thread(target=_run, daemon=True)
        self._sub_thread.start()

    def stop_subscriber(self) -> None:
        self._sub_active = False


manager = ConnectionManager()


def publish_user_event(user_id, event: dict) -> None:
    manager.publish(user_id, event)
