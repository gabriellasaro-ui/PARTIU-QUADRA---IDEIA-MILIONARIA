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

    # Redis e opcional por design (cache, blacklist, pub/sub, rate limit todos
    # tem fallback). Para o fallback valer, a falha precisa ser RAPIDA: sem
    # estes limites, cada operacao com o Redis fora custa ~4s de retry.
    redis_connect_timeout: float = 0.5
    redis_socket_timeout: float = 1.0
    # Depois de uma falha, quanto tempo parar de tentar antes de sondar o
    # Redis de novo (disjuntor em core/redis.py). Quem paga a sondagem e
    # um request de usuario, entao vale espacar: com o Redis fora, 30s
    # significa um request lento a cada 30s em vez de todos.
    redis_circuit_seconds: float = 30.0

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

    # Taxas: 9% do QUE O JOGADOR PAGA (taxa sobre o total: com subtotal R$100,
    # o jogador paga R$109,89 e a taxa e R$9,89) + 3% da arena POR DENTRO do
    # repasse. player_fee_rate = 0.09 / (1 - 0.09) = 0.0989011.
    player_fee_rate: float = 0.0989011  # 9% do total pago (taxa/total = 0.09)
    arena_fee_rate: float = 0.03
    booking_payment_expire_minutes: int = 15
    booking_approval_expire_minutes: int = 15
    booking_code_prefix: str = "PQ-"

    # --- Clubes (guilda) ---
    #: De quantos clubes uma pessoa participa. Sem teto, aparece quem entra em
    #: dezenas so para cacar vaga e nunca confirma presenca.
    club_max_per_user: int = 5
    #: Quantos ela pode CRIAR. Segura a enxurrada de clube vazio na busca.
    club_max_owned: int = 2
    #: Tamanho inicial de um clube novo, e o teto que a gestao pode pedir.
    club_members_default: int = 30
    club_members_max: int = 100
    payment_provider: str = "mock"
    payment_mock_confirm_seconds: int = 15

    # SENHA DO ADMIN, definida por quem sobe o servidor.
    #
    # Sem isto, em producao o seed SORTEIA a senha e a imprime UMA VEZ no log
    # do boot. Se ninguem estava olhando naquele instante — que e o normal — o
    # painel do admin fica inacessivel, e a unica saida vira um segundo deploy
    # so para reimprimir a senha. Foi exatamente o que aconteceu aqui.
    #
    # Com ADMIN_PASSWORD preenchida, a senha e a que voce escolheu: um deploy,
    # sem pescar nada em log. Use junto de RESET_ADMIN_PASSWORD=true para
    # trocar a de uma instalacao que ja existe.
    #
    # Vazia mantem o sorteio, que continua sendo o padrao seguro para quem
    # sobe sem configurar nada.
    admin_password: str = ""

    # Verificacao de contato por codigo.
    #
    # "log" escreve o codigo no log do servidor e o devolve na resposta — so
    # fora de producao, e a guarda de producao abaixo cobra o contrario. E o
    # que permite o cadastro inteiro funcionar de ponta a ponta antes de haver
    # provedor de e-mail contratado.
    verification_provider: str = "log"
    resend_api_key: str = ""
    #: Precisa ser de um dominio verificado no provedor, senao ele recusa.
    email_remetente: str = "Qadras <nao-responda@qadras.com.br>"

    # Adquirente (Mercado Pago). O access token da acesso total a conta: vive
    # so no .env, que e gitignored, e nunca aparece em log.
    #
    # Nao ha URL separada de sandbox: o Mercado Pago usa a MESMA API para
    # teste e producao, e quem decide e o token (TEST-... versus APP_USR-...).
    # Por isso a guarda de producao olha o prefixo do token, e nao um ambiente.
    mercadopago_access_token: str = ""
    #: URL publica do callback, mandada em cada cobranca (notification_url).
    #: Vazia => vale so a URL cadastrada no painel.
    mercadopago_notification_url: str = ""

    # --- Split de pagamentos 1:1 (marketplace) -----------------------------
    #
    # Cada arena conecta a PROPRIA conta MP via OAuth e a cobranca sai com o
    # token dela; a Qadras retem `application_fee`. O token global acima
    # deixa de ser o caminho de cobranca quando o split esta ligado.
    #
    # LIGADO POR FLAG, e nao pela simples presenca das credenciais, porque a
    # producao de hoje cobra com o token global: exigir OAuth de cara faria o
    # proximo deploy nao subir. Vira true quando as arenas ja conectaram.
    mercadopago_split_enabled: bool = False
    #: Da APLICACAO no painel MP (Suas integracoes > aplicacao > Credenciais).
    #: O secret troca code por token de QUALQUER vendedor: vive so no .env.
    mercadopago_client_id: str = ""
    mercadopago_client_secret: str = ""
    #: Identica, caractere por caractere, a Redirect URL cadastrada no painel
    #: (sem barra final) — divergencia vira invalid_grant. NUNCA montar a
    #: partir do Host da request: um Host forjado viraria open redirect
    #: levando junto o code de autorizacao do vendedor.
    mercadopago_redirect_uri: str = ""
    #: A Qadras banca a taxa do MP ATE este teto (fracao do valor pago); o que
    #: exceder sobra para a arena. No Pix a taxa fica abaixo e a arena recebe
    #: os 97% cheios; no cartao o excedente e dela. Parametro COMERCIAL — por
    #: isso env var, e nao constante no meio do calculo.
    mercadopago_fee_absorbed_cap: float = 0.0099
    #: Taxa presumida de uma arena enquanto a real nao foi medida pelo
    #: `fee_details` da resposta do MP. O valor real fica por conexao.
    mercadopago_default_fee_rate: float = 0.0099
    #: Quantos dias antes do vencimento a task renova o token do vendedor. O
    #: MP da 180 dias; renovar cedo cobre worker parado por alguns dias sem
    #: que ninguem precise reconectar a mao.
    mercadopago_refresh_days_before: int = 15
    #: Para onde devolver o dono da arena depois da autorizacao (a tela de
    #: pagamentos do painel do gerente). Vazia => o callback responde JSON,
    #: o que mantem a rota testavel sem inventar um redirect para lugar nenhum.
    mercadopago_panel_return_url: str = ""

    # Segredo compartilhado do webhook de pagamento. O callback do provedor e
    # publico (quem chama e o provedor, nao o app), entao ele precisa provar
    # quem e: sem isso, qualquer um que conheca o providerRef — e o proprio
    # jogador conhece, ele vem na resposta de /pagar — confirma a reserva sem
    # pagar. Vazio = sem exigencia (so dev; producao nao aceita o mock).
    payment_webhook_secret: str = ""

    # Push (Fase 7): "mock" por padrao (grava em push_logs, sem rede). O
    # provider FCM entra quando FCM_CREDENTIALS_PATH apontar para o service
    # account JSON do Firebase — como o login Google, vazio => não configurado.
    push_provider: str = "mock"
    fcm_credentials_path: str = ""
    fcm_project_id: str = ""

    # Reset de senha do admin — quando "true", o seed regenera a senha
    # e imprime no log. Usar UMA VEZ e depois remover a env var.
    reset_admin_password: str = ""

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
            provedor = self.payment_provider.strip().lower()
            if provedor == "mock":
                raise ValueError(
                    "PAYMENT_PROVIDER=mock nao pode em producao: o provedor "
                    "mock confirma cobranca sem dinheiro nenhum entrar. "
                    "Configure o provedor de Pix real antes de subir."
                )
            if provedor == "mercadopago":
                token = self.mercadopago_access_token.strip()
                if not token:
                    raise ValueError(
                        "MERCADOPAGO_ACCESS_TOKEN vazio com "
                        "PAYMENT_PROVIDER=mercadopago. Sem ele nenhuma "
                        "cobranca e criada e toda reserva morre no pagamento."
                    )
                if token.startswith("TEST-"):
                    raise ValueError(
                        "MERCADOPAGO_ACCESS_TOKEN de TESTE em producao: as "
                        "cobrancas seriam simuladas e o dinheiro nunca "
                        "entraria. Use o token de producao (APP_USR-...)."
                    )
            if self.mercadopago_split_enabled:
                faltando = [
                    nome
                    for nome, valor in (
                        ("MERCADOPAGO_CLIENT_ID", self.mercadopago_client_id),
                        ("MERCADOPAGO_CLIENT_SECRET", self.mercadopago_client_secret),
                        ("MERCADOPAGO_REDIRECT_URI", self.mercadopago_redirect_uri),
                    )
                    if not valor.strip()
                ]
                if faltando:
                    raise ValueError(
                        "MERCADOPAGO_SPLIT_ENABLED=true sem " + ", ".join(faltando)
                        + ". Sem essas credenciais nenhuma arena consegue "
                        "conectar a conta, e toda cobranca morre no OAuth."
                    )
                destino = self.mercadopago_redirect_uri.strip()
                if not destino.startswith("https://"):
                    raise ValueError(
                        "MERCADOPAGO_REDIRECT_URI precisa ser https em "
                        "producao: o code de autorizacao do vendedor viaja "
                        "nessa URL."
                    )
                if destino.endswith("/"):
                    raise ValueError(
                        "MERCADOPAGO_REDIRECT_URI com barra final nao bate "
                        "com a URL cadastrada no painel do MP: a troca do "
                        "code falha com invalid_grant."
                    )
            verif = self.verification_provider.strip().lower()
            if verif == "log":
                raise ValueError(
                    "VERIFICATION_PROVIDER=log nao pode em producao: o "
                    "provedor 'log' DEVOLVE o codigo na resposta HTTP, ou "
                    "seja, entrega a chave a quem pedir. Configure o envio "
                    "real (VERIFICATION_PROVIDER=resend + RESEND_API_KEY)."
                )
            if verif == "resend" and not self.resend_api_key.strip():
                raise ValueError(
                    "RESEND_API_KEY vazio com VERIFICATION_PROVIDER=resend: "
                    "nenhum codigo sairia, e todo cadastro de arena morreria "
                    "na tela de confirmar o e-mail."
                )
            if not self.payment_webhook_secret.strip():
                raise ValueError(
                    "PAYMENT_WEBHOOK_SECRET vazio em producao: sem ele "
                    "qualquer um pode POSTar um callback e confirmar uma "
                    "reserva sem pagar."
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
