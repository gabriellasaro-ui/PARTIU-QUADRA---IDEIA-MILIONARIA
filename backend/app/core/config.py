"""Configuracao central do backend, lida de variaveis de ambiente.

Em producao (EasyPanel) as variaveis sao injetadas no painel. Em dev, um
arquivo backend/.env pode ser criado a partir de .env.example.
"""
from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Qadras API"
    app_version: str = "2.0.0"

    environment: str = "production"  # development | production

    database_url: str = "postgresql+psycopg://qadras:qadras@localhost:5432/qadras"
    redis_url: str = "redis://localhost:6379/0"

    jwt_secret: str = "change-me"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60
    refresh_token_expire_days: int = 30

    cors_origins: str = "*"

    timezone: str = "America/Sao_Paulo"

    # Telemetria (Fase 12) — nivel de log: DEBUG | INFO | WARNING | ERROR.
    log_level: str = "INFO"

    # Workers uvicorn (Fase 12) — configuravel por env var.
    # Em VPS pequena (1GB), 2 workers evita OOM com Postgres + Redis + Celery.
    uvicorn_workers: int = 2

    # Rate limiting (Fase 12) — slowapi com storage no REDIS_URL por padrao.
    # rate_limit_enabled=false desliga tudo (usado nos testes e em dev).
    rate_limit_enabled: bool = True
    rate_limit_storage: str = ""

    # Login Google — preencher GOOGLE_CLIENT_ID (client_id web do OAuth 2.0)
    # para validar o idToken real. Vazio => endpoint /api/auth/google responde 503.
    google_client_id: str = ""

    # Taxas (decisao fixada: 9% do jogador POR CIMA do preco + 3% da arena
    # POR DENTRO do repasse). R$120 -> jogador paga R$130,80; arena recebe
    # R$116,40; Qadras fica R$14,40.
    player_fee_rate: float = 0.09
    arena_fee_rate: float = 0.03
    booking_payment_expire_minutes: int = 15
    booking_approval_expire_minutes: int = 15
    booking_code_prefix: str = "PQ-"
    payment_provider: str = "mock"
    payment_mock_confirm_seconds: int = 15

    # Push (Fase 7): "mock" por padrao (grava em push_logs, sem rede). O
    # provider FCM entra quando FCM_CREDENTIALS_PATH apontar para o service
    # account JSON do Firebase — como o login Google, vazio => não configurado.
    push_provider: str = "mock"
    fcm_credentials_path: str = ""
    fcm_project_id: str = ""

    @model_validator(mode="after")
    def _guard_production(self):
        """Em producao, segredo fraco ou CORS aberto impedem o boot.

        Um JWT com secret adivinhavel permite forjar qualquer token; CORS
        '*' libera qualquer origem a usar credenciais do navegador.
        """
        if self.environment == "production":
            if not self.jwt_secret or len(self.jwt_secret.strip()) < 32:
                raise ValueError(
                    "JWT_SECRET muito curto em producao (minimo 32 chars). "
                    "Gere com: openssl rand -hex 32"
                )
            if self.cors_origins.strip() in ("", "*"):
                raise ValueError(
                    "CORS_ORIGINS='*' nao pode em producao. Liste as origens: "
                    "https://app.qadras.com.br,https://gerente.qadras.com.br,..."
                )
        return self

    @property
    def cors_origin_list(self) -> list[str]:
        if self.cors_origins.strip() in ("", "*"):
            return ["*"]
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
