"""Provedor Asaas — o que da para verificar sem chave e sem rede.

A criacao de cobranca depende da API real e nao e testada aqui (seria teste da
`requests`, nao do nosso codigo). O que se testa e a parte que decide se
dinheiro entrou: a leitura do webhook. E ali que um erro custa caro — mapear
um evento errado confirma reserva sem pagamento, e recusar um evento legitimo
com 4xx derruba a fila do Asaas por 15 falhas seguidas.
"""
import json

import pytest

from app.services.payments.asaas import (
    WEBHOOK_TOKEN_HEADER,
    AsaasError,
    AsaasProvider,
)

SEGREDO = "segredo-de-teste-do-webhook"  # o mesmo do conftest
CABECALHO_OK = {WEBHOOK_TOKEN_HEADER: SEGREDO}


def _evento(nome: str, *, ref="pay_000000000001", valor=116.40, id_evento="evt_1"):
    """Formato real do callback: {id, event, dateCreated, account, payment}."""
    return json.dumps({
        "id": id_evento,
        "event": nome,
        "dateCreated": "2026-08-21 10:00:00",
        "payment": {"id": ref, "value": valor, "status": "RECEIVED"},
    }).encode()


@pytest.fixture()
def provider(monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "asaas_api_key", "chave-de-teste", raising=False)
    monkeypatch.setattr(settings, "asaas_ambiente", "sandbox", raising=False)
    return AsaasProvider()


def test_sem_chave_nao_instancia(monkeypatch):
    """Falhar na construcao e melhor do que no meio de uma reserva."""
    from app.core.config import settings

    monkeypatch.setattr(settings, "asaas_api_key", "  ", raising=False)
    with pytest.raises(AsaasError):
        AsaasProvider()


def test_sandbox_e_o_padrao(provider):
    assert "sandbox" in provider._base


def test_producao_muda_a_url(monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "asaas_api_key", "chave", raising=False)
    monkeypatch.setattr(settings, "asaas_ambiente", "producao", raising=False)
    assert AsaasProvider()._base == "https://api.asaas.com"


@pytest.mark.parametrize("evento", ["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"])
def test_confirmado_e_recebido_ambos_pagam(provider, monkeypatch, evento):
    """No Pix os dois chegam juntos; no cartao CONFIRMED vem antes de RECEIVED.

    Tratar so um deles deixaria metade dos pagamentos pendurados.
    """
    from app.core.config import settings

    monkeypatch.setattr(settings, "payment_webhook_secret", SEGREDO, raising=False)
    r = provider.parse_webhook(CABECALHO_OK, _evento(evento))
    assert r is not None
    assert r.status == "confirmed"
    assert r.provider_ref == "pay_000000000001"
    # 116.40 reais -> 11640 centavos, sem erro de ponto flutuante.
    assert r.amount_cents == 11640


def test_vencido_falha(provider, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "payment_webhook_secret", SEGREDO, raising=False)
    r = provider.parse_webhook(CABECALHO_OK, _evento("PAYMENT_OVERDUE"))
    assert r.status == "failed"


def test_estorno_vira_refunded(provider, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "payment_webhook_secret", SEGREDO, raising=False)
    r = provider.parse_webhook(CABECALHO_OK, _evento("PAYMENT_REFUNDED"))
    assert r.status == "refunded"


def test_evento_irrelevante_e_ignorado_sem_erro(provider, monkeypatch):
    """PAYMENT_CREATED nao move a reserva.

    Precisa devolver None (a rota responde 200/ignored) e NAO levantar: o
    Asaas interrompe a fila depois de 15 respostas nao-2xx seguidas, e ai os
    pagamentos de verdade tambem parariam de chegar.
    """
    from app.core.config import settings

    monkeypatch.setattr(settings, "payment_webhook_secret", SEGREDO, raising=False)
    assert provider.parse_webhook(CABECALHO_OK, _evento("PAYMENT_CREATED")) is None
    assert provider.parse_webhook(CABECALHO_OK, _evento("PAYMENT_SPLIT_DONE")) is None


def test_token_errado_nao_confirma(provider, monkeypatch):
    """Callback forjado por terceiro nao pode mover reserva nenhuma."""
    from app.core.config import settings

    monkeypatch.setattr(settings, "payment_webhook_secret", SEGREDO, raising=False)
    forjado = {WEBHOOK_TOKEN_HEADER: "chute"}
    assert provider.parse_webhook(forjado, _evento("PAYMENT_RECEIVED")) is None
    assert provider.parse_webhook({}, _evento("PAYMENT_RECEIVED")) is None


def test_header_e_case_insensitive(provider, monkeypatch):
    """Servidor HTTP pode entregar o header capitalizado de outro jeito."""
    from app.core.config import settings

    monkeypatch.setattr(settings, "payment_webhook_secret", SEGREDO, raising=False)
    r = provider.parse_webhook({"Asaas-Access-Token": SEGREDO}, _evento("PAYMENT_RECEIVED"))
    assert r is not None and r.status == "confirmed"


def test_corpo_invalido_nao_quebra(provider, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "payment_webhook_secret", SEGREDO, raising=False)
    assert provider.parse_webhook(CABECALHO_OK, b"") is None
    assert provider.parse_webhook(CABECALHO_OK, b"nao e json") is None
    assert provider.parse_webhook(CABECALHO_OK, b'{"event":"PAYMENT_RECEIVED"}') is None


def test_webhook_id_vem_do_evento_e_nao_da_cobranca(provider, monkeypatch):
    """E o que torna o reenvio idempotente.

    O Asaas reenvia o MESMO evento quando nao recebe 2xx. Se a chave de
    idempotencia fosse o id da cobranca, um segundo evento legitimo sobre a
    mesma cobranca (confirmado -> recebido) seria descartado como repeticao.
    """
    from app.core.config import settings

    monkeypatch.setattr(settings, "payment_webhook_secret", SEGREDO, raising=False)
    a = provider.parse_webhook(CABECALHO_OK, _evento("PAYMENT_CONFIRMED", id_evento="evt_a"))
    b = provider.parse_webhook(CABECALHO_OK, _evento("PAYMENT_RECEIVED", id_evento="evt_b"))
    assert a.webhook_id != b.webhook_id
    assert a.provider_ref == b.provider_ref
