"""Pessoa bloqueada por uma arena.

Encerrar a conversa resolve UM atendimento. Nao resolve o caso em que o problema
e a pessoa: quem ofende o atendente, quem nao aparece toda semana, quem usa o
canal para vender coisa. Encerrada uma conversa, a proxima reserva abre outra,
e a arena volta ao mesmo lugar sem nenhuma ferramenta.

O bloqueio e por ARENA, e nao global: quem foi barrado numa quadra continua
jogando nas outras. Banir da plataforma e decisao de quem opera a plataforma —
e a arena tem interesse proprio no assunto, entao nao pode ser ela a tomar.

O que o bloqueio faz:
  - impede abrir conversa nova com aquela arena.

O que ele NAO faz, de proposito:
  - nao cancela reserva ja paga. Dinheiro recebido tem de ser honrado ou
    devolvido, e cancelar sozinho no momento do bloqueio seria confisco.
  - nao esconde a arena na busca nem impede reservar. Impedir a reserva junto
    exigiria decidir o que fazer com o pagamento no mesmo instante; enquanto
    isso nao for tratado com cuidado, o bloqueio fica no canal de conversa,
    que e onde o incomodo de fato acontece.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class ArenaBlock(Base):
    __tablename__ = "arena_blocks"
    __table_args__ = (
        UniqueConstraint("arena_id", "user_id", name="uq_arena_block"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    arena_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("arenas.id"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), index=True
    )
    #: Anotacao do gerente. Opcional, mas util quando outro atendente pergunta
    #: seis meses depois por que aquela pessoa esta bloqueada.
    motivo: Mapped[str | None] = mapped_column(String(280))
    #: Quem bloqueou. Numa arena com varios gerentes, "a arena bloqueou" nao
    #: responde a quem perguntar.
    blocked_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=_utcnow, server_default=func.now()
    )
