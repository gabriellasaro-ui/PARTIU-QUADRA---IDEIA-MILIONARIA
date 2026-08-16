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


def test_guard_allows_valid_production():
    from app.core.config import Settings

    s = Settings(
        environment="production",
        jwt_secret="a-32-char-test-secret-0123456789abcdef-xyz",
        cors_origins="https://app.qadras.com.br,https://gerente.qadras.com.br",
    )
    assert s.environment == "production"
    assert s.cors_origin_list == ["https://app.qadras.com.br", "https://gerente.qadras.com.br"]


def test_guard_not_triggered_in_test():
    from app.core.config import Settings

    s = Settings(environment="test", jwt_secret="short", cors_origins="*")
    assert s.environment == "test"


def test_cors_origin_list_empty():
    from app.core.config import Settings

    s = Settings(environment="test", cors_origins="")
    assert s.cors_origin_list == ["*"]
