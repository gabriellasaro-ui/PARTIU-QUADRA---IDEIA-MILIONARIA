"""Peladas (Fase 9).

Contrato do app (venues.js / mobile.js):
  GET  /api/peladas            -> {peladas:[...]}
  POST /api/peladas            -> {peladas:[...], replay}  (exige reserva)
  POST /api/peladas/{id}/presenca -> {pelada}  ({memberId, value})
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..auth.deps import get_current_user
from ..core.database import get_db
from ..models import User
from ..schemas.peladas import AttendanceBody, PeladaCreate
from ..services import peladas as svc

router = APIRouter(prefix="/api/peladas", tags=["peladas"])


@router.get("")
def listar_peladas(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return {"peladas": svc.list_peladas(db, user)}


@router.post("")
def criar_peladas(
    body: PeladaCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    criadas, replay = svc.create_from_booking(db, user, body)
    return {"peladas": criadas, "replay": replay}


@router.post("/{pelada_id}/presenca")
def registrar_presenca(
    pelada_id: str,
    body: AttendanceBody,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return {"pelada": svc.set_attendance(db, user, pelada_id, body.value)}
