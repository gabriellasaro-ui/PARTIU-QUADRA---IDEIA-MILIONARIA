"""Registro de dispositivo para push (Fase 7).

POST /api/devices — upsert do fcm_token do usuario autenticado. O app chama
no login/abertura para o token estar sempre atualizado; um token que vem de
outro usuario e transferido para o dono atual.
"""
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..auth.deps import get_current_user
from ..core.database import get_db
from ..models import User
from ..repositories import notifications as repo

router = APIRouter(prefix="/api/devices", tags=["devices"])


class DeviceIn(BaseModel):
    fcmToken: str = Field(min_length=10, max_length=255)
    platform: str = Field(default="fcm", max_length=20)


@router.post("")
def registrar_dispositivo(
    payload: DeviceIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    device = repo.upsert_device(
        db, user.id, payload.fcmToken.strip(), payload.platform
    )
    db.commit()
    return {
        "ok": True,
        "device": {
            "id": str(device.id),
            "fcmToken": device.fcm_token,
            "platform": device.platform,
        },
    }
