"""Schemas de autenticacao — mesmo contrato que services/auth.js ja consome.

Respostas de sessao sao { token, user, isNew }; `user` usa chaves camelCase
(birthDate, memberSince, onboardedAt...) para o app nao precisar traduzir.
"""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, Field, field_validator


class LoginRequest(BaseModel):
    """`email` fica como str de proposito: validar aqui trancaria fora contas
    ja criadas com e-mail malformado, antes de RegisterRequest validar."""

    email: str
    senha: str


#: Exigencias da senha, num lugar so — o texto de erro e a validacao saem
#: daqui, entao a tela nunca pode divergir da regra.
SENHA_MINIMA = 8
SENHA_REGRAS = (
    (lambda s: len(s) >= SENHA_MINIMA, f"pelo menos {SENHA_MINIMA} caracteres"),
    (lambda s: any(c.isupper() for c in s), "uma letra maiúscula"),
    (lambda s: any(c.islower() for c in s), "uma letra minúscula"),
    (lambda s: any(c.isdigit() for c in s), "um número"),
    (lambda s: any(not c.isalnum() for c in s), "um caractere especial"),
)


def validar_senha(senha: str) -> str:
    """Valida e devolve a senha, ou levanta com TODAS as faltas de uma vez.

    Listar tudo junto, e nao a primeira falha: corrigir uma exigencia por
    tentativa e o jeito mais rapido de fazer alguem desistir do cadastro.
    """
    faltas = [texto for regra, texto in SENHA_REGRAS if not regra(senha or "")]
    if faltas:
        raise ValueError("A senha precisa ter " + ", ".join(faltas) + ".")
    return senha


class RegisterRequest(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    #: max_length continua no Field; o resto vem do validador, para o erro
    #: sair em portugues e completo em vez de "String should match pattern".
    senha: str = Field(max_length=128)

    @field_validator("senha")
    @classmethod
    def _senha_forte(cls, v: str) -> str:
        return validar_senha(v)


class TrocaSenhaRequest(BaseModel):
    """Troca de senha por quem ja esta dentro.

    A senha ATUAL e exigida mesmo havendo token valido: o token sobrevive
    dias, e celular destravado na mao de outra pessoa nao pode virar troca de
    senha — que e o jeito de tomar a conta de alguem para sempre.
    """

    senhaAtual: str
    senhaNova: str = Field(max_length=128)

    @field_validator("senhaNova")
    @classmethod
    def _forte(cls, v: str) -> str:
        return validar_senha(v)


class GoogleRequest(BaseModel):
    """O cliente manda o idToken cru; quem valida a assinatura junto ao Google
    e o servidor. O cliente nunca decide quem a pessoa e."""

    idToken: str
    #: De qual porta veio o clique: "jogador" (app do jogador) ou "gerente"
    #: (painel da arena). NAO e permissao — quem decide o papel continua sendo
    #: o banco. Serve para o caso "conta nao existe": no app do jogador criar na
    #: hora e o certo, no painel da arena e o errado, porque conta de gerente so
    #: nasce com CNPJ, endereco e aceite da comissao. Sem isso, um dono clicando
    #: "Entrar com Google" no painel ganharia em silencio uma conta de JOGADOR e
    #: bateria de cara num 403 sem entender por que.
    contexto: str = "jogador"


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
