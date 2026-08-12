"""DTOs de peladas (Fase 9).

A pelada nasce de uma reserva (doc §9.5): o cliente informa `reservationCode`
ou `bookingId` e a data/hora/quadra/esporte sao derivadas da reserva no
servidor. Os demais campos que o app envia em `criarPeladasDaReserva`
(clubId, title, maxPlayers) sao aceitos como refinamento; venueId/venueName/
sport/dateISO/startTime/duration/plan/status/attendance sao ignorados.
"""
from pydantic import BaseModel, Field


class PeladaCreate(BaseModel):
    reservationCode: str | None = None
    bookingId: str | None = None
    clubId: str | None = None
    title: str | None = Field(default=None, max_length=120)
    maxPlayers: int | None = Field(default=None, ge=2, le=100)


class AttendanceBody(BaseModel):
    memberId: str | None = None  # ignorado — identidade vem do token
    value: str = Field(min_length=1, max_length=10)
