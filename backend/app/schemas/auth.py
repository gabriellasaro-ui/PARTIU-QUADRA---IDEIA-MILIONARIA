from pydantic import BaseModel
from typing import Optional


class LoginRequest(BaseModel):
    email: str
    senha: str


class Usuario(BaseModel):
    nome: str
    email: str
    avatar: Optional[str] = None
