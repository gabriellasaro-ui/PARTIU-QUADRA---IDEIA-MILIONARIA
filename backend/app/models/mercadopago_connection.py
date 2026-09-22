"""Conexao OAuth de uma arena com o Mercado Pago (split de pagamentos 1:1).

Cada arena (vendedor) autoriza a Qadras a cobrar na conta DELA. O MP devolve
um access_token de 180 dias mais um refresh_token; a cobranca sai com o token
da arena e a Qadras retem `application_fee` na mesma transacao.

POR QUE TABELA PROPRIA, e nao um JSON em `arenas.settings`:

  1. `expires_at` indexado deixa a task de renovacao varrer so o que esta
     vencendo. Em JSON seria carregar toda arena do banco e parsear uma a uma
     a cada rodada — e a rodada e diaria, para sempre.
  2. `arenas.settings` ja e serializado para o painel do gerente. Um token de
     acesso total a conta bancaria de terceiro nao pode morar num campo que
     outra rota devolve por engano; aqui ele so sai se alguem pedir por nome.

Nada neste modelo vai para log. Ver `_SENSIVEIS` em services/mercadopago_oauth.
"""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base
from ._types import JSONVariant


class MercadoPagoConnection(Base):
    __tablename__ = "mercadopago_connections"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    #: UNIQUE: uma arena tem uma conta de recebimento, nunca duas. Reconectar
    #: sobrescreve a linha em vez de criar uma segunda — senao a cobranca teria
    #: de escolher entre dois tokens, e escolheria errado em algum momento.
    arena_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("arenas.id"), unique=True, index=True
    )

    #: Text, e nao String(n): o MP nao documenta tamanho maximo de token, e um
    #: token truncado so aparece como 401 na primeira cobranca real.
    access_token: Mapped[str] = mapped_column(Text)
    refresh_token: Mapped[str | None] = mapped_column(Text)
    #: `user_id` do MP (o collector). Nome com prefixo para nao confundir com
    #: `users.id` da Qadras, que e outra coisa inteiramente.
    mp_user_id: Mapped[str | None] = mapped_column(String(60), index=True)
    #: Devolvida pelo OAuth, guardada por completude. NAO e usada para
    #: tokenizar cartao: o front tokeniza com a public_key da QADRAS. Ver
    #: secao 8.1 de IMPLEMENTAR_MERCADO PAGO.md.
    public_key: Mapped[str | None] = mapped_column(Text)
    token_type: Mapped[str | None] = mapped_column(String(40))
    scope: Mapped[str | None] = mapped_column(String(120))

    #: Indexado porque a task diaria pergunta exatamente por ele: "quem vence
    #: nos proximos N dias?". Sem indice isso e full scan diario.
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), index=True
    )

    #: Taxa que o MP cobra NESTA conta. Fica por arena porque em split 1:1 a
    #: tarifa aplicada e a do vendedor, nao a da Qadras — e ela e negociavel,
    #: entao duas arenas podem ter numeros diferentes. Comeca no default do
    #: config e e corrigida pelo `fee_details` do primeiro pagamento real.
    fee_rate: Mapped[float | None] = mapped_column(Float)
    #: Meios que esta conta aceita (ex.: ["pix", "credit_card"]). O app do
    #: jogador esconde cartao para arena que nao o tem habilitado — senao a
    #: cobranca falha depois do jogador ja ter digitado o cartao.
    payment_methods: Mapped[dict | None] = mapped_column(JSONVariant)

    #: Quem, do lado da Qadras, concluiu a conexao. Rastro de auditoria: se um
    #: repasse cair na conta errada, isto diz quem autorizou.
    connected_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id")
    )
    connected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    #: Desconexao e soft: o historico de pagamentos aponta para esta linha.
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
