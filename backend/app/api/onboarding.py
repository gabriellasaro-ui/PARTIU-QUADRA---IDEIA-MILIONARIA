"""Cadastro de arena e verificacao de contato.

Duas familias no mesmo arquivo porque elas so existem juntas: sem e-mail
verificado o cadastro nao e enviado, e a verificacao so aparece dentro dele.

    POST /api/arenas/solicitacao            comeca (cria conta + ficha)
    GET  /api/arenas/solicitacao/minha      retoma de onde parou
    PATCH/api/arenas/solicitacao/passo/{n}  grava um passo
    POST /api/arenas/solicitacao/aceites    comissao + termos
    POST /api/arenas/solicitacao/enviar     manda para a fila
    GET  /api/arenas/cnpj/{cnpj}            razao social + CNAE

    POST /api/auth/verificar/enviar         pede o codigo
    POST /api/auth/verificar/conferir       confere

As duas de verificacao levam limite de taxa: codigo de 6 digitos e o alvo mais
obvio de forca bruta que existe numa API.
"""
from fastapi import APIRouter, Body, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from ..auth.deps import get_current_manager, get_current_user
from ..core.database import get_db
from ..core.ratelimit import LIMIT_AUTH_IP, limiter
from ..models import User
from ..models.verification import CANAL_EMAIL
from ..schemas.auth import validar_senha
from ..services import arena_onboarding as svc
from ..services import verificacao
from ..services.documentos import consultar_cnpj

router = APIRouter(tags=["onboarding"])


# ── Verificacao ────────────────────────────────────────────────────────────

class EnviarCodigo(BaseModel):
    destino: str = ""
    canal: str = CANAL_EMAIL


class ConferirCodigo(BaseModel):
    codigo: str
    canal: str = CANAL_EMAIL


@router.post("/api/auth/verificar/enviar")
@limiter.limit(LIMIT_AUTH_IP)
def enviar_codigo(
    request: Request,
    body: EnviarCodigo,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Sem destino, o proprio e-mail da conta. E o caso comum: a pessoa acabou
    # de criar a conta e so quer confirmar o endereco que ja digitou.
    destino = (body.destino or "").strip() or user.email
    return verificacao.solicitar(db, user, destino, body.canal)


@router.post("/api/auth/verificar/conferir")
@limiter.limit(LIMIT_AUTH_IP)
def conferir_codigo(
    request: Request,
    body: ConferirCodigo,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return verificacao.conferir(db, user, body.codigo, body.canal)


# ── Cadastro da arena ──────────────────────────────────────────────────────

class ComecarCadastro(BaseModel):
    nome: str = Field(min_length=2, max_length=120)
    email: EmailStr
    senha: str


class Aceites(BaseModel):
    taxa: bool = False
    termos: bool = False


@router.post("/api/arenas/solicitacao")
@limiter.limit(LIMIT_AUTH_IP)
def comecar(request: Request, body: ComecarCadastro, db: Session = Depends(get_db)):
    """Cria a conta do dono e a ficha em rascunho, e ja devolve sessao.

    Sessao aqui e o que faz "salvar a cada passo" existir: sem token, os passos
    seguintes nao teriam como identificar de quem e a ficha, e o cadastro
    voltaria a ser um formulario unico que se perde ao fechar o app.
    """
    # A mesma regra de senha do cadastro de jogador — validada aqui, e nao no
    # schema, para a mensagem sair no idioma do resto da API.
    senha = validar_senha(body.senha)
    user, _ = svc.iniciar(db, nome=body.nome, email=body.email, senha=senha)

    from .auth import _issue_session
    sessao = _issue_session(db, user, is_new=True)
    sessao["ficha"] = svc._ficha_dict(svc.minha_ficha(db, user))
    return sessao


@router.get("/api/arenas/solicitacao/minha")
def minha(user: User = Depends(get_current_manager), db: Session = Depends(get_db)):
    ficha = svc.minha_ficha(db, user)
    if ficha is None:
        raise HTTPException(status_code=404, detail="Cadastro não encontrado")
    dados = svc._ficha_dict(ficha)
    # O front precisa saber se ainda falta confirmar o e-mail para decidir em
    # qual passo abrir; sem isso ele mandaria a pessoa para o passo 3 e o envio
    # falharia la no fim, sem explicacao.
    dados["emailVerificado"] = bool(user.email_verified_at)
    return dados


@router.patch("/api/arenas/solicitacao/passo/{passo}")
def gravar_passo(
    passo: int,
    dados: dict = Body(default_factory=dict),
    user: User = Depends(get_current_manager),
    db: Session = Depends(get_db),
):
    return svc.salvar_passo(db, user, passo, dados)


@router.post("/api/arenas/solicitacao/aceites")
def aceites(
    body: Aceites,
    user: User = Depends(get_current_manager),
    db: Session = Depends(get_db),
):
    return svc.aceitar_termos(db, user, taxa=body.taxa, termos=body.termos)


@router.post("/api/arenas/solicitacao/enviar")
def enviar_solicitacao(
    user: User = Depends(get_current_manager), db: Session = Depends(get_db)
):
    return svc.enviar(db, user)


@router.get("/api/arenas/cnpj/{cnpj}")
def cnpj(cnpj: str):
    """Razao social, situacao e CNAE — para o formulario preencher sozinho.

    404 cobre os dois casos que o cliente trata igual: CNPJ invalido e servico
    fora do ar. Em ambos o campo continua editavel a mao, que e o ponto.
    """
    info = consultar_cnpj(cnpj)
    if not info:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Não foi possível consultar este CNPJ. Preencha à mão.",
        )
    return info
