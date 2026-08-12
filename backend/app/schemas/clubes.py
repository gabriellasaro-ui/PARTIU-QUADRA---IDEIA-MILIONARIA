"""DTOs de clubes e mural (Fase 9).

Contrato do app (venues.js): POST /api/clubes recebe {id?, name, sport, city,
description, createdBy}; o `createdBy`/`members` vindo do cliente e ignorado —
identidade e perfil vem do token. Mensagens: {text} (memberId/name/time sao
do servidor).
"""
from pydantic import BaseModel, Field


class ClubCreate(BaseModel):
    id: str | None = None
    name: str = Field(min_length=1, max_length=60)
    sport: str = Field(min_length=1, max_length=60)
    city: str = Field(min_length=1, max_length=60)
    state: str | None = Field(default=None, min_length=2, max_length=2)
    description: str | None = Field(default=None, max_length=120)


class ClubMessageCreate(BaseModel):
    text: str = Field(min_length=1, max_length=500)
