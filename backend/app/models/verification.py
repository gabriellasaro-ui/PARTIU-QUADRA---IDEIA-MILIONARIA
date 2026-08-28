"""Codigo de verificacao de contato — e-mail hoje, WhatsApp depois.

O CODIGO VAI COM HASH, nao em texto. E credencial de curta vida: quem ler o
banco (backup vazado, dump de suporte, um SELECT no lugar errado) nao pode sair
entrando nas contas. O custo e nenhum — comparar hash de 6 digitos e barato.

`channel` ja existe para o WhatsApp caber depois sem migracao. O que falta
para ele nao e coluna, e a aprovacao da Meta.
"""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base

CANAL_EMAIL = "email"
CANAL_WHATSAPP = "whatsapp"
CANAIS = (CANAL_EMAIL, CANAL_WHATSAPP)

#: Curto de proposito. Codigo que vale muito tempo e codigo que da tempo de ser
#: adivinhado — e, do outro lado, 10 min chega para abrir o e-mail.
VALIDADE_MINUTOS = 10
#: Depois disso o codigo QUEIMA e exige reenvio. Sem teto, 6 digitos caem em
#: forca bruta.
TENTATIVAS_MAX = 3
#: Espera entre envios. Protege o nosso custo de e-mail e a caixa de quem
#: recebe — sem isso um botao "reenviar" clicado dez vezes manda dez e-mails.
ESPERA_REENVIO_S = 60


class VerificationCode(Base):
    __tablename__ = "verification_codes"
    __table_args__ = (
        # A busca e sempre "o codigo vivo desta pessoa neste canal".
        Index("ix_verif_user_canal", "user_id", "channel"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), index=True
    )
    channel: Mapped[str] = mapped_column(String(20), default=CANAL_EMAIL)
    #: Para onde foi. Guardado porque a pessoa pode TROCAR o e-mail no meio do
    #: cadastro: sem isso, um codigo enviado ao endereco antigo validaria o novo.
    destination: Mapped[str] = mapped_column(String(255))
    code_hash: Mapped[str] = mapped_column(String(255))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sent_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
