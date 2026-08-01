from fastapi import APIRouter
from ..core import data

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/user")
def usuario_atual():
    return {
        "nome": data.LOGGED_JOGADOR,
        "email": "gabriel@email.com",
        "avatar": None,
    }


@router.get("/gerente/user")
def gerente_usuario():
    return {
        "nome": data.LOGGED_ARENA,
        "email": "contato@arenabolanarede.com.br",
        "avatar": None,
        "role": "gerente",
    }
