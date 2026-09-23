"""Provedor Mercado Pago — o que da para verificar sem conta e sem rede.

A criacao de cobranca contra a API real nao e testada aqui (seria teste da
`requests`, nao do nosso codigo). O que se testa e a parte que decide se
dinheiro entrou: assinatura do webhook e leitura do status.

A assinatura e calculada de verdade nos testes, e nao copiada de uma fixture:
fixture so provaria que o valor bate consigo mesmo. Aqui o manifesto e montado
de forma independente, seguindo a documentacao, e comparado com o que o
provedor produz.
"""
import hashlib
import hmac
import json

import pytest

from app.services.payments.mercadopago import (
    MercadoPagoError,
    MercadoPagoProvider,
)

SEGREDO = "segredo-de-teste-do-webhook"  # o mesmo do conftest
TS = "1704908010"
REQUEST_ID = "req-abc-123"


def _assina(id_pagamento: str, *, segredo=SEGREDO, ts=TS, request_id=REQUEST_ID) -> dict:
    """Monta o header x-signature como o Mercado Pago monta.

    Manifesto documentado: id:{data.id};request-id:{x-request-id};ts:{ts};
    """
    manifesto = f"id:{id_pagamento.lower()};request-id:{request_id};ts:{ts};"
    v1 = hmac.new(segredo.encode(), manifesto.encode(), hashlib.sha256).hexdigest()
    return {"x-signature": f"ts={ts},v1={v1}", "x-request-id": request_id}


def _notificacao(id_pagamento="1234567890"):
    return json.dumps({
        "action": "payment.updated",
        "type": "payment",
        "data": {"id": id_pagamento},
    }).encode()


@pytest.fixture()
def provider(monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(
        settings, "mercadopago_access_token", "TEST-token-de-teste", raising=False
    )
    monkeypatch.setattr(settings, "payment_webhook_secret", SEGREDO, raising=False)
    return MercadoPagoProvider()


def _responde_status(provider, monkeypatch, status, valor=116.40):
    """Substitui a consulta a API pelo status desejado."""
    def falso(metodo, caminho, corpo=None, *, idempotencia=None):
        assert metodo == "GET" and caminho.startswith("/v1/payments/")
        return {"status": status, "transaction_amount": valor, "external_reference": "PQ-1"}

    monkeypatch.setattr(provider, "_chamar", falso)


def test_sem_token_nao_instancia(monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "mercadopago_access_token", "  ", raising=False)
    with pytest.raises(MercadoPagoError):
        MercadoPagoProvider()


def test_cartao_e_recusado_com_motivo(provider):
    """Cartao exige tokenizacao no navegador; o numero nao pode chegar aqui."""
    class _Booking:
        payment_method = "card"
        code = "PQ-1"
        client_email = "a@b.c"
        client_name = "Ana"

    with pytest.raises(MercadoPagoError, match="[Cc]artao"):
        provider.create_payment(booking=_Booking(), amounts={"total_cents": 11640})


def test_aprovado_confirma(provider, monkeypatch):
    _responde_status(provider, monkeypatch, "approved")
    r = provider.parse_webhook(_assina("1234567890"), _notificacao(), {"data.id": "1234567890"})
    assert r is not None
    assert r.status == "confirmed"
    assert r.provider_ref == "1234567890"
    # 116.40 reais -> 11640 centavos, sem erro de ponto flutuante.
    assert r.amount_cents == 11640


@pytest.mark.parametrize("situacao,esperado", [
    ("rejected", "failed"),
    ("cancelled", "failed"),
    ("refunded", "refunded"),
    ("charged_back", "refunded"),
])
def test_mapeamento_de_status(provider, monkeypatch, situacao, esperado):
    _responde_status(provider, monkeypatch, situacao)
    r = provider.parse_webhook(_assina("1"), _notificacao("1"), {"data.id": "1"})
    assert r.status == esperado


@pytest.mark.parametrize("situacao", ["pending", "in_process", "authorized"])
def test_status_intermediario_nao_move_a_reserva(provider, monkeypatch, situacao):
    """A reserva ja esta aguardando pagamento; notificar isso de novo e ruido."""
    _responde_status(provider, monkeypatch, situacao)
    assert provider.parse_webhook(_assina("1"), _notificacao("1"), {"data.id": "1"}) is None


def test_status_vem_da_API_e_nao_do_corpo(provider, monkeypatch):
    """O corpo da notificacao e publico: quem POSTa controla o que escreve.

    Mesmo mandando "status": "approved" no corpo, quem decide e a consulta.
    """
    _responde_status(provider, monkeypatch, "rejected")
    corpo = json.dumps({
        "type": "payment", "data": {"id": "1"}, "status": "approved",
    }).encode()
    r = provider.parse_webhook(_assina("1"), corpo, {"data.id": "1"})
    assert r.status == "failed"


def test_assinatura_forjada_nao_confirma(provider, monkeypatch):
    _responde_status(provider, monkeypatch, "approved")
    forjada = {"x-signature": "ts=1704908010,v1=" + "0" * 64, "x-request-id": REQUEST_ID}
    assert provider.parse_webhook(forjada, _notificacao(), {"data.id": "1234567890"}) is None


def test_assinatura_de_outro_segredo_nao_confirma(provider, monkeypatch):
    _responde_status(provider, monkeypatch, "approved")
    outra = _assina("1234567890", segredo="segredo-errado")
    assert provider.parse_webhook(outra, _notificacao(), {"data.id": "1234567890"}) is None


def test_sem_header_de_assinatura_nao_confirma(provider, monkeypatch):
    _responde_status(provider, monkeypatch, "approved")
    assert provider.parse_webhook({}, _notificacao(), {"data.id": "1234567890"}) is None


def test_id_em_maiusculas_ainda_valida(provider, monkeypatch):
    """O Mercado Pago as vezes entrega o id em maiusculas e assina a versao
    minuscula. Sem normalizar, o hash nunca bate — e falha SO em producao,
    onde os ids tem letras."""
    _responde_status(provider, monkeypatch, "approved")
    ident = "ABC123def"
    # assinado em minusculas (como o MP faz), recebido em maiusculas
    r = provider.parse_webhook(_assina(ident), _notificacao(ident), {"data.id": ident})
    assert r is not None and r.status == "confirmed"


def test_ts_trocado_invalida(provider, monkeypatch):
    """O ts entra no manifesto: mexer nele sem reassinar quebra a conferencia."""
    _responde_status(provider, monkeypatch, "approved")
    h = _assina("1")
    h["x-signature"] = h["x-signature"].replace(f"ts={TS}", "ts=9999999999")
    assert provider.parse_webhook(h, _notificacao("1"), {"data.id": "1"}) is None


def test_query_ausente_cai_para_o_corpo(provider, monkeypatch):
    """O data.id chega nos dois lugares; sem a query, o corpo serve."""
    _responde_status(provider, monkeypatch, "approved")
    r = provider.parse_webhook(_assina("1234567890"), _notificacao(), None)
    assert r is not None and r.status == "confirmed"


def test_notificacao_de_outro_tipo_e_ignorada(provider, monkeypatch):
    _responde_status(provider, monkeypatch, "approved")
    corpo = json.dumps({"type": "merchant_order", "data": {"id": "1"}}).encode()
    assert provider.parse_webhook(_assina("1"), corpo, {"data.id": "1"}) is None


def test_corpo_invalido_nao_quebra(provider):
    assert provider.parse_webhook(_assina("1"), b"", {"data.id": "1"}) is None
    assert provider.parse_webhook(_assina("1"), b"nao e json", {"data.id": "1"}) is None


def test_idempotencia_distingue_mudanca_de_status(provider, monkeypatch):
    """O Mercado Pago reenvia a MESMA notificacao ate receber 2xx, e manda
    novas a cada mudanca. Se a chave fosse so o id do pagamento, a aprovacao
    seria descartada como repeticao do 'pendente' — e a reserva ficaria presa.
    """
    _responde_status(provider, monkeypatch, "approved")
    a = provider.parse_webhook(_assina("77"), _notificacao("77"), {"data.id": "77"})
    _responde_status(provider, monkeypatch, "refunded")
    b = provider.parse_webhook(_assina("77"), _notificacao("77"), {"data.id": "77"})
    assert a.webhook_id != b.webhook_id
    assert a.provider_ref == b.provider_ref == "77"

    # E o reenvio do mesmo evento continua com a mesma chave.
    _responde_status(provider, monkeypatch, "approved")
    a2 = provider.parse_webhook(_assina("77"), _notificacao("77"), {"data.id": "77"})
    assert a2.webhook_id == a.webhook_id


def test_date_of_expiration_vai_em_milissegundos(provider, monkeypatch):
    """O Mercado Pago recusa microssegundos — e o erro dele nao diz o campo.

    `isoformat()` cru gera 6 casas decimais. O MP responde 500 (nao 400), sem
    apontar `date_of_expiration`, entao o sintoma em producao era "nao foi
    possivel carregar" na tela de pagamento e nada mais. Este teste trava o
    formato para que a regressao nao volte silenciosa.
    """
    import re
    from types import SimpleNamespace

    capturado = {}

    def _falso_chamar(metodo, caminho, corpo=None, *, idempotencia=None):
        capturado.update(corpo or {})
        return {"id": "123", "status": "pending", "point_of_interaction": {}}

    monkeypatch.setattr(provider, "_chamar", _falso_chamar)
    booking = SimpleNamespace(
        payment_method="pix", code="PQ-1", client_email=None, client_name=None
    )
    provider.create_payment(booking=booking, amounts={"total_cents": 10_989})

    data = capturado["date_of_expiration"]
    # Exatamente 3 casas decimais, e offset de fuso presente.
    assert re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$", data), data


def test_application_fee_entra_no_corpo_quando_informado(provider, monkeypatch):
    """Sem isto a Qadras nao retem nada: o MP so divide se o campo for."""
    from types import SimpleNamespace

    capturado = {}

    def _falso_chamar(metodo, caminho, corpo=None, *, idempotencia=None):
        capturado.update(corpo or {})
        return {"id": "123", "status": "pending", "point_of_interaction": {}}

    monkeypatch.setattr(provider, "_chamar", _falso_chamar)
    booking = SimpleNamespace(
        payment_method="pix", code="PQ-2", client_email=None, client_name=None
    )
    provider.create_payment(
        booking=booking,
        amounts={"total_cents": 10_989, "application_fee_cents": 1_180},
    )
    # Em REAIS decimais, como o MP espera — nao em centavos.
    assert capturado["application_fee"] == 11.80


def test_sem_application_fee_o_campo_nao_vai(provider, monkeypatch):
    """Conta unica (sem split) nao pode mandar o campo — o MP recusaria."""
    from types import SimpleNamespace

    capturado = {}

    def _falso_chamar(metodo, caminho, corpo=None, *, idempotencia=None):
        capturado.update(corpo or {})
        return {"id": "123", "status": "pending", "point_of_interaction": {}}

    monkeypatch.setattr(provider, "_chamar", _falso_chamar)
    booking = SimpleNamespace(
        payment_method="pix", code="PQ-3", client_email=None, client_name=None
    )
    provider.create_payment(booking=booking, amounts={"total_cents": 10_989})
    assert "application_fee" not in capturado
