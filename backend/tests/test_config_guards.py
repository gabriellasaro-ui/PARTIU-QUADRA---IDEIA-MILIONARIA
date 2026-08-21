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
    """Producao completa. asaas sem chave, sem segredo de webhook ou apontando
    para o sandbox nao e producao valida — cada um desses tem guarda propria
    nos testes abaixo."""
    from app.core.config import Settings

    base = dict(
        environment="production",
        jwt_secret="a-32-char-test-secret-0123456789abcdef-xyz",
        cors_origins="https://app.qadras.com.br,https://gerente.qadras.com.br",
        payment_provider="asaas",
        asaas_api_key="$aact_chave_de_producao",
        asaas_ambiente="producao",
        payment_webhook_secret="segredo-do-webhook",
    )
    base.update(extra)
    return Settings(**base)


def test_guard_allows_valid_production():
    s = _producao_valida()
    assert s.environment == "production"
    assert s.cors_origin_list == ["https://app.qadras.com.br", "https://gerente.qadras.com.br"]


def test_asaas_sem_chave_nao_sobe():
    """Sem chave nenhuma cobranca e criada e toda reserva morre no pagamento."""
    import pytest

    with pytest.raises(ValueError, match="ASAAS_API_KEY"):
        _producao_valida(asaas_api_key="")


def test_asaas_apontando_para_sandbox_nao_sobe():
    """As cobrancas iriam para o ambiente de testes e o dinheiro nunca entraria."""
    import pytest

    with pytest.raises(ValueError, match="ASAAS_AMBIENTE"):
        _producao_valida(asaas_ambiente="sandbox")


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
