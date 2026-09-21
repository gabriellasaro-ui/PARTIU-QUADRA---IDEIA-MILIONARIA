# IMPLEMENTAR MERCADO PAGO — Split de Pagamentos 1:1 (marketplace)

## 1. Contexto e objetivo

Integrar o **Split de Pagamentos 1:1** do Mercado Pago (modelo *marketplace*) para substituir o `MERCADOPAGO_ACCESS_TOKEN` global atual. Cada **arena (vendedor)** conecta a própria conta MP via **OAuth**; a Qadras (marketplace) recebe comissão por transação.

**Regras de negócio atuais (confirmadas):**
- Jogador paga `subtotal + 9% do total` → `player_fee_rate = 0.0989011` (taxa = 9% do total pago).
- Arena recebe o subtotal (menos comissão MP) ; Qadras retém a comissão.
- Desconto do MP acontece **primeiro**; a comissão do marketplace incide **sobre o restante** (`application_fee`), conforme doc oficial.

## 2. Mapa completo dos componentes atuais

| Componente | Arquivo | Papel hoje |
|---|---|---|
| Config | `backend/app/core/config.py` | `mercadopago_access_token`, `mercadopago_notification_url` + guards (recusa `TEST-`/vazio em production) |
| Factory de provider | `backend/app/services/payments/__init__.py` | `get_provider()` com `lru_cache`; registry `mercadopago`/`mock` |
| Contrato | `backend/app/services/payments/base.py` | `PaymentProvider` (create_payment / parse_webhook / refund), `PaymentIntent`, `WebhookResult` |
| Provider MP | `backend/app/services/payments/mercadopago.py` | Token único global; Pix; **sem** `application_fee`; webhook HMAC + consulta `GET /v1/payments/{id}` |
| Provider mock | `backend/app/services/payments/mock.py` | Dev: auto-confirmação, `WEBHOOK_SECRET_HEADER` |
| Webhook | `backend/app/api/payments.py` | `POST /api/payments/webhook/{provider}` → `parse_webhook` → `confirm_payment` |
| Criação de pagamento | `backend/app/services/bookings.py` (`pay_booking`) | `get_provider()` + `payment_method="pix"` → cria `Payment` |
| Modelos | `backend/app/models/arena.py`, `booking.py`, `payment.py` | `Arena` (owner, pix_key, settings), `Payment` (provider, provider_ref, amount_cents…) |
| Seed/guards | `backend/app/seed.py`, `config.py` | senhas demo, guards de produção |

## 3. Regras do Mercado Pago Split 1:1 (fontes oficiais)

- Produto: **marketplace → PSP** — só **Checkout Pro / Checkout API (Transparente) / Bricks**. Não disponível para outros produtos.
- **Cada vendedor** deve passar por **OAuth**:
  1. `https://auth.mercadopago.com.br/authorization?client_id=<APP_ID>&response_type=code&platform_id=mp&redirect_uri=<REDIRECT_URI>`
  2. Retorno: `?code=<AUTHORIZATION_CODE>` (válido 10 min) + `state`.
  3. Troca: `POST https://api.mercadopago.com/oauth/token` com `client_id`, `client_secret`, `grant_type=authorization_code`, `code`, `redirect_uri`, `state`.
  4. Resposta: `access_token`, `public_key`, `refresh_token`, `user_id` (collector), `expires_in=15552000` (**180 dias**), `scope=offline_access`.
- **Renovação:** `POST /oauth/token` com `grant_type=refresh_token` + `refresh_token` **renova o refresh também** (re-armazenar). Sem renovar em 180d → revinculação.
- **Cobrança Transparente:** `POST /v1/payments` com `Authorization: Bearer <access_token DO VENDEDOR>` + campo **`application_fee`** (comissão do marketplace em R$, **não %**).
  - Ordem de dedução: comissão MP → comissão marketplace sobre o restante.
- **Reembolso:** dividido **proporcionalmente** entre vendedor e marketplace; se vendedor não tiver saldo, marketplace reembolsa a própria parte.
- **Setup no painel:** aplicação `Pagamentos online → Checkout Transparente (API) → modelo Marketplace` + **Redirect URL** configurada.

## 4. Decisões pendentes (marcadas como `[DECIDIR]` no código)

1. **`application_fee`** = valor da comissão da Qadras por cobrança. Sugestão: `application_fee = tax = arredondar(subtotal * player_fee_rate)` → Qadras retém a fee; arena recebe o subtotal. **`[DECIDIR]` se retém os 3% da arena também.**
2. **Persistência dos tokens do vendedor:** **tabela própria `mercadopago_connections`** (recomendado) vs. JSON em `arenas.settings`.
3. **Ambiente inicial:** TEST- (contas de teste) → `ENVIRONMENT=development`/`staging`; ou produção `APP_USR-`.
4. **Redirect URL** exata do callback (ex.: `https://api.qadras.com.br/api/mercadopago/oauth/callback`) — definir o path antes de implementar as rotas.

## 5. Plano de implementação por etapa

### A. Configuração (`backend/app/core/config.py`)
- Novos campos:
  - `mercadopago_client_id: str = ""`
  - `mercadopago_client_secret: str = ""`
  - `mercadopago_redirect_uri: str = ""`
- Guards em production: exigir client_id/secret; manter guarda de `TEST-` resetada: exigir **APP_USR-** quando `ENVIRONMENT=production`.
- Atualizar `.env.example` e `.env` (documentando que `mercadopago_access_token` deixa de ser o único caminho; tokens passam a ser por vendedor).

### B. Modelo e migração (tabela própria — recomendado)
- Novo `backend/app/models/mercadopago_connection.py`:
  - `id` UUID PK, `arena_id` FK unique → arenas, `access_token` (Text), `refresh_token` (Text), `user_id` (collector), `public_key`, `token_type`, `scope`, `expires_at` (datetime), `created_at`/`updated_at`, `deleted_at`.
- Migração Alembic (`revision` sequencial, ex.: `x1y2z3a4b5c6_marketplace_split.py`) com `create_table`.
- Registrar no `backend/app/models/__init__.py`.

### C. Serviço OAuth (conexão do vendedor) → `backend/app/services/mercadopago_oauth.py`
- `authorization_url(arena_id)` → monta URL com `client_id`, `redirect_uri`, `state` (hash do arena_id).
- `exchange_code(arena_id, code, state)` → `POST /oauth/token` (authorization_code); valida `state`; grava/atualiza `MercadoPagoConnection`.
- `refresh_if_needed(arena_id)` → se `expires_at` próximo (ex.: < 15 dias), chama `grant_type=refresh_token` e re-grava novos `access_token`+`refresh_token`.
- Retornos (200/403/503) e tratamento de erro; **tokens nunca vão para log**.

### D. Provider com token por vendedor (mudança central)
- `mercadopago.py`: `create_payment` passa a receber a conexão da arena:
  - Header `Authorization: Bearer <access_token do vendedor>` (não global).
  - Corpo com `application_fee` (ver decisão 1) e `external_reference=booking.code`.
- `get_provider()` deve deixar de ser totalmente stateless para operações que dependem do vendedor; manter factory para webhook genérico, mas a **consulta de status no webhook** (`GET /v1/payments/{id}`) usa o token da arena dona do pagamento.

### E. Criação de pagamento (`backend/app/services/bookings.py` → `pay_booking`)
- Resolver arena do booking → buscar `MercadoPagoConnection` → render `application_fee`.
- Arena sem conexão MP → resposta clara de erro (ex.: 409 "arena não conectada ao recebimento").
- `Payment.provider_ref` continua o id do MP; `webhook_id` idempotência mantida.

### F. Webhook e confirmação (`backend/app/api/payments.py`)
- `POST /api/payments/webhook/{provider}`:
  - `parse_webhook` valida HMAC (já existe) e devolve `provider_ref` (id do pagamento).
  - Antes de consultar o MP, resolver `Payment → booking → arena → token` e usar o token da arena na conferência (via conexão).
- Manter idempotência atual.

### G. Renovação automática (Celery task)
- `backend/app/workers/tasks.py`: `renovar_tokens_mercadopago` → varre conexões com `expires_at` próximo, chama `refresh_if_needed`.
- `celery_app.py`: `beat_schedule` `"renovar-mercadopago": schedule 86400.0` (diário).
- Registar testes de expiração/renovação.

### H. Rotas de OAuth (`backend/app/api/mercadopago.py` + router novo)
- `GET /api/mercadopago/oauth/iniciar` – autenticado (dono da arena) → devolve URL de autorização.
- `GET /api/mercadopago/oauth/callback` – público → troca code, grava conexão, redireciona.
- `GET /api/mercadopago/status` – autenticado → estado da conexão (conectada? expira em?) para o frontend do gerente.
- Registrar router em `main.py`.

### I. Frontend
- `www-gerente`: novo bloco "Conectar conta Mercado Pago" (botão inicia OAuth, badge de status, botão reconectar).
- Contrato do app do jogador **não muda**.

### J. Testes (`backend/tests/`)
- `test_mercadopago_oauth.py`: troca de code, refresh, state inválido, expiração.
- `test_payments.py` (estender): `pay_booking` sem conexão da arena → 409; com conexão → `application_fee` correto no payload; webhook idempotente; reembolso proporcional simulado.
- Manter suíte atual verde (o mock continua como fallback).

## 6. Verificação pós-implementação
- `pytest` backend (suíte completa).
- Fluxo sandbox: criar 2 arenas de teste, conectar conta TEST- via OAuth, reserva → Pix com split visível no painel MP (commissions por vendedor).
- Webhook na sandbox confirmado e idempotente.
- Celery beat renovando tokens antes dos 180 dias.

## 7. Arquivos afetados (criar/alterar)
- `backend/app/core/config.py` *(alterar)*
- `backend/app/models/mercadopago_connection.py` *(criar)*
- `backend/alembic/versions/x1y2z3a4b5c6_marketplace_split.py` *(criar)*
- `backend/app/models/__init__.py` *(alterar)*
- `backend/app/services/mercadopago_oauth.py` *(criar)*
- `backend/app/services/payments/mercadopago.py` *(alterar)*
- `backend/app/services/payments/__init__.py` *(alterar)*
- `backend/app/services/bookings.py` *(alterar; pay_booking)*
- `backend/app/api/mercadopago.py` *(criar)*
- `backend/app/api/payments.py` *(alterar; webhook)*
- `backend/app/workers/tasks.py` + `backend/app/core/celery_app.py` *(alterar)*
- `backend/app/main.py` *(alterar; router)*
- `backend/.env.example` *(alterar)*
- `www-gerente/*` *(conexão OAuth)*
- `backend/tests/test_mercadopago_oauth.py` *(criar)* + `backend/tests/test_payments.py` *(estender)*