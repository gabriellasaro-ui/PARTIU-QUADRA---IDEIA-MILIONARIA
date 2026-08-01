from pydantic import BaseModel
from typing import Optional


class Reserva(BaseModel):
    id: int
    cliente: str
    telefone: str
    quadra: str
    data: str
    hora: str
    valor: float
    status: str


class ReservaUpdate(BaseModel):
    status: str


class ReservaJogador(BaseModel):
    id: int
    nome: str
    esporte: str
    bairro: str
    foto: str
    valor: float
    data: str
    hora: str
    status: str
    status_class: str


class ReservaDetalhe(BaseModel):
    r: dict
    comissao: float
    repasse: float
    taxa: int
    chat_cid: Optional[int] = None
