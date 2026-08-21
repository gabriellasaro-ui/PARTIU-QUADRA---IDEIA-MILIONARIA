"""Clubes (Fase 9).

Contrato do app (venues.js / mobile.js):
  GET    /api/clubes              -> {clubes:[...]}  (privado nao entra)
  GET    /api/clubes?codigo=X     -> {clube}  (match EXATO, sem hifen)
  GET    /api/clubes/meus         -> {clubes:[...]}  (os meus)
  POST   /api/clubes              -> {clube}  (id presente = edicao)
  POST   /api/clubes/{id}/entrar  -> {clube} ou {status:"pendente"}
  POST   /api/clubes/{id}/sair    -> {ok}
  DELETE /api/clubes/{id}         -> {ok}  (so dono, clube vazio)
  DELETE /api/clubes/{id}/membros/{mid} -> {ok}  (gestao, nunca a si mesmo)
  POST   /api/clubes/{id}/membros/{mid}/cargo -> {clube}  (so dono)
  GET    /api/clubes/{id}/solicitacoes -> {solicitacoes:[...]}  (gestao)
  POST   /api/clubes/{id}/solicitacoes/{sid}/aprovar|recusar -> {ok}
  GET    /api/clubes/{id}/mensagens -> {mensagens:[...]}  (so membro, NAO marca lido)
  POST   /api/clubes/{id}/mensagens/read -> {ok, naoLidas}
  POST   /api/clubes/{id}/mensagens -> {mensagem}  ({text})
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..auth.deps import get_current_user
from ..core.database import get_db
from ..models import User
from ..schemas.clubes import ClubCreate, ClubJoin, ClubMessageCreate, ClubRoleBody
from ..services import clubs as svc

router = APIRouter(prefix="/api/clubes", tags=["clubes"])


@router.get("")
def listar_clubes(
    codigo: str | None = Query(default=None, max_length=20),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if codigo:
        return {"clube": svc.get_by_code(db, codigo, user)}
    return {"clubes": svc.list_clubs(db, user)}


# ATENCAO: /meus tem de vir ANTES de qualquer /{club_id}. O FastAPI casa as
# rotas na ordem de declaracao — declarada depois, "meus" seria lido como um
# id de clube e a rota responderia 404.
@router.get("/meus")
def meus_clubes(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return {"clubes": svc.meus_clubes(db, user)}


@router.post("")
def criar_clube(
    body: ClubCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return {"clube": svc.create_club(db, user, body)}


@router.post("/{club_id}/entrar")
def entrar_clube(
    club_id: str,
    body: ClubJoin | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Corpo opcional: o app antigo chama sem corpo nenhum e continua valendo.

    Em clube de solicitacao a resposta e {status:"pendente", clube:{...}} em
    vez de {clube:{...}} — quem chamou precisa saber que ainda nao entrou.
    """
    resultado = svc.join_club(db, user, club_id, body.codigo if body else None)
    if isinstance(resultado, dict) and resultado.get("status"):
        return resultado
    return {"clube": resultado}


@router.post("/{club_id}/sair")
def sair_clube(
    club_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return svc.leave_club(db, user, club_id)


@router.delete("/{club_id}")
def apagar_clube(
    club_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return svc.delete_club(db, user, club_id)


@router.delete("/{club_id}/membros/{member_id}")
def remover_membro(
    club_id: str,
    member_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return svc.remove_member(db, user, club_id, member_id)


@router.post("/{club_id}/mensagens/read")
def marcar_chat_lido(
    club_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Marca o mural como lido.

    Rota separada de proposito: o GET das mensagens NAO marca. O aviso
    persistente tem de sobreviver ao carregamento da tela e sumir so quando a
    pessoa abre a aba de conversa.
    """
    return svc.marcar_chat_lido(db, user, club_id)


@router.get("/{club_id}/solicitacoes")
def listar_solicitacoes(
    club_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return svc.listar_solicitacoes(db, user, club_id)


@router.post("/{club_id}/solicitacoes/{request_id}/aprovar")
def aprovar_solicitacao(
    club_id: str,
    request_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return svc.decidir_solicitacao(db, user, club_id, request_id, True)


@router.post("/{club_id}/solicitacoes/{request_id}/recusar")
def recusar_solicitacao(
    club_id: str,
    request_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return svc.decidir_solicitacao(db, user, club_id, request_id, False)


@router.post("/{club_id}/membros/{member_id}/cargo")
def definir_cargo(
    club_id: str,
    member_id: str,
    body: ClubRoleBody,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return {"clube": svc.definir_cargo(db, user, club_id, member_id, body.role)}


@router.get("/{club_id}/mensagens")
def listar_mensagens(
    club_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return {"mensagens": svc.list_messages(db, user, club_id)}


@router.post("/{club_id}/mensagens")
def enviar_mensagem(
    club_id: str,
    body: ClubMessageCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return {"mensagem": svc.send_message(db, user, club_id, body.text)}
