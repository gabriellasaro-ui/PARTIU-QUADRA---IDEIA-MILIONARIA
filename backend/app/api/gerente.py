"""Painel do gerente — Fase 8.

Todos os contratos em camelCase. Cada rota resolve a arena pelo token do
gerente (`manager_arena_or_404`) e opera nela; acessos a dados de outra arena
respondem 403. Reservas manuais e mensalistas criam Payment provider="manual"
para a arena ser ressarcida pelo mesmo fluxo do ledger.
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..auth.deps import get_current_manager
from ..core.database import get_db
from ..models import User
from ..schemas.gerente import (
    ArenaConfigUpdate,
    ArenaProfileUpdate,
    AvaliacaoReply,
    BookingCreate,
    CouponCreate,
    CourtCreate,
    CourtUpdate,
    DesativacaoBody,
    MensalistaCreate,
)
from ..services import gerente as svc

router = APIRouter(prefix="/api/gerente", tags=["gerente"])


@router.get("/dashboard")
def dashboard(
    user: User = Depends(get_current_manager),
    db: Session = Depends(get_db),
):
    return svc.dashboard(db, user)


@router.get("/agenda")
def agenda(
    semana: str | None = Query(default=None, description="YYYY-MM-DD"),
    user: User = Depends(get_current_manager),
    db: Session = Depends(get_db),
):
    return svc.agenda(db, user, semana)


@router.get("/reservas")
def listar_reservas(
    status: str | None = Query(default=None),
    q: str | None = Query(default=None),
    user: User = Depends(get_current_manager),
    db: Session = Depends(get_db),
):
    return {"reservas": svc.list_reservas(db, user, status_filtro=status, q=q)}


@router.post("/reservas")
def criar_reserva_manual(
    body: BookingCreate,
    user: User = Depends(get_current_manager),
    db: Session = Depends(get_db),
):
    booking = svc.create_manual_booking(db, user, body)
    court = svc.repo.get_court_in_arena(db, booking.court_id, booking.arena_id)
    return {"reserva": svc.serialize_booking(booking, court, svc.manager_arena_or_404(db, user), None)}


@router.get("/mensalistas")
def listar_mensalistas(
    user: User = Depends(get_current_manager),
    db: Session = Depends(get_db),
):
    return {"mensalistas": svc.list_mensalistas(db, user)}


@router.post("/mensalistas")
def criar_mensalista(
    body: MensalistaCreate,
    user: User = Depends(get_current_manager),
    db: Session = Depends(get_db),
):
    created = svc.create_manual_mensalista(db, user, body)
    return {"mensalistas": svc.list_mensalistas(db, user), "criadas": len(created)}


@router.get("/mensalistas/{rid}/sessoes")
def sessoes_mensalista(
    rid: str,
    user: User = Depends(get_current_manager),
    db: Session = Depends(get_db),
):
    return {"sessoes": svc.mensalista_sessions(db, user, rid)}


@router.delete("/mensalistas/{rid}")
def cancelar_mensalista(
    rid: str,
    user: User = Depends(get_current_manager),
    db: Session = Depends(get_db),
):
    return svc.cancel_mensalista(db, user, rid)


@router.get("/financeiro")
def financeiro(
    periodo: str = Query(default="30d"),
    user: User = Depends(get_current_manager),
    db: Session = Depends(get_db),
):
    return svc.financeiro(db, user, periodo)


@router.get("/quadras")
def listar_quadras(
    user: User = Depends(get_current_manager),
    db: Session = Depends(get_db),
):
    return svc.list_quadras(db, user)


@router.post("/quadras")
def criar_quadra(
    body: CourtCreate,
    user: User = Depends(get_current_manager),
    db: Session = Depends(get_db),
):
    court = svc.create_quadra(db, user, body)
    return {"quadra": svc.serialize_court(court)}


@router.get("/quadras/{cid}")
def detalhe_quadra(
    cid: str,
    user: User = Depends(get_current_manager),
    db: Session = Depends(get_db),
):
    arena = svc.manager_arena_or_404(db, user)
    court = svc.repo.get_court_in_arena(db, cid, arena.id)
    if court is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Quadra não encontrada")
    return {"quadra": svc.serialize_court(court)}


@router.patch("/quadras/{cid}")
def atualizar_quadra(
    cid: str,
    body: CourtUpdate,
    user: User = Depends(get_current_manager),
    db: Session = Depends(get_db),
):
    court = svc.update_quadra(db, user, cid, body)
    return {"quadra": svc.serialize_court(court)}


@router.get("/avaliacoes")
def avaliacoes(
    user: User = Depends(get_current_manager),
    db: Session = Depends(get_db),
):
    return svc.list_avaliacoes(db, user)


@router.post("/avaliacoes/{rid}/resposta")
def responder_avaliacao(
    rid: str,
    body: AvaliacaoReply,
    user: User = Depends(get_current_manager),
    db: Session = Depends(get_db),
):
    return svc.reply_avaliacao(db, user, rid, body.resposta)


@router.get("/cupons")
def listar_cupons(
    user: User = Depends(get_current_manager),
    db: Session = Depends(get_db),
):
    return {"cupons": svc.list_cupons(db, user)}


@router.post("/cupons")
def criar_cupom(
    body: CouponCreate,
    user: User = Depends(get_current_manager),
    db: Session = Depends(get_db),
):
    coupon = svc.create_cupom(db, user, body)
    arena = svc.manager_arena_or_404(db, user)
    return {"cupom": svc._serialize_coupon(coupon, arena)}


@router.delete("/cupons/{cid}")
def excluir_cupom(
    cid: str,
    user: User = Depends(get_current_manager),
    db: Session = Depends(get_db),
):
    return svc.delete_cupom(db, user, cid)


@router.get("/perfil")
def perfil(
    user: User = Depends(get_current_manager),
    db: Session = Depends(get_db),
):
    return svc.arena_profile(db, user)


@router.patch("/perfil")
def atualizar_perfil(
    body: ArenaProfileUpdate,
    user: User = Depends(get_current_manager),
    db: Session = Depends(get_db),
):
    return svc.update_arena_profile(db, user, body)


@router.get("/configuracoes")
def configuracoes(
    user: User = Depends(get_current_manager),
    db: Session = Depends(get_db),
):
    return svc.arena_config(db, user)


@router.patch("/configuracoes")
def atualizar_configuracoes(
    body: ArenaConfigUpdate,
    user: User = Depends(get_current_manager),
    db: Session = Depends(get_db),
):
    return svc.update_arena_config(db, user, body)


@router.post("/desativacao")
def desativar(
    body: DesativacaoBody,
    user: User = Depends(get_current_manager),
    db: Session = Depends(get_db),
):
    return svc.desativar_arena(db, user, body.motivo, body.periodo)
