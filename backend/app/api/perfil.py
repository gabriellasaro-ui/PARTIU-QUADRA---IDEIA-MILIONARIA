"""Perfil do jogador.

Este modulo era o unico do app inteiro sem banco e sem autenticacao: devolvia
estatisticas fixas, nenhum dado de identidade, e nao tinha PATCH — o front
chamava PATCH /api/perfil e recebia 405. Com a rota `perfil` liberada na web,
o cabecalho quebrava com TypeError em profile.name antes de desenhar a pagina.

Agora a identidade sai da sessao e os numeros sao contados no banco.
"""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from ..auth.deps import get_current_user
from ..core import data
from ..core.database import get_db
from ..models import Court
from ..models.booking import ACTIVE_STATUSES, STATUS_COMPLETED, Booking
from ..models.favorite import UserFavorite
from ..models.user import User
from ..models.user_session import UserSession
from ..auth.security import utcnow, verify_password

router = APIRouter(prefix="/api/perfil", tags=["perfil"])


class PerfilPatch(BaseModel):
    """O que a pessoa realmente edita — a conta E a ficha de jogador.

    `email` fica de fora de proposito: e a chave de login e, em conta Google,
    pertence ao provedor — deixar editar aqui quebraria o proximo acesso sem
    aviso nenhum.

    Os quatro campos da FICHA (position, level, birthDate, foot) faltavam
    aqui. As colunas existem em `users` desde a Fase 2 e a leitura ja os
    devolvia, mas o PATCH os descartava em silencio: a tela mandava, recebia
    200, mostrava "Perfil atualizado" e nada era gravado. O pior tipo de
    falha, a que parece sucesso.
    """

    name: str | None = None
    phone: str | None = None
    city: str | None = None
    state: str | None = None
    favoriteSport: str | None = None
    position: str | None = None
    level: str | None = None
    #: ISO (YYYY-MM-DD). String vazia limpa o campo.
    birthDate: str | None = None
    foot: str | None = None


def _estatisticas(db: Session, user: User) -> dict:
    reservas = db.execute(
        select(func.count()).select_from(Booking).where(Booking.user_id == user.id)
    ).scalar_one()
    jogos = db.execute(
        select(func.count())
        .select_from(Booking)
        .where(Booking.user_id == user.id, Booking.status == STATUS_COMPLETED)
    ).scalar_one()
    favoritas = db.execute(
        select(func.count()).select_from(UserFavorite).where(UserFavorite.user_id == user.id)
    ).scalar_one()

    # Esporte favorito: o mais reservado. O declarado no perfil ganha, quando
    # existe — a pessoa dizer que joga volei vale mais que o historico.
    esporte = user.favorite_sport or ""
    if not esporte:
        esporte = db.execute(
            select(Court.sport)
            .join(Booking, Booking.court_id == Court.id)
            .where(Booking.user_id == user.id)
            .group_by(Court.sport)
            .order_by(func.count().desc())
            .limit(1)
        ).scalar_one_or_none() or ""

    # Chaves em ingles porque e o que o front le (profile.stats.games etc.,
    # mesmo formato do mock). O endpoint antigo devolvia jogos/reservas/
    # favoritas e por isso a tela mostrava "undefined" nos tres numeros.
    return {
        "games": jogos,
        "reservations": reservas,
        "favorites": favoritas,
        "favoriteSport": esporte,
    }


def _conquistas(stats: dict) -> list:
    """Ligadas ao que a pessoa fez, e nao fixas em `on: True` como antes."""
    return [
        {"icon": "i-check", "title": "Pontual", "desc": "Nenhum no-show", "on": stats["games"] > 0},
        {"icon": "i-flame", "title": "Veterano", "desc": "10+ jogos", "on": stats["games"] >= 10},
        {"icon": "i-map", "title": "Explorador", "desc": "5 quadras diferentes", "on": stats["reservations"] >= 5},
        {"icon": "i-star", "title": "Avaliador", "desc": "Faça 3 avaliações", "on": False},
    ]


@router.get("")
def perfil(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # Import local: auth.py importa deps, e deps importa models — trazer o
    # serializador no topo fecharia o ciclo na carga do modulo.
    from .auth import _to_session_user

    stats = _estatisticas(db, user)
    return {
        **_to_session_user(user).model_dump(),
        "stats": stats,
        "esportes": data.ESPORTES,
        "conquistas": _conquistas(stats),
    }


@router.patch("")
def salvar_perfil(
    patch: PerfilPatch,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from .auth import _to_session_user

    campos = {
        "name": "name",
        "phone": "phone",
        "city": "city",
        "state": "state",
        "favoriteSport": "favorite_sport",
        "position": "position",
        "level": "level",
        "foot": "foot",
    }
    for entrada, coluna in campos.items():
        valor = getattr(patch, entrada)
        if valor is None:
            continue
        valor = valor.strip()
        # Nome vazio zeraria a identidade na tela toda; os outros podem
        # legitimamente ser limpos.
        if entrada == "name" and not valor:
            continue
        setattr(user, coluna, valor)

    # Nascimento e Date no banco, texto no contrato. String vazia LIMPA o
    # campo (a pessoa pode ter errado e querer apagar); data invalida e
    # recusada em vez de virar None calado, que pareceria "salvou".
    if patch.birthDate is not None:
        bruto = patch.birthDate.strip()
        if not bruto:
            user.birth_date = None
        else:
            try:
                user.birth_date = date.fromisoformat(bruto)
            except ValueError:
                raise HTTPException(
                    status_code=422,
                    detail="Data de nascimento inválida. Use o formato AAAA-MM-DD.",
                )

    # commit, nao flush: get_db() so fecha a sessao, entao um flush sozinho
    # some no fim do request. A resposta saia com os dados novos e o banco
    # ficava com os antigos — o pior tipo de falha, a que parece sucesso.
    db.commit()
    db.refresh(user)
    stats = _estatisticas(db, user)
    return {
        **_to_session_user(user).model_dump(),
        "stats": stats,
        "esportes": data.ESPORTES,
        "conquistas": _conquistas(stats),
    }


class ExclusaoBody(BaseModel):
    """Confirmacao da exclusao.

    A senha e exigida porque o resto do app confia num token que sobrevive
    dias: celular destravado na mao de outra pessoa, ou aparelho emprestado,
    bastavam dois toques para apagar a conta. Pedir a senha prova que quem
    esta apagando e o dono, e nao quem pegou o telefone.
    """

    senha: str | None = None


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def excluir_conta(
    body: ExclusaoBody | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Exclusao de conta.

    Soft delete, e nao DELETE na linha: reservas, pagamentos e repasses
    apontam para este usuario, e apagar a linha levaria historico financeiro
    da arena junto.

    O e-mail e liberado de proposito. `deleted_at` bloqueia login E cadastro
    (auth.py), entao manter o endereco aqui impediria a pessoa de voltar um
    dia com o mesmo e-mail — exclusao viraria banimento permanente.

    Os dados pessoais saem na mesma transacao: o que sustenta o historico e o
    id, nao o nome nem a foto.
    """
    # ── Quem esta apagando e mesmo o dono? ──────────────────────────────
    #
    # Conta de Google nao tem senha local: exigir uma trancaria essa pessoa
    # fora da propria exclusao. Para ela, o token ja e a prova que o provedor
    # deu.
    if user.password_hash:
        if not body or not (body.senha or "").strip():
            raise HTTPException(
                status_code=422,
                detail="Digite sua senha para confirmar a exclusão.",
            )
        if not verify_password(body.senha, user.password_hash):
            raise HTTPException(status_code=403, detail="Senha incorreta.")

    # ── Ha reserva viva? ────────────────────────────────────────────────
    #
    # Apagar a conta com jogo marcado deixa a arena com um horario ocupado e
    # ninguem para cobrar ou avisar — e a pessoa perde o dinheiro ja pago sem
    # ser avisada de que estava perdendo.
    pendentes = db.execute(
        select(func.count())
        .select_from(Booking)
        .where(Booking.user_id == user.id, Booking.status.in_(ACTIVE_STATUSES))
    ).scalar_one()
    if pendentes:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Você tem {pendentes} reserva(s) em andamento. "
                "Cancele ou conclua antes de excluir a conta."
            ),
        )

    agora = utcnow()
    user.deleted_at = agora
    user.email = f"excluido+{user.id}@qadras.invalid"
    user.name = "Conta excluída"
    user.photo = ""
    user.phone = ""
    user.city = ""

    # Sem isto o access token atual segue valido ate expirar (1h) e a conta
    # "excluida" continuaria respondendo pelas rotas protegidas.
    db.execute(
        update(UserSession)
        .where(UserSession.user_id == user.id, UserSession.revoked_at.is_(None))
        .values(revoked_at=agora)
    )
    db.commit()
    return None


# Compatibilidade: o app antigo chama POST /api/perfil/salvar.
@router.post("/salvar")
def salvar_perfil_legado(
    patch: PerfilPatch,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return salvar_perfil(patch, user, db)
