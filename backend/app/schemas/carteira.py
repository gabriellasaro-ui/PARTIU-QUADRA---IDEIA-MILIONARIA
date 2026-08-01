from pydantic import BaseModel
from typing import Optional


class Transacao(BaseModel):
    data: str
    desc: str
    valor: float


class Cupom(BaseModel):
    codigo: str
    desc: str
