"""Schemas de autenticacao — mesmo contrato que services/auth.js ja consome.

Respostas de sessao sao { token, user, isNew }; `user` usa chaves camelCase
(birthDate, memberSince, onboardedAt...) para o app nao precisar traduzir.
"""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, Field


class LoginRequest(BaseModel):
    """`email` fica como str de proposito: validar aqui trancaria fora contas
    ja criadas com e-mail malformado, antes de RegisterRequest validar."""

    email: str
    senha: str


class RegisterRequest(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    senha: str = Field(min_length=8, max_length=128)


class GoogleRequest(BaseModel):
    """O cliente manda o idToken cru; quem valida a assinatura junto ao Google
    e o servidor. O cliente nunca decide quem a pessoa e."""

    idToken: str


class OnboardingRequest(BaseModel):
    # A modalidade vem antes da posicao: "Pivo" so quer dizer algo sabendo se
    # e futsal ou basquete. E e ela que vai separar ranking la na frente.
    favoriteSport: Optional[str] = ""
    position: Optional[str] = ""
    level: Optional[str] = ""
    onboardedAt: Optional[str] = None


class RefreshRequest(BaseModel):
    refreshToken: str


class LogoutRequest(BaseModel):
    refreshToken: Optional[str] = None


class SessionUser(BaseModel):
    """O usuario da sessao, no formato que o app consome (chaves camelCase).

    `role` e aditivo para o gerente; o app do jogador ignora.
    """

    id: str
    name: str
    email: str
    role: str = "jogador"
    phone: str = ""
    city: str = ""
    photo: str = ""
    position: str = ""
    level: str = ""
    birthDate: str = ""
    foot: str = ""
    favoriteSport: str = ""
    state: str = ""
    rating: Optional[float] = None
    memberSince: str = ""
    provider: str = "password"
    onboardedAt: Optional[str] = None


class SessionResponse(BaseModel):
    token: str
    user: SessionUser
    isNew: bool = False
    refreshToken: Optional[str] = None
