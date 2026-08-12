"""Partidas / Game Day (Fase 9).

Contrato do app (venues.js / game-mode.js):
  GET  /api/partidas/ativa       -> match (ou null) — materializa sob demanda
  GET  /api/partidas/historico   -> {partidas:[...]}
  PUT  /api/partidas/{id}/score  -> {teamA, teamB}
  POST /api/partidas/{id}/goal   -> {team, playerId, playerName}
  POST /api/partidas/{id}/card   -> {type, team, playerId, playerName}
  POST /api/partidas/{id}/teams  -> snapshot completo ({version,rule,list,onCourt,queue})
  POST /api/partidas/{id}/end    -> {result, score?}
  POST /api/partidas/{id}/rate   -> {stars} (1-5, por usuario)
  POST /api/partidas/{id}/confirmar
  POST /api/partidas/{id}/atraso -> {minutes}
  POST /api/partidas/{id}/compartilhar-localizacao
  POST /api/partidas/{id}/media?type=photo|video -> {url}
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..auth.deps import get_current_user
from ..core.database import get_db
from ..models import User
from ..schemas.partidas import (
    CardBody,
    DelayBody,
    EndBody,
    GoalBody,
    MediaBody,
    RateBody,
    ScoreBody,
    TeamsBody,
)
from ..services import matches as svc

router = APIRouter(prefix="/api/partidas", tags=["partidas"])


@router.get("/ativa")
def partida_ativa(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return svc.active_match(db, user)


@router.get("/historico")
def historico_partidas(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return {"partidas": svc.history(db, user)}


@router.put("/{match_id}/score")
def atualizar_placar(
    match_id: str,
    body: ScoreBody,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return svc.update_score(db, user, match_id, body)


@router.post("/{match_id}/goal")
def registrar_gol(
    match_id: str,
    body: GoalBody,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return svc.add_goal(db, user, match_id, body)


@router.post("/{match_id}/card")
def registrar_cartao(
    match_id: str,
    body: CardBody,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return svc.add_card(db, user, match_id, body)


@router.post("/{match_id}/teams")
def salvar_times(
    match_id: str,
    body: TeamsBody,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return svc.set_teams(db, user, match_id, body)


@router.post("/{match_id}/end")
def encerrar_partida(
    match_id: str,
    body: EndBody,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return svc.end_match(db, user, match_id, body)


@router.post("/{match_id}/rate")
def avaliar_partida(
    match_id: str,
    body: RateBody,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return svc.rate_match(db, user, match_id, body.stars)


@router.post("/{match_id}/confirmar")
def confirmar_presenca(
    match_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return svc.confirm_presence(db, user, match_id)


@router.post("/{match_id}/atraso")
def avisar_atraso(
    match_id: str,
    body: DelayBody,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return svc.notify_delay(db, user, match_id, body.minutes)


@router.post("/{match_id}/compartilhar-localizacao")
def compartilhar_localizacao(
    match_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return svc.share_location(db, user, match_id)


@router.post("/{match_id}/media")
def adicionar_midia(
    match_id: str,
    body: MediaBody,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    type_: str = Query(default="photo", alias="type"),
):
    return svc.add_media(db, user, match_id, body.type or type_, body.url)
