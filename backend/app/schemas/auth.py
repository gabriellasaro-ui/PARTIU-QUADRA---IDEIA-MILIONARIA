from pydantic import BaseModel
from typing import Optional


class LoginRequest(BaseModel):
    email: str
    senha: str


class RegisterRequest(BaseModel):
    name: str
    email: str
    senha: str


class GoogleRequest(BaseModel):
    """O cliente manda o idToken cru; quem valida a assinatura junto ao Google
    e o servidor. O cliente nunca decide quem a pessoa e."""

    idToken: str


class OnboardingRequest(BaseModel):
    position: str
    level: str


class Usuario(BaseModel):
    nome: str
    email: str
    avatar: Optional[str] = None


class SessionUser(BaseModel):
    """O usuario da sessao, no formato que o app consome.

    Difere de Usuario (que atende o /api/auth/user antigo, em portugues) —
    aqui as chaves batem com o objeto que services/auth.js guarda em
    pq:auth_user, para nao precisar de traducao no cliente."""

    id: str
    name: str
    email: str
    phone: str = ""
    city: str = ""
    photo: str = ""
    # Campos que o ranking e os torneios vao usar. Nascem vazios: o
    # onboarding pede so posicao e nivel, o resto fica para o perfil.
    position: str = ""
    level: str = ""
    birthDate: str = ""
    foot: str = ""
    favoriteSport: str = ""
    rating: Optional[float] = None
    memberSince: str = ""
    provider: str = "password"
    onboardedAt: Optional[str] = None


class SessionResponse(BaseModel):
    token: str
    user: SessionUser
    isNew: bool = False
