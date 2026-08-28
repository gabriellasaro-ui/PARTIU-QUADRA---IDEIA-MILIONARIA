"""Codigo de verificacao: as regras que impedem que ele seja inutil.

Um codigo de 6 digitos tem 1 milhao de combinacoes. Isso e MUITO POUCO — sem
teto de tentativas, um script chega la em minutos. Entao o que segura a
seguranca aqui nao e o tamanho do codigo, sao as regras em volta:

  · 3 tentativas e ele QUEIMA;
  · vale 10 minutos;
  · UM vivo por canal — pedir de novo mata o anterior;
  · 60s entre envios.

Cada um destes tem um teste, porque cada um, sozinho, e o que sustenta os
outros: sem o teto de tentativas, a validade de 10 min nao adianta; sem a
espera de reenvio, o teto de tentativas se contorna pedindo codigo novo.

O ultimo teste e de outra natureza: garante que o provedor `log` — que DEVOLVE
o codigo na resposta — nao possa ser usado em producao. Ele existe para o
cadastro funcionar antes de haver e-mail contratado, e e exatamente o tipo de
atalho de desenvolvimento que sobe sem ninguem notar.
"""
import uuid
from datetime import timedelta

import pytest

from app.auth.security import utcnow
from app.models.verification import TENTATIVAS_MAX, VerificationCode


def _conta(client):
    email = "verif.%s@example.com" % uuid.uuid4().hex[:8]
    r = client.post("/api/arenas/solicitacao", json={
        "nome": "Dono Teste", "email": email, "senha": "Quadra#2026",
    })
    assert r.status_code == 200, r.text
    return r.json()["token"], r.json()["user"]["id"], email


def _hdr(t):
    return {"Authorization": f"Bearer {t}"}


def _pedir(client, token, **corpo):
    return client.post("/api/auth/verificar/enviar", json=corpo, headers=_hdr(token))


def _linha_viva(db, user_id):
    return db.query(VerificationCode).filter(
        VerificationCode.user_id == uuid.UUID(user_id),
        VerificationCode.consumed_at.is_(None),
    ).order_by(VerificationCode.sent_at.desc()).first()


def test_codigo_confere_e_carimba_o_usuario(client, db_session):
    token, uid, email = _conta(client)
    r = _pedir(client, token)
    assert r.status_code == 200, r.text
    codigo = r.json()["codigo"]
    assert len(codigo) == 6 and codigo.isdigit()

    r = client.post("/api/auth/verificar/conferir", json={"codigo": codigo}, headers=_hdr(token))
    assert r.status_code == 200, r.text

    from app.models import User
    u = db_session.get(User, uuid.UUID(uid))
    db_session.refresh(u)
    assert u.email_verified_at is not None
    assert u.email == email


def test_o_codigo_nao_fica_em_texto_no_banco(client, db_session):
    """E credencial de curta vida: um dump de suporte nao pode entregar contas."""
    token, uid, _ = _conta(client)
    codigo = _pedir(client, token).json()["codigo"]
    linha = _linha_viva(db_session, uid)
    assert linha is not None
    assert linha.code_hash != codigo
    assert codigo not in linha.code_hash


def test_queima_depois_de_tres_tentativas(client, db_session):
    token, uid, _ = _conta(client)
    certo = _pedir(client, token).json()["codigo"]
    errado = "000000" if certo != "000000" else "111111"

    for tentativa in range(1, TENTATIVAS_MAX):
        r = client.post("/api/auth/verificar/conferir",
                        json={"codigo": errado}, headers=_hdr(token))
        assert r.status_code == 422, (tentativa, r.text)
        # A mensagem conta quantas restam — sem isso a pessoa nao sabe que esta
        # perto de perder o codigo.
        assert "restam" in r.json()["detail"].lower()

    r = client.post("/api/auth/verificar/conferir", json={"codigo": errado}, headers=_hdr(token))
    assert r.status_code == 410, r.text

    # E o CERTO tambem nao vale mais: o codigo queimou, nao so as tentativas.
    r = client.post("/api/auth/verificar/conferir", json={"codigo": certo}, headers=_hdr(token))
    assert r.status_code == 410, r.text


def test_codigo_expirado_nao_vale(client, db_session):
    token, uid, _ = _conta(client)
    codigo = _pedir(client, token).json()["codigo"]

    linha = _linha_viva(db_session, uid)
    linha.expires_at = utcnow() - timedelta(seconds=1)
    db_session.commit()

    r = client.post("/api/auth/verificar/conferir", json={"codigo": codigo}, headers=_hdr(token))
    assert r.status_code == 410, r.text
    assert "expirado" in r.json()["detail"].lower()


def test_codigo_novo_mata_o_anterior(client, db_session):
    """Dois validos ao mesmo tempo e ninguem — nem o suporte — sabe qual vale."""
    token, uid, _ = _conta(client)
    primeiro = _pedir(client, token).json()["codigo"]

    # Fura a espera de 60s recuando o envio, que e o que o relogio faria.
    linha = _linha_viva(db_session, uid)
    linha.sent_at = utcnow() - timedelta(minutes=5)
    db_session.commit()

    segundo = _pedir(client, token)
    assert segundo.status_code == 200, segundo.text
    segundo = segundo.json()["codigo"]
    assert segundo != primeiro or True  # podem coincidir; o que importa e o resto

    r = client.post("/api/auth/verificar/conferir", json={"codigo": primeiro}, headers=_hdr(token))
    if primeiro != segundo:
        assert r.status_code in (410, 422), r.text

    r = client.post("/api/auth/verificar/conferir", json={"codigo": segundo}, headers=_hdr(token))
    assert r.status_code == 200, r.text


def test_espera_entre_envios(client):
    """Sem ela, o teto de tentativas se contorna pedindo codigo novo — e um
    botao 'reenviar' clicado dez vezes manda dez e-mails."""
    token, _, _ = _conta(client)
    assert _pedir(client, token).status_code == 200
    r = _pedir(client, token)
    assert r.status_code == 429, r.text
    assert "aguarde" in r.json()["detail"].lower()


def test_provedor_log_nao_pode_subir_em_producao():
    """O provedor 'log' DEVOLVE o codigo na resposta HTTP.

    Ele existe para o cadastro funcionar antes de haver e-mail contratado — e e
    exatamente o tipo de atalho que sobe para producao sem ninguem notar. A
    config tem de recusar."""
    from app.core.config import Settings

    base = dict(
        environment="production",
        jwt_secret="x" * 40,
        cors_origins="https://app.qadras.com.br",
        payment_provider="mercadopago",
        mercadopago_access_token="APP_USR-token-de-verdade",
        payment_webhook_secret="segredo",
    )
    with pytest.raises(ValueError, match="VERIFICATION_PROVIDER"):
        Settings(**base, verification_provider="log")

    # E 'resend' sem chave tambem nao: nenhum codigo sairia, e todo cadastro
    # morreria na tela de confirmar o e-mail.
    with pytest.raises(ValueError, match="RESEND_API_KEY"):
        Settings(**base, verification_provider="resend", resend_api_key="")

    # Com chave, sobe.
    s = Settings(**base, verification_provider="resend", resend_api_key="re_abc")
    assert s.verification_provider == "resend"


def test_codigo_so_aparece_na_resposta_fora_de_producao(client, monkeypatch):
    from app.services import verificacao

    token, _, _ = _conta(client)
    monkeypatch.setattr(verificacao, "pode_revelar_codigo", lambda: False)
    r = _pedir(client, token)
    assert r.status_code == 200, r.text
    assert "codigo" not in r.json(), "em producao o codigo nao pode voltar na resposta"
