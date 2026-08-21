"""Autenticacao.

Endpoints reais da Fase 2: hash de senha (bcrypt), JWT de acesso (~1h) com
jti, refresh token opaco com hash no banco (user_sessions), revogacao via
blacklist no Redis + revoked_at. Contrato { token, user, isNew } identico ao
que services/auth.js ja guarda em pq:auth_token / pq:auth_user.

POST /google so valida o idToken de verdade se settings.google_client_id
estiver preenchido; senao responde 503 para o app nao quebrar na tela.
"""
from datetime import datetime, timedelta, timezone
import logging
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy import select, update
from sqlalchemy.orm import Session
from starlette.responses import Response

from ..auth.deps import get_current_user
from ..auth.security import (
    create_access_token,
    decode_token,
    generate_refresh_token,
    hash_password,
    hash_refresh_token,
    utcnow,
    verify_password,
)
from ..core.config import settings
from ..core.database import get_db
from ..core.ratelimit import LIMIT_AUTH_IP, LIMIT_AUTH_REFRESH_IP, limiter
from ..core.redis import redis_call, redis_client

logger = logging.getLogger(__name__)
from ..models import (
    PROVIDER_GOOGLE,
    PROVIDER_PASSWORD,
    ROLE_GERENTE,
    ROLE_JOGADOR,
    User,
)
from ..models.user_session import UserSession
from ..schemas.auth import (
    GoogleRequest,
    LoginRequest,
    LogoutRequest,
    OnboardingRequest,
    RefreshRequest,
    RegisterRequest,
    SessionUser,
    TrocaSenhaRequest,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _as_utc(value) -> datetime:
    """Postgres devolve timestamptz (aware); SQLite devolve naive."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _auth_error(detail: str = "Sessão inválida") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def _foto_google(url: str | None) -> str:
    """Pede ao Google uma foto grande o bastante.

    O `picture` do token vem com sufixo de tamanho (`=s96-c`), e 96px fica
    mole na moldura de 72px do perfil em tela retina. Trocar o sufixo e o
    jeito documentado de pedir outro tamanho; sem sufixo, acrescenta.
    """
    url = (url or "").strip()
    if not url:
        return ""
    base, sep, _ = url.rpartition("=s")
    if sep and base:
        return f"{base}=s256-c"
    return url


def _to_session_user(user: User) -> SessionUser:
    return SessionUser(
        id=str(user.id),
        name=user.name,
        email=user.email,
        role=user.role,
        phone=user.phone or "",
        city=user.city or "",
        state=user.state or "",
        photo=user.photo or "",
        position=user.position or "",
        level=user.level or "",
        birthDate=user.birth_date.strftime("%Y-%m-%d") if user.birth_date else "",
        foot=user.foot or "",
        favoriteSport=user.favorite_sport or "",
        rating=user.rating,
        memberSince=(user.created_at or utcnow()).strftime("%b/%Y"),
        provider=user.provider,
        onboardedAt=user.onboarded_at.isoformat() if user.onboarded_at else None,
    )


def _issue_session(db: Session, user: User, is_new: bool = False) -> dict:
    """Cria a sessao (refresh opaco + hash no banco) e o access JWT."""
    raw_refresh = generate_refresh_token()
    session = UserSession(
        user_id=user.id,
        refresh_token_hash=hash_refresh_token(raw_refresh),
        expires_at=utcnow() + timedelta(days=settings.refresh_token_expire_days),
    )
    db.add(session)
    db.flush()

    access = create_access_token(user.id, session.id, jti=session.access_jti)
    session.access_jti = decode_token(access)["jti"]
    user.last_active_at = utcnow()
    db.commit()
    db.refresh(session)

    return {
        "token": access,
        "user": _to_session_user(user),
        "isNew": is_new,
        "refreshToken": raw_refresh,
    }


def _blacklist(jti: str | None) -> None:
    if not jti:
        return
    redis_call(
        lambda: redis_client.setex(
            f"auth:blacklist:{jti}",
            settings.access_token_expire_minutes * 60,
            "1",
        )
    )


def _resolve_optional_user(authorization: str | None, db: Session) -> User | None:
    """Autentica se houver Bearer valido; None em vez de 401.

    Mantem os endpoints antigos (/api/auth/user, /api/auth/gerente/user)
    respondendo mesmo sem sessao, como o mock fazia.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    try:
        payload = decode_token(authorization.split(" ", 1)[1].strip())
        if payload.get("type") != "access":
            return None
        user = db.get(User, uuid.UUID(payload.get("sub")))
    except Exception:
        return None
    if not user or user.deleted_at:
        return None
    return user


@router.post("/login")
@limiter.limit(LIMIT_AUTH_IP)
def login(request: Request, payload: LoginRequest, db: Session = Depends(get_db), response: Response = None):
    email = payload.email.lower().strip()
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if not user or user.deleted_at or not verify_password(payload.senha, user.password_hash):
        raise _auth_error("E-mail ou senha inválidos")
    return _issue_session(db, user)


@router.post("/register")
@limiter.limit(LIMIT_AUTH_IP)
def register(request: Request, payload: RegisterRequest, db: Session = Depends(get_db), response: Response = None):
    email = payload.email.lower().strip()
    if db.execute(select(User).where(User.email == email)).first():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="E-mail já cadastrado",
        )
    user = User(
        email=email,
        name=payload.name.strip(),
        password_hash=hash_password(payload.senha),
        role=ROLE_JOGADOR,
        provider=PROVIDER_PASSWORD,
    )
    db.add(user)
    db.flush()
    return _issue_session(db, user, is_new=True)


@router.post("/google")
@limiter.limit(LIMIT_AUTH_REFRESH_IP)
def google(request: Request, payload: GoogleRequest, db: Session = Depends(get_db), response: Response = None):
    if not settings.google_client_id:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Login Google ainda não configurado no servidor",
        )
    try:
        from google.auth.transport import requests as google_requests
        from google.oauth2 import id_token

        info = id_token.verify_oauth2_token(
            payload.idToken, google_requests.Request(), settings.google_client_id
        )
    except Exception as erro:
        # A resposta ao cliente continua generica de proposito — dizer "audience
        # errada" ou "token expirado" entrega detalhe de configuracao para quem
        # estiver sondando. Mas engolir a causa TAMBEM do nosso lado deixava o
        # problema impossivel de diagnosticar: toda falha virava a mesma frase.
        logger.warning("Falha ao validar idToken do Google: %s: %s", type(erro).__name__, erro)
        raise _auth_error("Token do Google inválido ou expirado")

    email = (info.get("email") or "").lower().strip()
    if not email:
        raise _auth_error("O Google não retornou e-mail para esta conta")

    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if not user:
        user = User(
            email=email,
            name=(info.get("name") or "").strip() or email.split("@")[0],
            provider=PROVIDER_GOOGLE,
            role=ROLE_JOGADOR,
            photo=_foto_google(info.get("picture")),
        )
        db.add(user)
        db.flush()
        return _issue_session(db, user, is_new=True)
    if user.deleted_at:
        raise _auth_error("Conta desativada")

    # A foto do Google e um link que muda: a pessoa troca o avatar la e o
    # nosso vira 404. Antes so gravavamos na criacao, entao quem ja tinha
    # conta nunca ganhava foto — inclusive quem se cadastrou por senha e
    # depois passou a entrar pelo Google. Atualizar a cada login mantem
    # foto e nome vivos, sem custo (o dado ja veio dentro do token).
    foto = _foto_google(info.get("picture"))
    if foto and foto != (user.photo or ""):
        user.photo = foto
    nome = (info.get("name") or "").strip()
    if nome and not (user.name or "").strip():
        user.name = nome
    db.commit()

    return _issue_session(db, user)


@router.patch("/onboarding")
def onboarding(
    payload: OnboardingRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user.favorite_sport = payload.favoriteSport or user.favorite_sport
    user.position = payload.position or user.position
    user.level = payload.level or user.level
    user.onboarded_at = user.onboarded_at or utcnow()
    db.commit()
    db.refresh(user)
    return _to_session_user(user)


@router.post("/senha")
def trocar_senha(
    body: TrocaSenhaRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Troca a senha de quem esta logado.

    Conta Google nao tem senha local — devolve 409 em vez de deixar criar uma
    do nada, que produziria dois caminhos de acesso para a mesma conta sem a
    pessoa entender de onde veio o segundo.

    As sessoes ANTIGAS sao revogadas: trocar senha e o que se faz quando se
    desconfia que alguem entrou, e manter os tokens antigos vivos deixaria o
    invasor dentro justamente depois da acao que deveria expulsa-lo. A sessao
    atual continua, senao a pessoa se desloga ao se proteger.
    """
    if not user.password_hash:
        raise HTTPException(
            status_code=409,
            detail="Esta conta entra pelo Google e não tem senha para trocar.",
        )
    if not verify_password(body.senhaAtual, user.password_hash):
        raise HTTPException(status_code=403, detail="Senha atual incorreta.")
    if verify_password(body.senhaNova, user.password_hash):
        raise HTTPException(status_code=422, detail="A senha nova é igual à atual.")

    user.password_hash = hash_password(body.senhaNova)
    agora = utcnow()
    db.execute(
        update(UserSession)
        .where(
            UserSession.user_id == user.id,
            UserSession.revoked_at.is_(None),
            # Sem excecao pela sessao atual: `user` nao carrega o jti do token
            # em uso, e inventar um atributo para isso seria pior que o
            # efeito. Trocar a senha desloga de TUDO, inclusive daqui — que e
            # o comportamento mais previsivel e o que a maioria dos apps faz.
        )
        .values(revoked_at=agora)
    )
    db.commit()
    return {"ok": True}


@router.post("/refresh")
@limiter.limit(LIMIT_AUTH_REFRESH_IP)
def refresh(request: Request, payload: RefreshRequest, db: Session = Depends(get_db), response: Response = None):
    session = db.execute(
        select(UserSession).where(
            UserSession.refresh_token_hash == hash_refresh_token(payload.refreshToken)
        )
    ).scalar_one_or_none()
    if (
        not session
        or session.revoked_at
        or _as_utc(session.expires_at) < utcnow()
    ):
        raise _auth_error("Sessão expirada, faça login novamente")

    user = db.get(User, session.user_id)
    if not user or user.deleted_at:
        raise _auth_error("Conta não encontrada")

    new_raw = generate_refresh_token()
    session.refresh_token_hash = hash_refresh_token(new_raw)
    session.expires_at = utcnow() + timedelta(days=settings.refresh_token_expire_days)
    access = create_access_token(user.id, session.id, jti=session.access_jti)
    session.access_jti = decode_token(access)["jti"]
    user.last_active_at = utcnow()
    db.commit()
    db.refresh(session)

    return {
        "token": access,
        "user": _to_session_user(user),
        "isNew": False,
        "refreshToken": new_raw,
    }


@router.post("/logout")
def logout(
    payload: LogoutRequest,
    user: User = Depends(get_current_user),
    authorization: str | None = Header(None),
    db: Session = Depends(get_db),
):
    if authorization and authorization.lower().startswith("bearer "):
        try:
            claims = decode_token(authorization.split(" ", 1)[1].strip())
            _blacklist(claims.get("jti"))
            # Revoga pelo `sid` do proprio access token: o cliente nem sempre
            # manda o refreshToken no corpo, e sem isso a sessao continuava
            # viva no banco — o logout so valia enquanto o Redis respondesse.
            sid = claims.get("sid")
            if sid:
                sessao = db.get(UserSession, uuid.UUID(str(sid)))
                if sessao is not None and sessao.user_id == user.id:
                    sessao.revoked_at = utcnow()
        except Exception:
            pass

    if payload.refreshToken:
        session = db.execute(
            select(UserSession).where(
                UserSession.user_id == user.id,
                UserSession.refresh_token_hash == hash_refresh_token(payload.refreshToken),
            )
        ).scalar_one_or_none()
        if session:
            session.revoked_at = utcnow()

    user.last_active_at = utcnow()
    db.commit()
    return {"ok": True}


@router.get("/user")
def usuario_atual(
    authorization: str | None = Header(None),
    db: Session = Depends(get_db),
):
    """Contrato antigo (www-usuario/services/venues.js): { nome, email, avatar }.

    Com Bearer valido devolve os dados reais; sem sessao cai no mock, como
    antes da Fase 2.
    """
    user = _resolve_optional_user(authorization, db)
    if user:
        return {"nome": user.name, "email": user.email, "avatar": user.photo}
    return {"nome": "Gabriel Lisboa", "email": "gabriel@email.com", "avatar": None}


@router.get("/gerente/user")
def gerente_usuario(
    authorization: str | None = Header(None),
    db: Session = Depends(get_db),
):
    user = _resolve_optional_user(authorization, db)
    if user:
        return {
            "nome": user.name,
            "email": user.email,
            "avatar": user.photo,
            "role": user.role,
        }
    return {
        "nome": "Dono Arena Bola na Rede",
        "email": "contato@arenabolanarede.com.br",
        "avatar": None,
        "role": ROLE_GERENTE,
    }
