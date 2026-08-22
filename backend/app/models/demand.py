"""Registro de PROCURA por horario.

O painel do gerente mostra um mapa de calor de dia da semana x hora. A camada
de reservas sai de `bookings`; esta tabela existe para a outra camada, que nao
existia em lugar nenhum: quantas vezes alguem OLHOU a agenda de uma quadra e
nao reservou.

Por que a distincao importa: um horario vazio e ambiguo. Ninguem quer jogar
terca as 15h, ou todo mundo quer e a quadra esta fechada nesse horario? As duas
situacoes aparecem como zero em `bookings`, e pedem acoes opostas — uma diz
"nao insista", a outra diz "abra". Sem medir a procura, o dono nao tem como
saber qual das duas esta olhando.

O que NAO e guardado aqui, de proposito:
  - quem olhou. Nao ha user_id nem IP. Para "quantas pessoas querem sabado as
    20h" a identidade e irrelevante, e guardar identidade sem necessidade cria
    um dever de protege-la que nao precisamos ter.
  - o horario exato do clique. So o dia da semana e a hora do SLOT olhado, que
    e a pergunta de negocio; o resto seria rastro sem uso.

Uma linha por (quadra, dia da semana, hora) com um contador, e nao uma linha
por evento: a granularidade de evento nao acrescenta nada a um mapa de calor e
faria a tabela crescer sem limite.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class SlotDemand(Base):
    __tablename__ = "slot_demand"
    __table_args__ = (
        # Uma linha por combinacao: o INSERT vira "soma 1" na linha que ja
        # existe. Sem a restricao, corridas criariam duplicatas e o mapa
        # somaria errado.
        UniqueConstraint("court_id", "day_of_week", "hour", name="uq_slot_demand"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    court_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), index=True)
    #: 0 = domingo, 6 = sabado. Domingo primeiro porque e como a grade e
    #: desenhada no Brasil; a conversao do weekday() do Python (segunda = 0)
    #: acontece uma vez, na escrita.
    day_of_week: Mapped[int] = mapped_column(Integer)
    hour: Mapped[int] = mapped_column(Integer)
    #: Quantas vezes esse slot foi olhado sem virar reserva.
    views: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=_utcnow, onupdate=_utcnow, server_default=func.now()
    )
