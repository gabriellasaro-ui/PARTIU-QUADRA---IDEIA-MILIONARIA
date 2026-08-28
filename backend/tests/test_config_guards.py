"""Testes das guardas de produção em Settings (Fase 12).

Valida que o model_validator impede subir a API com JWT_SECRET fraco ou
CORS aberto quando ENVIRONMENT=production.
"""
import pytest
from pydantic import ValidationError


def test_guard_rejects_weak_secret():
    from app.core.config import Settings

    with pytest.raises(ValidationError):
        Settings(environment="production", jwt_secret="change-me", cors_origins="https://app.qadras.com.br")


def test_guard_rejects_short_secret():
    from app.core.config import Settings

    with pytest.raises(ValidationError):
        Settings(environment="production", jwt_secret="curto", cors_origins="https://app.qadras.com.br")


def test_guard_rejects_wildcard_cors():
    from app.core.config import Settings

    with pytest.raises(ValidationError):
        Settings(
            environment="production",
            jwt_secret="a-32-char-test-secret-0123456789abcdef-xyz",
            cors_origins="*",
        )


def test_guard_rejects_mock_payment_provider():
    """O mock confirma cobranca sem dinheiro entrar — nao pode ir ao ar."""
    from app.core.config import Settings

    with pytest.raises(ValidationError):
        Settings(
            environment="production",
            jwt_secret="a-32-char-test-secret-0123456789abcdef-xyz",
            cors_origins="https://app.qadras.com.br",
            payment_provider="mock",
        )


def _producao_valida(**extra):
    """Producao completa. Sem token, com token de TESTE ou sem segredo de
    webhook nao e producao valida — cada um tem guarda propria abaixo."""
    from app.core.config import Settings

    base = dict(
        environment="production",
        jwt_secret="a-32-char-test-secret-0123456789abcdef-xyz",
        cors_origins="https://app.qadras.com.br,https://gerente.qadras.com.br",
        payment_provider="mercadopago",
        mercadopago_access_token="APP_USR-token-de-producao",
        payment_webhook_secret="segredo-do-webhook",
        # Producao valida passou a exigir tambem o envio real do codigo de
        # verificacao: o provedor "log" DEVOLVE o codigo na resposta HTTP, o
        # que anula a verificacao inteira. A guarda esta em
        # core/config.py e tem teste proprio em test_verificacao.py.
        verification_provider="resend",
        resend_api_key="re_chave-de-teste",
    )
    base.update(extra)
    return Settings(**base)


def test_guard_allows_valid_production():
    s = _producao_valida()
    assert s.environment == "production"
    assert s.cors_origin_list == ["https://app.qadras.com.br", "https://gerente.qadras.com.br"]


def test_mercadopago_sem_token_nao_sobe():
    """Sem token nenhuma cobranca e criada e toda reserva morre no pagamento."""
    import pytest

    with pytest.raises(ValueError, match="MERCADOPAGO_ACCESS_TOKEN"):
        _producao_valida(mercadopago_access_token="")


def test_token_de_teste_em_producao_nao_sobe():
    """O Mercado Pago usa a MESMA API para teste e producao: quem separa e o
    token. Um TEST- em producao simula as cobrancas e o dinheiro nunca entra —
    e nada falha visivelmente, que e o pior jeito de descobrir."""
    import pytest

    with pytest.raises(ValueError, match="TESTE"):
        _producao_valida(mercadopago_access_token="TEST-1234567890")


def test_webhook_sem_segredo_nao_sobe():
    """Sem segredo, qualquer um POSTa um callback e confirma reserva sem pagar."""
    import pytest

    with pytest.raises(ValueError, match="PAYMENT_WEBHOOK_SECRET"):
        _producao_valida(payment_webhook_secret="")


def test_guard_not_triggered_in_test():
    from app.core.config import Settings

    s = Settings(environment="test", jwt_secret="short", cors_origins="*")
    assert s.environment == "test"


def test_cors_origin_list_empty():
    from app.core.config import Settings

    s = Settings(environment="test", cors_origins="")
    assert s.cors_origin_list == ["*"]
