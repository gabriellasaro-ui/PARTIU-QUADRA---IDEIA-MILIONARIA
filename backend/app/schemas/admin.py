"""DTOs do painel do admin (Fase 10).

Os endpoints de leitura usam apenas query params (periodo, q, cidade/estado,
inatividade, limit/offset). Aqui ficam os corpos das acoes administrativas.
"""
from typing import Optional

from pydantic import BaseModel, Field


class PauseBody(BaseModel):
    motivo: str = Field(min_length=3)


class ReactivateBody(BaseModel):
    motivo: Optional[str] = None
