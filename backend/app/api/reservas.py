"""Reservas do jogador + aprovacao/recusa do gerente (Fase 4).

Rotas:
  POST /api/reservas/quote        — cotacao (preco server-side)
  POST /api/reservas              — cria reserva/grupo mensalista (Idempotency-Key)
  GET  /api/reservas              — lista do jogador ({reservas:[...]})
  GET  /api/reservas/{id}         — detalhe + breakdown
  GET  /api/reservas/{id}/events  — eventos de status (polling; WS na Fase 6)
  POST /api/reservas/{id}/pagar   — mock F4: pending_payment -> requested
  POST /api/reservas/{id}/aprovar | /recusar — gerente dono da arena
  POST /api/reservas/{id}/cancelar
  POST /api/reservas/{id}/avaliar — so reserva concluida, 1 por booking

Dependencias de Idempotency-Key vêm do header; replay devolve a reserva
original com replay=true.
"""
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session
from starlette.responses import Response

from ..auth.deps import get_current_manager, get_current_user
from ..core.database import get_db
from ..core.ratelimit import LIMIT_WRITE_USER, limiter, user_or_ip_key
from ..models import User
from ..schemas.reservas import ActionBody, BookingCreate, QuoteRequest, ReviewCreate
from ..services import bookings as svc

router = APIRouter(prefix="/api/reservas", tags=["reservas"])


@router.post("/quote")
def cotacao(
    body: QuoteRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return svc.quote_booking(
        db, court_id=body.quadraId, date=body.data, hora=body.hora,
        dur=body.dur, plan=body.plano,
    )


@router.post("")
@limiter.limit(LIMIT_WRITE_USER, key_func=user_or_ip_key)
def criar_reserva(
    request: Request,
    body: BookingCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    idempotency_key: str = Header(..., alias="Idempotency-Key"),
    response: Response = None,
):
    created, replay = svc.create_booking(
        db,
        user=user,
        court_id=body.quadraId,
        date=body.data,
        hora=body.hora,
        dur=body.dur,
        plan=body.plano,
        weekday=body.dia,
        payment_method=body.pagamento,
        idempotency_key=idempotency_key,
    )
    return {"reservas": [svc.serialize(db, b) for b in created], "replay": replay}


@router.get("")
def listar_reservas(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return {"reservas": svc.list_for_player(db, user)}


@router.get("/{rid}")
def detalhe_reserva(
    rid: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    booking, court, arena = svc.get_reservation(db, user, rid)
    return {"reserva": svc.serialize(db, booking), "events": svc.get_events(db, user, rid)}


@router.get("/{rid}/events")
def eventos_reserva(
    rid: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return {"events": svc.get_events(db, user, rid)}


@router.post("/{rid}/pagar")
@limiter.limit(LIMIT_WRITE_USER, key_func=user_or_ip_key)
def pagar_reserva(
    request: Request,
    rid: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    response: Response = None,
):
    booking, payment, replay = svc.pay_booking(db, user, rid)
    return {
        "reserva": svc.serialize(db, booking),
        "payment": svc.serialize_payment(payment),
        "replay": replay,
    }


@router.post("/{rid}/aprovar")
def aprovar_reserva(
    rid: str,
    user: User = Depends(get_current_manager),
    db: Session = Depends(get_db),
):
    booking = svc.approve_booking(db, user, rid)
    return {"reserva": svc.serialize(db, booking)}


@router.post("/{rid}/recusar")
def recusar_reserva(
    rid: str,
    body: ActionBody | None = None,
    user: User = Depends(get_current_manager),
    db: Session = Depends(get_db),
):
    booking = svc.reject_booking(db, user, rid, reason=body.motivo if body else None)
    return {"reserva": svc.serialize(db, booking)}


@router.post("/{rid}/cancelar")
def cancelar_reserva(
    rid: str,
    body: ActionBody | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    booking = svc.cancel_booking(db, user, rid, reason=body.motivo if body else None)
    return {"reserva": svc.serialize(db, booking)}


@router.post("/{rid}/avaliar")
def avaliar_reserva(
    rid: str,
    body: ReviewCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    review = svc.create_review(db, user, rid, body.nota, body.comentario)
    return {"ok": True, "reviewId": str(review.id)}
