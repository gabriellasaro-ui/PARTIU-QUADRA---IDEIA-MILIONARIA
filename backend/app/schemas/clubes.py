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
    #: aberto | solicitacao | privado. Ausente => aberto, que e como todo
    #: clube criado antes da Fase 16 sempre se comportou.
    joinMode: str | None = None
    #: Limite de membros. O servico prende o valor entre o total atual e o
    #: teto do sistema — o cliente nao manda um numero que valha sozinho.
    maxMembers: int | None = Field(default=None, ge=1, le=1000)


class ClubJoin(BaseModel):
    """Corpo opcional de POST /{id}/entrar.

    `codigo` so importa em clube privado: e a unica prova de que a pessoa foi
    convidada.
    """

    codigo: str | None = Field(default=None, max_length=20)


class ClubRoleBody(BaseModel):
    role: str = Field(min_length=1, max_length=10)


class ClubMessageCreate(BaseModel):
    text: str = Field(min_length=1, max_length=500)
