from fastapi import APIRouter
from ..core import data

router = APIRouter(prefix="/api/perfil", tags=["perfil"])


@router.get("")
def perfil():
    stats = {"jogos": 12, "reservas": 8, "favoritas": 3, "esporte_fav": "Futebol Society"}
    conquistas = [
        {"icon": "i-check", "title": "Pontual", "desc": "100% de presença", "on": True},
        {"icon": "i-flame", "title": "Veterano", "desc": "10+ jogos", "on": True},
        {"icon": "i-map", "title": "Explorador", "desc": "5 quadras diferentes", "on": True},
        {"icon": "i-star", "title": "Avaliador", "desc": "Faça 3 avaliações", "on": False},
    ]
    return {
        "stats": stats,
        "esportes": data.ESPORTES,
        "proximo": data.reservas_jogador()[0] if data.reservas_jogador() else None,
        "conquistas": conquistas,
    }


@router.post("/salvar")
def salvar_perfil():
    return {"message": "Perfil salvo com sucesso"}
