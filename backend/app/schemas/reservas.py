"""DTOs de reservas (Fase 4).

Contrato do app: GET /api/reservas -> {reservas:[{id, code, venueId, ...}]}.
O cliente informa apenas quadra/data/hora/duracao/plano/dia; dinheiro e
status sao sempre calculados e derivados pelo servidor.
"""
from pydantic import BaseModel, Field


class QuoteRequest(BaseModel):
    quadraId: str = Field(min_length=1)
    data: str | None = None
    hora: str = "19:00"
    dur: int = Field(default=1, ge=1, le=3)
    plano: str = "avulso"


class BookingCreate(BaseModel):
    quadraId: str = Field(min_length=1)
    data: str | None = None
    hora: str = "19:00"
    dur: int = Field(default=1, ge=1, le=3)
    plano: str = "avulso"
    dia: int | None = Field(default=None, ge=0, le=6)
    pagamento: str = "pix"


class ReviewCreate(BaseModel):
    nota: int = Field(ge=1, le=5)
    comentario: str | None = None


class ActionBody(BaseModel):
    motivo: str | None = None
