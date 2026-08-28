"""Verificacao de contato por codigo — geracao, conferencia e entrega.

O QUE ESTE ARQUIVO GARANTE, e por que cada regra existe:

  · o codigo vive 10 min. Mais que isso e tempo para adivinhar; menos nao da
    para abrir o e-mail;
  · UM codigo vivo por canal. Pedir de novo mata o anterior — com dois validos
    ao mesmo tempo, ninguem (nem o suporte) sabe qual vale;
  · 3 tentativas e o codigo QUEIMA. Sem teto, 6 digitos caem em forca bruta em
    minutos;
  · 60s entre envios. Protege a caixa de quem recebe e o nosso custo — um botao
    "reenviar" clicado dez vezes mandaria dez e-mails;
  · comparacao em tempo constante. Comparar string com `==` vaza, pelo tempo,
    quantos digitos batem.

A ENTREGA e plugavel, no mesmo desenho de `services/payments`: hoje existe o
provedor `log` (dev) e `resend` (producao). Trocar e variavel de ambiente, nao
codigo.

O provedor `log` devolve o codigo na resposta HTTP — e SO fora de producao. Em
producao isso seria entregar a chave a quem pedir; a guarda esta em
`pode_revelar_codigo()` e ha teste em cima dela.
"""
import hashlib
import logging
import secrets
from datetime import timedelta

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth.security import utcnow
from ..core.config import settings
from ..models.verification import (
    CANAIS,
    CANAL_EMAIL,
    ESPERA_REENVIO_S,
    TENTATIVAS_MAX,
    VALIDADE_MINUTOS,
    VerificationCode,
)

logger = logging.getLogger(__name__)

DIGITOS = 6


def _hash(codigo: str) -> str:
    """SHA-256 com o segredo do app como tempero.

    Nao e bcrypt de proposito: 6 digitos tem 1 milhao de combinacoes, entao
    nenhum hash impede quem tem o banco de testar todas. O que o hash resolve e
    outro problema — o codigo nao fica em texto num backup ou num dump de
    suporte. Bcrypt aqui so custaria 100ms por conferencia sem ganho real.
    """
    return hashlib.sha256((settings.jwt_secret + ":" + codigo).encode()).hexdigest()


def gerar_codigo() -> str:
    """`secrets`, e nao `random`: o segundo e previsivel a partir de saidas."""
    return "".join(secrets.choice("0123456789") for _ in range(DIGITOS))


def pode_revelar_codigo() -> bool:
    """Devolver o codigo na resposta so vale fora de producao."""
    return settings.environment.strip().lower() != "production"


# ── Entrega ────────────────────────────────────────────────────────────────

def _entregar_log(destino: str, codigo: str, canal: str) -> None:
    """Dev: escreve no log do servidor. Nada sai da maquina."""
    logger.warning("[verificacao] %s -> %s | codigo %s", canal, destino, codigo)


def _entregar_resend(destino: str, codigo: str, canal: str) -> None:
    import httpx

    chave = settings.resend_api_key.strip()
    if not chave:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Envio de e-mail não configurado no servidor",
        )
    resposta = httpx.post(
        "https://api.resend.com/emails",
        headers={"Authorization": f"Bearer {chave}"},
        json={
            "from": settings.email_remetente,
            "to": [destino],
            "subject": f"{codigo} é seu código do Qadras",
            # O codigo no ASSUNTO tambem: quem esta no celular le a
            # notificacao e digita sem abrir o e-mail.
            "text": (
                f"Seu código de verificação é {codigo}.\n\n"
                f"Ele vale por {VALIDADE_MINUTOS} minutos. "
                "Se não foi você que pediu, ignore este e-mail."
            ),
        },
        timeout=10.0,
    )
    if resposta.status_code >= 300:
        logger.error("Resend recusou o envio: %s %s", resposta.status_code, resposta.text[:200])
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Não foi possível enviar o código agora. Tente de novo.",
        )


_ENTREGADORES = {"log": _entregar_log, "resend": _entregar_resend}


def _entregar(destino: str, codigo: str, canal: str) -> None:
    nome = (settings.verification_provider or "log").strip().lower()
    entregador = _ENTREGADORES.get(nome)
    if not entregador:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Provedor de verificação desconhecido: {nome}",
        )
    entregador(destino, codigo, canal)


# ── Fluxo ──────────────────────────────────────────────────────────────────

def _vivo(db: Session, user_id, canal: str) -> VerificationCode | None:
    """O codigo ainda utilizavel deste usuario neste canal."""
    agora = utcnow()
    linhas = db.execute(
        select(VerificationCode)
        .where(
            VerificationCode.user_id == user_id,
            VerificationCode.channel == canal,
            VerificationCode.consumed_at.is_(None),
        )
        .order_by(VerificationCode.sent_at.desc())
    ).scalars().all()
    for linha in linhas:
        expira = linha.expires_at
        if expira is not None and expira.tzinfo is None:
            from datetime import timezone
            expira = expira.replace(tzinfo=timezone.utc)
        if expira and expira > agora and linha.attempts < TENTATIVAS_MAX:
            return linha
    return None


def solicitar(db: Session, user, destino: str, canal: str = CANAL_EMAIL) -> dict:
    if canal not in CANAIS:
        raise HTTPException(status_code=422, detail="Canal de verificação inválido")
    destino = (destino or "").strip().lower()
    if not destino:
        raise HTTPException(status_code=422, detail="Informe para onde enviar o código")

    agora = utcnow()

    # Espera entre envios, medida sobre o ULTIMO envio deste canal — inclusive
    # os ja consumidos, senao confirmar e pedir de novo pula a espera.
    ultimo = db.execute(
        select(VerificationCode)
        .where(VerificationCode.user_id == user.id, VerificationCode.channel == canal)
        .order_by(VerificationCode.sent_at.desc())
        .limit(1)
    ).scalar_one_or_none()
    if ultimo is not None and ultimo.sent_at is not None:
        enviado = ultimo.sent_at
        if enviado.tzinfo is None:
            from datetime import timezone
            enviado = enviado.replace(tzinfo=timezone.utc)
        faltam = ESPERA_REENVIO_S - int((agora - enviado).total_seconds())
        if faltam > 0:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Aguarde {faltam}s para pedir um novo código.",
            )

    # UM codigo vivo por canal: o anterior morre agora.
    for antigo in db.execute(
        select(VerificationCode).where(
            VerificationCode.user_id == user.id,
            VerificationCode.channel == canal,
            VerificationCode.consumed_at.is_(None),
        )
    ).scalars().all():
        antigo.consumed_at = agora

    codigo = gerar_codigo()
    linha = VerificationCode(
        user_id=user.id,
        channel=canal,
        destination=destino,
        code_hash=_hash(codigo),
        expires_at=agora + timedelta(minutes=VALIDADE_MINUTOS),
        sent_at=agora,
    )
    db.add(linha)

    # Entrega ANTES do commit: se o provedor recusar, a linha nao fica no banco
    # ocupando a espera de 60s de um codigo que ninguem recebeu.
    _entregar(destino, codigo, canal)
    db.commit()

    resposta = {"enviado": True, "canal": canal, "destino": destino,
                "expiraEm": VALIDADE_MINUTOS * 60, "reenviarEm": ESPERA_REENVIO_S}
    if pode_revelar_codigo():
        resposta["codigo"] = codigo
    return resposta


def conferir(db: Session, user, codigo: str, canal: str = CANAL_EMAIL) -> dict:
    codigo = (codigo or "").strip()
    linha = _vivo(db, user.id, canal)
    if linha is None:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Código expirado ou já usado. Peça um novo.",
        )

    # `compare_digest` e nao `==`: a comparacao byte a byte para no primeiro
    # caractere diferente, e o tempo disso conta quantos digitos bateram.
    if not secrets.compare_digest(linha.code_hash, _hash(codigo)):
        linha.attempts += 1
        restantes = TENTATIVAS_MAX - linha.attempts
        db.commit()
        if restantes <= 0:
            raise HTTPException(
                status_code=status.HTTP_410_GONE,
                detail="Código bloqueado por tentativas. Peça um novo.",
            )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Código incorreto. Restam {restantes} tentativa(s).",
        )

    agora = utcnow()
    linha.consumed_at = agora
    if canal == CANAL_EMAIL:
        # Carimba no USUARIO o e-mail que foi de fato verificado. Se ele trocou
        # o e-mail depois de pedir o codigo, o destino guardado e quem manda —
        # senao um codigo enviado ao endereco antigo validaria o novo.
        user.email = linha.destination
        user.email_verified_at = agora
    else:
        user.phone_verified_at = agora
    db.commit()
    return {"verificado": True, "canal": canal, "destino": linha.destination}
