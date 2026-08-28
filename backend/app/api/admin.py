"""Painel do admin — Fase 10.

Todas as rotas exigem `get_current_admin` (role=admin; 403 para os demais).
Os contratos sao camelCase e os valores monetarios em reais (float); centavos
ficam no banco. O financeiro usa o ledger de payments confirmados. As acoes
de escrita (pausar/reativar arena) gravam `AdminAction` (auditoria).
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..auth.deps import get_current_admin
from ..core.database import get_db
from ..models import User
from pydantic import BaseModel

from ..schemas.admin import PauseBody, ReactivateBody
from ..services import admin as svc
from ..services import arena_onboarding as onb

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/overview")
def overview(
    periodo: str = Query(default="30d"),
    inatividade: int = Query(default=7, ge=0),
    user: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    return svc.overview(db, periodo=periodo, inatividade=inatividade)


@router.get("/arenas")
def listar_arenas(
    q: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    return svc.arenas(db, q=q, limit=limit, offset=offset)


@router.get("/reservas")
def listar_reservas(
    status: str | None = Query(default=None),
    q: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    return svc.reservas(db, status=status, q=q, limit=limit, offset=offset)


@router.get("/clubes")
def listar_clubes(
    user: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    return svc.clubes(db)


@router.get("/pessoas")
def listar_pessoas(
    q: str | None = Query(default=None),
    cidade: str | None = Query(default=None),
    estado: str | None = Query(default=None),
    periodo: str = Query(default="30d"),
    inatividade: int = Query(default=7, ge=0),
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    return svc.pessoas(
        db, q=q, cidade=cidade, estado=estado,
        periodo=periodo, inatividade=inatividade, limit=limit, offset=offset,
    )


@router.post("/arenas/{aid}/pause")
def pausar_arena(
    aid: str,
    body: PauseBody,
    user: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    return svc.pause_arena(db, user, aid, body.motivo)


@router.post("/arenas/{aid}/reactivate")
def reativar_arena(
    aid: str,
    body: ReactivateBody,
    user: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    return svc.reactivate_arena(db, user, aid, body.motivo)


# ── Solicitacoes de entrada de arena ───────────────────────────────────────
#
# A fila que decide quem entra no Qadras. Sem tela aqui, aprovar seria um
# UPDATE no banco na mao — e a solicitacao parada e arena perdida.

class RecusaBody(BaseModel):
    motivo: str = ""


@router.get("/solicitacoes")
def solicitacoes(
    situacao: str | None = Query(default=None),
    user: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """Sem `situacao`, so as ABERTAS — que e a fila de trabalho.

    Listar tudo por padrao afogaria a tela em fichas ja decididas assim que o
    primeiro mes passasse.
    """
    return {"solicitacoes": onb.listar(db, situacao=situacao)}


@router.post("/solicitacoes/{app_id}/aprovar")
def aprovar_solicitacao(
    app_id: str,
    user: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    return onb.aprovar(db, user, app_id)


@router.post("/solicitacoes/{app_id}/recusar")
def recusar_solicitacao(
    app_id: str,
    body: RecusaBody,
    user: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    return onb.recusar(db, user, app_id, body.motivo)


@router.get("/auditoria")
def auditoria(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    return svc.auditoria(db, limit=limit, offset=offset)
