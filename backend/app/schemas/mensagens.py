from pydantic import BaseModel
from typing import Optional


class Mensagem(BaseModel):
    de: str
    texto: str
    hora: str


class Conversa(BaseModel):
    id: int
    jogador: str
    arena: str
    quadra: str
    assunto: str
    mensagens: list[Mensagem]


class MensagemInput(BaseModel):
    texto: str
    de: str = "jogador"
