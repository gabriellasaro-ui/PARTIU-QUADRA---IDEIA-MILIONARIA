"""Cadastro de uma arena nova: rascunho, envio, aprovacao.

O CICLO, e onde cada peca entra:

    iniciar     cria a conta (papel gerente) + a ficha em rascunho
    salvar      grava um passo e avanca `step` — e o que permite sair e voltar
    enviar      confere o conjunto, exige e-mail verificado, vai para a fila
    aprovar     CRIA A ARENA a partir da ficha e liga as duas
    recusar     encerra com motivo, que e obrigatorio

A ARENA SO NASCE NA APROVACAO. Enquanto a ficha esta aberta nao existe arena
nenhuma no banco — e por isso que jogador nenhum consegue ver uma quadra em
analise, sem precisar de filtro em lugar nenhum. Filtro se esquece; linha que
nao existe, nao.

`role=gerente` desde o inicio, mesmo sem arena: sem isso a pessoa nao consegue
nem carregar a propria ficha, porque toda rota do painel exige o papel. Quem
barra o painel vazio e o `status` da ficha, nao o papel.
"""
import uuid
from datetime import datetime

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth.security import hash_password, utcnow
from ..core.config import settings
from ..models import (
    APP_ABERTAS,
    APP_APROVADA,
    APP_EM_ANALISE,
    APP_ENVIADA,
    APP_RASCUNHO,
    APP_RECUSADA,
    ARENA_APROVADA,
    Arena,
    ArenaApplication,
    PASSO_FINAL,
    TERMOS_VERSAO_ATUAL,
    User,
)
from ..models.user import PROVIDER_PASSWORD, ROLE_ADMIN, ROLE_GERENTE
from .documentos import cnpj_valido, consultar_cnpj, limpar_cnpj
from .notifications import emit_notification

#: Campos que cada passo grava. Fica aqui, e nao no front, porque e o servidor
#: que decide o que entra na ficha — um passo do cliente nao pode escrever
#: `status` nem `arena_id`.
CAMPOS_POR_PASSO = {
    3: ("arena_name", "legal_name", "cnpj"),
    4: ("cep", "address", "number", "complement", "neighborhood", "city", "state", "lat", "lng"),
    5: ("contact_name", "contact_phone"),
    6: ("court_count", "sports", "opening_hours_note", "pains", "revenue_range"),
    7: ("photos",),
}

#: Sem estes a ficha nao da para analisar. Fotos ficam DE FORA de proposito:
#: sao o sinal mais forte, mas exigir upload no celular com internet ruim
#: derruba cadastro — quem analisa cobra depois se precisar.
OBRIGATORIOS = {
    "arena_name": "o nome da quadra",
    "cnpj": "o CNPJ",
    "cep": "o CEP",
    "number": "o número do endereço",
    "city": "a cidade",
    "contact_phone": "o telefone de contato",
}


def _ficha_dict(ficha: ArenaApplication) -> dict:
    return {
        "id": str(ficha.id),
        "status": ficha.status,
        "passo": ficha.step,
        "passoFinal": PASSO_FINAL,
        "arenaNome": ficha.arena_name or "",
        "razaoSocial": ficha.legal_name or "",
        "cnpj": ficha.cnpj or "",
        "cnpjCnae": ficha.cnpj_cnae or "",
        "cnpjSituacao": ficha.cnpj_situacao or "",
        "contatoNome": ficha.contact_name or "",
        "contatoEmail": ficha.contact_email or "",
        "contatoTelefone": ficha.contact_phone or "",
        "cep": ficha.cep or "",
        "endereco": ficha.address or "",
        "numero": ficha.number or "",
        "complemento": ficha.complement or "",
        "bairro": ficha.neighborhood or "",
        "cidade": ficha.city or "",
        "estado": ficha.state or "",
        "quantasQuadras": ficha.court_count,
        "esportes": ficha.sports or [],
        "horarios": ficha.opening_hours_note or "",
        "dores": ficha.pains or [],
        "faturamento": ficha.revenue_range or "",
        "fotos": ficha.photos or [],
        "taxaAceita": ficha.fee_rate_snapshot,
        "termosAceitos": bool(ficha.terms_accepted_at),
        "enviadaEm": ficha.submitted_at.isoformat() if ficha.submitted_at else None,
        "motivoRecusa": ficha.reject_reason or "",
        "arenaId": str(ficha.arena_id) if ficha.arena_id else None,
    }


def minha_ficha(db: Session, user) -> ArenaApplication | None:
    return db.execute(
        select(ArenaApplication).where(ArenaApplication.user_id == user.id)
    ).scalar_one_or_none()


def iniciar(db: Session, *, nome: str, email: str, senha: str) -> tuple[User, ArenaApplication]:
    email = (email or "").lower().strip()
    if db.execute(select(User).where(User.email == email)).first():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Este e-mail já tem conta. Entre para continuar o cadastro.",
        )
    user = User(
        email=email,
        name=(nome or "").strip(),
        password_hash=hash_password(senha),
        # Gerente desde ja, mesmo sem arena: toda rota do painel exige o papel,
        # e sem ele a pessoa nao carregaria nem a propria ficha.
        role=ROLE_GERENTE,
        provider=PROVIDER_PASSWORD,
    )
    db.add(user)
    db.flush()

    ficha = ArenaApplication(
        user_id=user.id,
        status=APP_RASCUNHO,
        step=2,  # passo 1 (a conta) acabou de ser cumprido
        contact_name=user.name,
        contact_email=user.email,
    )
    db.add(ficha)
    db.commit()
    return user, ficha


def salvar_passo(db: Session, user, passo: int, dados: dict) -> dict:
    ficha = minha_ficha(db, user)
    if ficha is None:
        raise HTTPException(status_code=404, detail="Cadastro não encontrado")
    if ficha.status not in (APP_RASCUNHO, APP_RECUSADA):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Este cadastro já foi enviado e não pode mais ser editado.",
        )
    campos = CAMPOS_POR_PASSO.get(passo)
    if campos is None:
        raise HTTPException(status_code=422, detail="Passo inválido")

    for campo in campos:
        if campo in dados:
            setattr(ficha, campo, dados[campo])

    if "cnpj" in dados:
        limpo = limpar_cnpj(dados["cnpj"])
        if limpo and not cnpj_valido(limpo):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="CNPJ inválido — confira os números.",
            )
        ficha.cnpj = limpo
        # A consulta e ENFEITE UTIL, nao porteiro: se a BrasilAPI estiver fora
        # do ar o cadastro segue igual, com os campos vazios.
        info = consultar_cnpj(limpo) if limpo else None
        if info:
            ficha.cnpj_cnae = (info["cnae"] + " " + info["cnaeDescricao"]).strip()
            ficha.cnpj_situacao = info["situacao"]
            if not ficha.legal_name:
                ficha.legal_name = info["razaoSocial"]

    # Uma ficha recusada que volta a ser editada e um cadastro NOVO em curso:
    # sem isso ela ficaria "recusada" enquanto a pessoa corrige, e o envio
    # seria barrado pelo proprio status.
    if ficha.status == APP_RECUSADA:
        ficha.status = APP_RASCUNHO
        ficha.reject_reason = None

    ficha.step = max(ficha.step or 1, min(passo + 1, PASSO_FINAL))
    db.commit()
    return _ficha_dict(ficha)


def aceitar_termos(db: Session, user, *, taxa: bool, termos: bool) -> dict:
    ficha = minha_ficha(db, user)
    if ficha is None:
        raise HTTPException(status_code=404, detail="Cadastro não encontrado")
    if not taxa or not termos:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="É preciso aceitar a comissão e os termos para enviar.",
        )
    agora = utcnow()
    ficha.fee_accepted_at = agora
    # A taxa VIGENTE, e nao um `true`. Ela vem da config e vai mudar; daqui a
    # um ano ninguem consegue dizer com quanto a pessoa concordou se so houver
    # um booleano gravado.
    ficha.fee_rate_snapshot = settings.arena_fee_rate
    ficha.terms_accepted_at = agora
    ficha.terms_version = TERMOS_VERSAO_ATUAL
    ficha.step = PASSO_FINAL
    db.commit()
    return _ficha_dict(ficha)


def enviar(db: Session, user) -> dict:
    ficha = minha_ficha(db, user)
    if ficha is None:
        raise HTTPException(status_code=404, detail="Cadastro não encontrado")
    if ficha.status in APP_ABERTAS:
        raise HTTPException(status_code=409, detail="Este cadastro já foi enviado.")
    if ficha.status == APP_APROVADA:
        raise HTTPException(status_code=409, detail="Este cadastro já foi aprovado.")

    if not user.email_verified_at:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Confirme seu e-mail antes de enviar o cadastro.",
        )
    faltando = [rotulo for campo, rotulo in OBRIGATORIOS.items() if not getattr(ficha, campo)]
    if faltando:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Ainda falta preencher: " + ", ".join(faltando) + ".",
        )
    if not ficha.terms_accepted_at or not ficha.fee_accepted_at:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="É preciso aceitar a comissão e os termos para enviar.",
        )

    ficha.status = APP_ENVIADA
    ficha.submitted_at = utcnow()
    db.commit()

    for admin in db.execute(select(User).where(User.role == ROLE_ADMIN)).scalars():
        emit_notification(
            db, admin.id,
            type="arena.solicitacao",
            title="Nova arena quer entrar",
            body=f"{ficha.arena_name} — {ficha.city or 'cidade não informada'}",
            data={"solicitacaoId": str(ficha.id)},
        )
    return _ficha_dict(ficha)


# ── Lado do admin ──────────────────────────────────────────────────────────

def listar(db: Session, *, situacao: str | None = None) -> list[dict]:
    q = select(ArenaApplication).order_by(ArenaApplication.submitted_at.desc().nullslast())
    if situacao:
        q = q.where(ArenaApplication.status == situacao)
    else:
        q = q.where(ArenaApplication.status.in_(APP_ABERTAS))
    return [_ficha_dict(f) for f in db.execute(q).scalars().all()]


def _pegar(db: Session, app_id) -> ArenaApplication:
    try:
        chave = uuid.UUID(str(app_id))
    except (ValueError, TypeError):
        raise HTTPException(status_code=404, detail="Solicitação não encontrada")
    ficha = db.get(ArenaApplication, chave)
    if ficha is None:
        raise HTTPException(status_code=404, detail="Solicitação não encontrada")
    return ficha


def aprovar(db: Session, admin, app_id) -> dict:
    ficha = _pegar(db, app_id)
    if ficha.status == APP_APROVADA:
        raise HTTPException(status_code=409, detail="Esta solicitação já foi aprovada.")
    if ficha.status not in APP_ABERTAS:
        raise HTTPException(
            status_code=409,
            detail="Só dá para aprovar uma solicitação que foi enviada.",
        )

    # AQUI a arena passa a existir. E tambem aqui que "nome pre-preenchido se
    # for aprovado" acontece: ela nasce com o que o dono declarou.
    arena = Arena(
        owner_id=ficha.user_id,
        name=ficha.arena_name or "Arena",
        phone=ficha.contact_phone,
        email=ficha.contact_email,
        address=", ".join(p for p in (ficha.address, ficha.number) if p) or None,
        neighborhood=ficha.neighborhood,
        city=ficha.city,
        state=ficha.state,
        lat=ficha.lat,
        lng=ficha.lng,
        status=ARENA_APROVADA,
        is_active=True,
    )
    db.add(arena)
    db.flush()

    ficha.status = APP_APROVADA
    ficha.arena_id = arena.id
    ficha.reviewed_at = utcnow()
    ficha.reviewed_by = admin.id
    db.commit()

    emit_notification(
        db, ficha.user_id,
        type="arena.aprovada",
        title="Sua arena foi aprovada!",
        body=f"{arena.name} já está no Qadras. Cadastre suas quadras para começar a receber reservas.",
        data={"arenaId": str(arena.id)},
    )
    return _ficha_dict(ficha)


def recusar(db: Session, admin, app_id, motivo: str) -> dict:
    ficha = _pegar(db, app_id)
    if ficha.status not in APP_ABERTAS:
        raise HTTPException(
            status_code=409,
            detail="Só dá para recusar uma solicitação que foi enviada.",
        )
    motivo = (motivo or "").strip()
    # Obrigatorio: recusa sem motivo vira uma pessoa ligando para perguntar por
    # que, e ninguem do outro lado sabe responder.
    if len(motivo) < 5:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Escreva o motivo da recusa — ele vai para o dono da quadra.",
        )

    ficha.status = APP_RECUSADA
    ficha.reject_reason = motivo
    ficha.reviewed_at = utcnow()
    ficha.reviewed_by = admin.id
    db.commit()

    emit_notification(
        db, ficha.user_id,
        type="arena.recusada",
        title="Não foi desta vez",
        body=motivo,
        data={"solicitacaoId": str(ficha.id)},
    )
    return _ficha_dict(ficha)
