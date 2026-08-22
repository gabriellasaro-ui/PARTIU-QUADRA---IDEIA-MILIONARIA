"""Catalogo publico de quadras (Fase 3).

Contrato camelCase igual ao que www-usuario/services/venues.js ja consome.
Distancia calculada por haversine a partir de lat/lng (ou centro de Goiania).
Cache Redis por versao de catalogo; sem Redis cai direto no banco.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..models import Arena
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


@router.get("/proximo")
def local_mais_proximo(
    lat: float = Query(...),
    lng: float = Query(...),
    db: Session = Depends(get_db),
):
    """Traduz uma coordenada no bairro/cidade conhecidos mais proximos.

    Geocodificacao reversa com dado proprio, e nao com servico de terceiro:
    as arenas ja tem bairro, cidade e coordenada. A resposta e "o lugar
    conhecido mais perto de voce", que e exatamente o que a busca precisa
    dizer — e nao exige chave, cota nem request externo do aparelho.

    A contrapartida e honesta: onde nao ha arena cadastrada, o nome devolvido
    e o da area conhecida mais proxima, que pode estar longe. Por isso a
    distancia volta junto, para a interface decidir se vale mostrar.
    """
    arenas = db.execute(
        select(Arena).where(Arena.lat.isnot(None), Arena.lng.isnot(None))
    ).scalars().all()
    if not arenas:
        return {"local": None}

    from ..core.geo import haversine_km

    # haversine_km recebe DUAS tuplas (lat, lng), nao quatro floats.
    origem = (lat, lng)
    perto = min(arenas, key=lambda a: haversine_km(origem, (a.lat, a.lng)))
    dist = haversine_km(origem, (perto.lat, perto.lng))
    return {
        "local": {
            # O "bairro" do contrato publico e o address da arena — e o que
            # catalog.to_venue ja expoe como neighborhood. Nao ha coluna
            # neighborhood em Arena.
            "neighborhood": perto.address or "",
            "city": perto.city or "",
            "state": perto.state or "",
            "label": ", ".join(x for x in (perto.address, perto.city) if x),
            "distanceKm": round(dist, 1),
        }
    }


@router.get("/cidades")
def cidades_com_quadra(db: Session = Depends(get_db)):
    """Cidades onde existe quadra cadastrada — e nao o Brasil inteiro.

    O seletor de local do app sai daqui, e nao da lista do IBGE: oferecer
    5.571 municipios sendo que 5.570 nao tem uma quadra sequer transforma a
    escolha num beco sem saida. As coordenadas sao o centro das arenas
    daquela cidade, e e o que alimenta a ordenacao por distancia.
    """
    linhas = db.execute(
        select(
            Arena.city,
            Arena.state,
            func.avg(Arena.lat),
            func.avg(Arena.lng),
            func.count(Arena.id),
        )
        .where(Arena.city.isnot(None), Arena.lat.isnot(None), Arena.lng.isnot(None))
        .group_by(Arena.city, Arena.state)
        .order_by(func.count(Arena.id).desc(), Arena.city)
    ).all()
    return {
        "cidades": [
            {
                "city": c,
                "state": uf or "",
                "label": f"{c}, {uf}" if uf else c,
                "lat": round(lat, 6),
                "lng": round(lng, 6),
                "arenas": total,
            }
            for c, uf, lat, lng, total in linhas
        ]
    }


@router.get("/esportes")
def listar_esportes(
    destaque: bool = Query(False),
    db: Session = Depends(get_db),
):
    return {"esportes": catalog.get_sports(db, destaque=destaque)}


@router.get("/destaques")
def destaques(
    lat: float | None = Query(None),
    lng: float | None = Query(None),
    db: Session = Depends(get_db),
):
    # lat/lng opcionais: sem elas a distancia sai do centro de Goiania, e a
    # Home mostrava "3,8 km" para quem estava a 600 km da arena.
    return catalog.get_featured(db, lat=lat, lng=lng)


@router.get("/{quadra_id}/horarios")
def horarios(
    quadra_id: str,
    data: str | None = Query(None),
    db: Session = Depends(get_db),
):
    # Agenda vazia e agenda inexistente sao coisas diferentes: a tela agora
    # depende SO daqui (nao ha mais mock), entao "nao encontrada" precisa
    # significar mesmo isso, e nao "fechado nesse dia".
    if not catalog.court_exists(db, quadra_id):
        raise HTTPException(status_code=404, detail="Quadra nao encontrada")
    try:
        slots = catalog.get_availability(db, quadra_id, data)
    except ValueError:
        # strptime numa data torta derrubava com 500.
        raise HTTPException(status_code=422, detail="Data invalida (use AAAA-MM-DD)")

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


class InteresseBody(BaseModel):
    """Horario que a pessoa ESCOLHEU na agenda, sem necessariamente reservar."""

    data: str | None = None
    hora: str = "19:00"
    dur: int = Field(default=1, ge=1, le=3)


@router.post("/{quadra_id}/interesse", status_code=204)
def registrar_interesse(
    quadra_id: str,
    body: InteresseBody,
    db: Session = Depends(get_db),
):
    """Alimenta o mapa de calor do gerente com PROCURA por horario.

    A primeira versao contava no GET da agenda, somando 1 em toda hora livre do
    dia. Isso media quantas vezes o DIA foi aberto, nao qual horario interessa:
    a grade saia achatada, com o mesmo numero em todas as colunas, e a pergunta
    que o mapa existe para responder — "quando enche?" — ficava sem resposta.

    Escolher um horario e um ato deliberado, e e ele que carrega a informacao.

    Sem autenticacao de proposito: quem ainda nao entrou tambem procura horario,
    e exigir conta aqui apagaria justamente a demanda de quem nao virou cliente.
    Nao ha nada de identificavel na tabela — so quadra, dia da semana e hora.

    204 porque nao ha nada a devolver, e porque a tela nao deve esperar por
    telemetria para responder ao toque.
    """
    if not catalog.court_exists(db, quadra_id):
        raise HTTPException(status_code=404, detail="Quadra nao encontrada")
    catalog.registrar_interesse(db, quadra_id, body.data, body.hora, body.dur)
    return Response(status_code=204)
