"""Solicitacao de entrada de uma arena — a ficha que a Qadras analisa.

TABELA SEPARADA DE `arenas`, e nao colunas novas la. O que o dono DECLARA nao e
o que a plataforma PUBLICA: CNPJ, razao social, faturamento e a dor dele
existem para decidir se aquilo e mesmo uma quadra apta, e nada disso pode
vazar para o app do jogador. Misturar os dois faria a triagem viajar junto de
todo `to_venue`, e um dia sairia numa resposta publica sem ninguem notar.

A arena SO NASCE na aprovacao. Ate la existe apenas esta ficha; e por isso que
`arena_id` e nulo e so e preenchido no fim.

CADA PASSO E GRAVADO (`step`). O cadastro tem oito telas e o dono responde do
celular, no intervalo do trabalho — sem isso, fechar o app custa comecar de
novo, e cadastro longo que nao guarda progresso e cadastro abandonado.
"""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base
from ._types import JSONVariant

#: Rascunho -> enviada -> (em_analise) -> aprovada | recusada.
#: `em_analise` existe para o admin marcar o que ja pegou para si: sem isso,
#: com duas pessoas analisando, as duas abrem a mesma ficha.
APP_RASCUNHO = "rascunho"
APP_ENVIADA = "enviada"
APP_EM_ANALISE = "em_analise"
APP_APROVADA = "aprovada"
APP_RECUSADA = "recusada"

APP_STATUSES = (APP_RASCUNHO, APP_ENVIADA, APP_EM_ANALISE, APP_APROVADA, APP_RECUSADA)

#: Fichas que ainda ocupam a fila do admin.
APP_ABERTAS = (APP_ENVIADA, APP_EM_ANALISE)

#: Versao do texto de termos aceito. Sobe quando o texto muda — e por isso que
#: se guarda a versao, e nao um booleano: daqui a um ano ninguem consegue dizer
#: COM O QUE a pessoa concordou se so houver `aceitou: true`.
TERMOS_VERSAO_ATUAL = "2026-08-1"

#: Ultimo passo do formulario. Serve para "retomar de onde parou" e para o
#: envio saber se o percurso terminou.
PASSO_FINAL = 8


class ArenaApplication(Base):
    __tablename__ = "arena_applications"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    #: Dono da ficha. Unico: uma pessoa toca um cadastro por vez — com dois, o
    #: "retomar de onde parou" nao saberia qual retomar.
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), unique=True, index=True
    )
    status: Mapped[str] = mapped_column(
        String(20), default=APP_RASCUNHO, server_default=APP_RASCUNHO, index=True
    )
    step: Mapped[int] = mapped_column(Integer, default=1, server_default="1")

    # --- identidade ---------------------------------------------------------
    arena_name: Mapped[str | None] = mapped_column(String(140))
    legal_name: Mapped[str | None] = mapped_column(String(180))
    #: So digitos, sem mascara: com mascara o mesmo CNPJ entra de duas formas e
    #: a checagem de duplicado deixa de funcionar.
    cnpj: Mapped[str | None] = mapped_column(String(14), index=True)
    #: O que a consulta publica devolveu. Guardado para o admin VER, nunca para
    #: recusar sozinho — quadra em CNPJ de restaurante da familia e comum
    #: demais para virar recusa automatica.
    cnpj_cnae: Mapped[str | None] = mapped_column(String(120))
    cnpj_situacao: Mapped[str | None] = mapped_column(String(40))

    # --- contato ------------------------------------------------------------
    contact_name: Mapped[str | None] = mapped_column(String(120))
    contact_email: Mapped[str | None] = mapped_column(String(255))
    contact_phone: Mapped[str | None] = mapped_column(String(20))

    # --- endereco -----------------------------------------------------------
    cep: Mapped[str | None] = mapped_column(String(8))
    address: Mapped[str | None] = mapped_column(String(255))
    number: Mapped[str | None] = mapped_column(String(20))
    complement: Mapped[str | None] = mapped_column(String(120))
    neighborhood: Mapped[str | None] = mapped_column(String(120))
    city: Mapped[str | None] = mapped_column(String(120))
    state: Mapped[str | None] = mapped_column(String(2))
    lat: Mapped[float | None] = mapped_column(Float)
    lng: Mapped[float | None] = mapped_column(Float)

    # --- operacao e diagnostico --------------------------------------------
    court_count: Mapped[int | None] = mapped_column(Integer)
    sports: Mapped[list | None] = mapped_column(JSONVariant)
    opening_hours_note: Mapped[str | None] = mapped_column(Text)
    #: O que dói hoje (horario vago, calote, controle no caderno...). E o campo
    #: que diz se o Qadras resolve o problema DELE, e nao so se a quadra existe.
    pains: Mapped[list | None] = mapped_column(JSONVariant)
    #: Faixa, nao valor: perguntar o numero exato derruba resposta, e para
    #: triagem a faixa basta. Opcional de proposito.
    revenue_range: Mapped[str | None] = mapped_column(String(40))

    #: Data URLs, como `Court.photos` ja faz. Text/JSON porque base64 nao cabe
    #: em String(500) — mesmo defeito ja corrigido na logo da arena.
    photos: Mapped[list | None] = mapped_column(JSONVariant)

    # --- aceites ------------------------------------------------------------
    #: Data + a taxa VIGENTE no momento do aceite. A taxa vem da config e vai
    #: mudar; sem o retrato, ninguem consegue dizer com quanto ele concordou.
    fee_accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    fee_rate_snapshot: Mapped[float | None] = mapped_column(Float)
    terms_accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    terms_version: Mapped[str | None] = mapped_column(String(20))

    # --- decisao ------------------------------------------------------------
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    #: Obrigatorio na recusa — recusa sem motivo vira uma pessoa ligando para
    #: perguntar por que, e ninguem sabe responder.
    reject_reason: Mapped[str | None] = mapped_column(Text)
    #: Preenchido na aprovacao: e o elo entre a ficha e a arena que nasceu dela.
    arena_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), index=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
