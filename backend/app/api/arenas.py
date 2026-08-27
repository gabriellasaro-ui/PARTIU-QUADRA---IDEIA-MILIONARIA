"""Perfil publico da arena — a vitrine entre a busca e a quadra.

O catalogo (`/api/quadras`) devolve QUADRAS: um item por quadra, com o nome da
arena repetido em cada um. Isto aqui devolve a ARENA: quem ela e, e o que ela
tem para alugar. E a diferenca entre uma lista de pratos e a pagina do
restaurante.

REGRA QUE VALE PARA OS DOIS ENDPOINTS: nada de telefone, e-mail, chave Pix ou
rua. Quem sai daqui com o contato e o endereco fecha por fora, e a reserva que
sustenta a plataforma nao acontece. Localizacao publica e bairro/cidade mais o
mapa do proprio app. O corte esta no servico (`catalog.get_arena_profile`), e
`backend/tests/test_arena_perfil.py` verifica as chaves do retorno para a regra
nao se perder numa refatoracao futura.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..services import catalog

router = APIRouter(prefix="/api/arenas", tags=["arenas"])


@router.get("")
def listar_arenas(
    lat: float | None = Query(None),
    lng: float | None = Query(None),
    limit: int = Query(20),
    db: Session = Depends(get_db),
):
    """Arenas com quadra disponivel, da mais perto para a mais longe."""
    return {"arenas": catalog.list_arenas(db, lat=lat, lng=lng, limit=limit)}


@router.get("/{arena_id}")
def perfil_da_arena(
    arena_id: str,
    lat: float | None = Query(None),
    lng: float | None = Query(None),
    db: Session = Depends(get_db),
):
    perfil = catalog.get_arena_profile(db, arena_id, lat=lat, lng=lng)
    if perfil is None:
        # Arena inexistente e arena pausada respondem igual, de proposito: o
        # perfil e uma URL publica e nao precisa contar a quem tem o link que
        # aquela arena existe e esta desligada.
        raise HTTPException(status_code=404, detail="Arena não encontrada")
    return {"arena": perfil}
