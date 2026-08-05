"""Configuracao central do backend, lida de variaveis de ambiente.

Em producao (EasyPanel) as variaveis sao injetadas no painel. Em dev, um
arquivo backend/.env pode ser criado a partir de .env.example.
"""
from functools import lru_cache

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

    # Login Google — preencher GOOGLE_CLIENT_ID (client_id web do OAuth 2.0)
    # para validar o idToken real. Vazio => endpoint /api/auth/google responde 503.
    google_client_id: str = ""

    # Taxas (decisao fixada: 9% do jogador POR CIMA do preco + 3% da arena
    # POR DENTRO do repasse). R$120 -> jogador paga R$130,80; arena recebe
    # R$116,40; Qadras fica R$14,40.
    player_fee_rate: float = 0.09
    arena_fee_rate: float = 0.03

    @property
    def cors_origin_list(self) -> list[str]:
        if self.cors_origins.strip() in ("", "*"):
            return ["*"]
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
