"""Ponto unico de import dos models.

Importar este modulo registra todas as tabelas no metadata do Alembic e
garante que seed/services enxerguem o schema completo.
"""
from .user import (
    PROVIDER_GOOGLE,
    PROVIDER_PASSWORD,
    ROLE_ADMIN,
    ROLE_GERENTE,
    ROLE_JOGADOR,
    User,
)
from .user_session import UserSession

__all__ = [
    "User",
    "UserSession",
    "ROLE_JOGADOR",
    "ROLE_GERENTE",
    "ROLE_ADMIN",
    "PROVIDER_PASSWORD",
    "PROVIDER_GOOGLE",
]
