from fastapi import APIRouter
from ..core import data

router = APIRouter(prefix="/api/favoritos", tags=["favoritos"])


@router.get("")
def favoritos():
    favs = [data.get_quadra(1), data.get_quadra(2), data.get_quadra(4)]
    return {"quadras": [f for f in favs if f]}
