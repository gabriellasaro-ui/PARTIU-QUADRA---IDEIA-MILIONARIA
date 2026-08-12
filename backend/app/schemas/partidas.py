"""DTOs de partidas / Game Day (Fase 9).

Contratos do app (game-mode.js / venues.js): PUT /{id}/score recebe
{teamA, teamB}; POST /{id}/teams recebe o snapshot completo de times
({version, rule, list, onCourt, queue}); goal/card/end/rate/atraso/media
carregam payloads pequenos.
"""
from typing import List, Optional

from pydantic import BaseModel, Field


class ScoreBody(BaseModel):
    teamA: int = Field(default=0, ge=0)
    teamB: int = Field(default=0, ge=0)


class GoalBody(BaseModel):
    team: str | None = Field(default=None, min_length=1, max_length=1)
    playerId: str | None = None
    playerName: str | None = None
    text: str | None = Field(default=None, max_length=255)


class CardBody(BaseModel):
    type: str = Field(min_length=1, max_length=10)
    team: str | None = Field(default=None, min_length=1, max_length=1)
    playerId: str | None = None
    playerName: str | None = None


class TeamsBody(BaseModel):
    version: Optional[int] = None
    rule: Optional[str] = None
    list: List[dict] = Field(default_factory=list)
    onCourt: Optional[dict] = None
    queue: Optional[List] = None


class EndBody(BaseModel):
    result: str | None = Field(default=None, max_length=255)
    score: dict | None = None


class RateBody(BaseModel):
    stars: int = Field(ge=1, le=5)


class DelayBody(BaseModel):
    minutes: int = Field(ge=0, le=180)


class MediaBody(BaseModel):
    url: str = Field(min_length=1, max_length=500)
    type: str = Field(default="photo", min_length=1, max_length=10)
