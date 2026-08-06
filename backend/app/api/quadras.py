"""Catalogo publico de quadras (Fase 3).

Contrato camelCase igual ao que www-usuario/services/venues.js ja consome.
Distancia calculada por haversine a partir de lat/lng (ou centro de Goiania).
Cache Redis por versao de catalogo; sem Redis cai direto no banco.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..services import catalog

router = APIRouter(prefix="/api/quadras", tags=["quadras"])


def _get_court(db: Session, court_id: str):
    if not court_id:
        return None
    return catalog.get_venue_detail(db, court_id)


@router.get("")
def listar_quadras(
    esporte: str = Query(""),
    q: str = Query(""),
    lat: float | None = Query(None),
    lng: float | None = Query(None),
    agora: bool = Query(False),
    limit: int = Query(100),
    offset: int = Query(0),
    db: Session = Depends(get_db),
):
    return catalog.list_venues(
        db,
        sport=esporte or None,
        search=q or None,
        lat=lat,
        lng=lng,
        agora=agora,
        limit=limit,
        offset=offset,
    )


@router.get("/esportes")
def listar_esportes(
    destaque: bool = Query(False),
    db: Session = Depends(get_db),
):
    return {"esportes": catalog.get_sports(db, destaque=destaque)}


@router.get("/destaques")
def destaques(db: Session = Depends(get_db)):
    return catalog.get_featured(db)


@router.get("/{quadra_id}/horarios")
def horarios(
    quadra_id: str,
    data: str | None = Query(None),
    db: Session = Depends(get_db),
):
    slots = catalog.get_availability(db, quadra_id, data)
    if not slots:
        raise HTTPException(status_code=404, detail="Quadra nao encontrada")
    return {"horarios": slots, "data": data}


@router.get("/{quadra_id}/resumo")
def resumo_quadra(
    quadra_id: str,
    hora: str = Query("19:00"),
    dur: int = Query(1),
    db: Session = Depends(get_db),
):
    resumo = catalog.get_resumo(db, quadra_id, hora, dur)
    if not resumo:
        raise HTTPException(status_code=404, detail="Quadra nao encontrada")
    return resumo


@router.get("/{quadra_id}/avaliacoes")
def avaliacoes(quadra_id: str, db: Session = Depends(get_db)):
    reviews = catalog.get_venue_reviews(db, quadra_id)
    if reviews is None:
        raise HTTPException(status_code=404, detail="Quadra nao encontrada")
    return {"avaliacoes": reviews}


@router.get("/{quadra_id}")
def detalhe_quadra(quadra_id: str, db: Session = Depends(get_db)):
    venue = _get_court(db, quadra_id)
    if not venue:
        raise HTTPException(status_code=404, detail="Quadra nao encontrada")
    return {"quadra": venue}
