# IMPLEMENTAR MERCADO PAGO — Split de Pagamentos 1:1 (marketplace)

## 1. Contexto e objetivo

Integrar o **Split de Pagamentos 1:1** do Mercado Pago (modelo *marketplace*) para substituir o `MERCADOPAGO_ACCESS_TOKEN` global atual. Cada **arena (vendedor)** conecta a própria conta MP via **OAuth**; a Qadras (marketplace) recebe comissão por transação.

**Regras de negócio atuais (confirmadas):**
- Jogador paga `subtotal + 9% do total` → `player_fee_rate = 0.0989011` (taxa = 9% do total pago).
- Arena cede 3% do subtotal → `arena_fee_rate = 0.03`; repasse bruto da arena = `subtotal * 0.97`.
- **Qadras retém as duas pontas:** comissão bruta = `round(subtotal * (player_fee_rate + arena_fee_rate))` = **12,89% do subtotal** — a mesma expressão de `admin.overview` (`admin.py:107`) e do seed (`seed.py:714`).
- **A taxa do MP sai da parte da Qadras** (decisão de 2026-09-21). O `application_fee` enviado ao MP é a comissão bruta **menos** a taxa estimada do MP, para que o repasse da arena feche em `subtotal * 0.97` exato:
  ```
  application_fee = comissao_bruta − ceil(total_pago * taxa_mp_da_arena)
  ```
  Arredondar a taxa **para cima** (`ceil`): subestimar faz a arena receber menos que os 97% prometidos, que é justamente o que esta decisão evita.
- Consequência: o repasse da arena passa a ser exatamente `subtotal * 0.97`, validando a fórmula que `gerente.py:157` já exibe. A margem líquida da Qadras cai de 12,89% para ~11,80% do subtotal (supondo taxa MP de 0,99%, valor NAO confirmado).
- A taxa aplicada em split 1:1 é a da **conta do vendedor**, não a da Qadras → `taxa_mp` é por arena, nunca constante global. Guardar em `mercadopago_connections.fee_rate` (default em config) e conciliar com `fee_details` da resposta do `/v1/payments`.
- **As taxas do MP nao estao confirmadas neste plano.** O site de tarifas bloqueia leitura automatizada. Fonte de verdade, nesta ordem: (1) campo `fee_details` da resposta do `POST /v1/payments` no sandbox — da o valor real por conta e por meio de pagamento; (2) painel Custos da conta de cada arena. Nao chumbar percentual no codigo antes de medir.

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
- **Cartão (tokenização):** front usa a `public_key` da **Qadras**; backend usa o `access_token` da **arena**. Ver seção 8.
- **Setup no painel:** aplicação `Pagamentos online → Checkout Transparente (API) → modelo Marketplace` + **Redirect URL** configurada.

## 4. Decisões pendentes (marcadas como `[DECIDIR]` no código)

1. ~~**`application_fee`**~~ **DECIDIDO (2026-09-21):** a Qadras retém **as duas pontas** (9% do jogador + 3% da arena) **e absorve a taxa do MP**.
   ```python
   comissao_bruta = round(subtotal_cents * (settings.player_fee_rate + settings.arena_fee_rate))
   taxa_mp_real    = math.ceil(total_cents * conexao.fee_rate)   # ceil: nunca subestimar
   teto            = math.ceil(total_cents * settings.mercadopago_fee_absorbed_cap)
   absorvido       = min(taxa_mp_real, teto)                     # Qadras banca ate o teto
   application_fee = max(0, comissao_bruta - absorvido) / 100    # MP espera R$, nao centavos
   ```
   **Teto de absorção (2026-09-22):** a Qadras banca a taxa do MP até **0,99% do valor pago**; o que exceder é da arena. No Pix a taxa fica abaixo do teto e a Qadras banca tudo (arena recebe os 97% cheios); no cartão o excedente sobra para a arena, e a margem da Qadras trava em ~R$ 11,80 por R$ 100 de subtotal. O teto vive em `settings.mercadopago_fee_absorbed_cap` — é parâmetro comercial, não constante de código.

   Reutilizar `comissao_bruta` da mesma expressão de `admin.py:107` (não reescrever), para que os relatórios fechem com o extrato do MP.

   Exemplo com subtotal R$ 100,00 e taxa MP de 0,99% (valor ilustrativo, a confirmar): jogador paga R$ 109,89 · MP retém R$ 1,09 · `application_fee` = R$ 11,80 · **arena recebe R$ 97,00** · Qadras líquido R$ 11,80.

   Gravar no `Payment` os três valores (`commission_gross`, `mp_fee`, `commission_net`) na confirmação do webhook, lendo `fee_details` da resposta do MP — sem isso não há como conciliar a margem real.
2. ~~**Persistência dos tokens do vendedor**~~ **DECIDIDO (2026-09-22): tabela própria `mercadopago_connections`.** Motivos: `expires_at` indexável para a task de renovação varrer só o que expira (em JSON seria varredura completa + parse), e os tokens ficam **fora** de `arenas.settings`, que já é serializado para o painel do gerente. A tabela também acomoda `fee_rate` (taxa MP daquela arena) e os meios de pagamento habilitados.
3. ~~**Ambiente inicial**~~ **DECIDIDO (2026-09-22): sandbox com contas `TEST-`.** A guarda de `config.py` já recusa `TEST-` quando `ENVIRONMENT=production`, então os dois convivem. O sandbox é o que responde as três perguntas abertas: taxa real do Pix (via `fee_details`), se `application_fee` funciona em Pix, e se cartão salvo atravessa arenas (ver 8.5).
4. ~~**Redirect URL**~~ **DECIDIDO (2026-09-21):** `https://api.qadras.com.br/api/mercadopago/oauth/callback`, sem barra final, já cadastrada no painel MP. O `redirect_uri` enviado na autorização **e** na troca do code tem de ser essa string idêntica, senão o MP responde `invalid_grant`. Colocar em `MERCADOPAGO_REDIRECT_URI` e nunca montar a URL a partir do `Host` da request.

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
## 8. Cartão com tokenização + LGPD (escopo adicionado em 2026-09-22)

### 8.1 Regra de ouro — VERIFICADA na doc oficial
- O frontend tokeniza com a **`public_key` da Qadras (conta integradora)** — **não** a do vendedor. Uma única chave no app do jogador, sem configuração por arena.
- O backend cobra com o **`access_token` da arena** (obtido no OAuth) + `application_fee`.
- Fonte: `developers/pt/docs/split-payments/split-1-1/integration-configuration/integrate-marketplace`.
- Consequência: `mercadopago_connections.public_key` **não** é usada na tokenização. Guardar mesmo assim (o OAuth devolve), mas não construir lógica de front em cima dela.

### 8.2 Por que o número do cartão nunca toca o backend (PCI-DSS)
1. `MercadoPago.js v2` no navegador (`www-usuario`) captura número/CVV/validade.
2. O SDK envia direto ao MP e devolve um **`card_token` de uso único**.
3. O front manda ao nosso backend **apenas**: `token`, `payment_method_id`, `issuer_id`, `installments`, `last4`, `brand`.
4. O backend faz `POST /v1/payments` com esse token + `access_token` da arena + `application_fee`.

O comentário já existente em `mercadopago.py:120-127` descreve exatamente esse desenho — a recusa atual de cartão é proposital, não uma lacuna.

### 8.3 O que pode e o que não pode ser persistido
- **PODE:** últimos 4 dígitos, bandeira, `payment_method_id`, id do pagamento no MP, valor, status, parcelas.
- **NUNCA:** PAN completo, CVV/`security_code`, validade, trilha. Nem em banco, nem em log, nem em APM, nem em campo de texto livre.
- **Guard obrigatório:** filtro de log que descarta chaves sensíveis + teste que falha se `card_number|security_code|cvv` aparecer em qualquer log da suíte.

### 8.4 LGPD — obrigações concretas
- **Base legal:** execução de contrato (art. 7º, V). Processar o pagamento da reserva **não** exige consentimento separado.
- **Minimização:** somente os campos de 8.3.
- **Transparência:** política de privacidade nomeando o Mercado Pago como **operador** e o que é compartilhado com ele.
- **Retenção:** dado de pagamento segue prazo fiscal/contábil — ao excluir a conta do jogador, **anonimizar o vínculo** em vez de apagar o `Payment`.
- **Direito de eliminação:** rota de exclusão de cartão salvo (se houver) e fluxo de exclusão de conta.
- **Encarregado (DPO):** contato publicado. **Incidentes:** procedimento de comunicação à ANPD.

### 8.5 Cartão salvo — RECOMENDAÇÃO: não fazer na v1
Em split 1:1 o `customer`/`card_id` pertence **à conta que o criou**. Como cada cobrança roda na conta da **arena**, um cartão salvo na arena A tende a **não ser cobrável** na arena B — e o jogador da Qadras reserva em várias arenas. As saídas seriam cartão salvo *por arena* (confuso e multiplica dado pessoal) ou nada.

**`[VERIFICAR NO SANDBOX]`** antes de descartar em definitivo.

Sem cartão salvo: token de uso único a cada reserva, nada além de 8.3 no banco → **escopo LGPD mínimo**, que é o objetivo declarado.

### 8.6 Pré-requisito do lado da arena
A conta MP da arena precisa estar **habilitada a receber cartão**. Se não estiver, a cobrança falha mesmo com token válido. Logo: `GET /api/mercadopago/status` deve expor os meios aceitos pela arena, e o app do jogador **esconde cartão** para arenas sem cartão habilitado.

### 8.7 Etapas adicionais (somam-se às A–J)
- **K.** `www-usuario`: SDK MP.js v2 em `pages/pagamento.html`, formulário de cartão, geração do token, envio ao backend.
- **L.** `mercadopago.py`: `create_payment` aceita `metodo == "card"` (token, `installments`, `issuer_id`, `payment_method_id`) + `application_fee`.
- **M.** Status de cartão difere do Pix: pode vir `in_process` (antifraude) e `rejected` com `status_detail`. Traduzir para mensagem útil ao jogador.
- **N.** `[DECIDIR]` Parcelamento: aceita? Quem paga os juros?
- **O.** `[DECIDIR]` 3-D Secure: reduz fraude e chargeback, adiciona um passo no fluxo.
- **P.** `[DECIDIR]` Chargeback: webhook de `chargebacks`; em split o valor volta proporcional — definir a política com a arena.
- **Q.** Testes: cartões de teste do MP (aprovado/recusado/pendente), token inválido, arena sem cartão habilitado, e o teste de log sem PAN.


## 9. Estado da implementacao (22/09/2026)

| Etapa | Estado | Onde |
|---|---|---|
| A. Configuracao | ✅ | `core/config.py` — split_enabled, client_id/secret, redirect_uri, teto, taxa presumida |
| B. Modelo + migracao | ✅ | `models/mercadopago_connection.py`, `x9f1a2b3c4d5_marketplace_split.py` |
| C. Servico OAuth | ✅ | `services/mercadopago_oauth.py` |
| D. Provider por vendedor | ✅ | `payments/mercadopago.py` — `MercadoPagoProvider(access_token=...)` + `application_fee` |
| E. Cobranca resolve a arena | ✅ | `services/bookings.py` — `_provider_para_cobranca`, 409 sem conexao |
| F. Webhook com token da arena | ✅ | `api/payments.py` + `extrair_id_verificado`/`consultar_status` |
| G. Renovacao (Celery) | ✅ | `workers/tasks.py` + beat diario |
| H. Rotas OAuth | ✅ | `api/mercadopago.py` |
| I. Frontend (gerente conecta) | ⬜ | `www-gerente` |
| K–M. Cartao com tokenizacao | ⬜ | `www-usuario` + provider |
| N–P. Parcelamento / 3DS / chargeback | ⬜ `[DECIDIR]` | — |

### Como o split e ligado

`MERCADOPAGO_SPLIT_ENABLED` governa **a cobranca**, nao o OAuth. As rotas de
conexao funcionam com o flag desligado — de proposito: as arenas conectam
primeiro, e so quando todas estiverem conectadas o flag vira `true` e a
cobranca passa a sair na conta delas. Ligar antes faria toda reserva de arena
nao conectada responder 409.

### O que ainda nao foi verificado no sandbox

1. Se `application_fee` funciona em **Pix** (a doc e ambigua; em cartao e certo).
2. A taxa real do Pix por conta — hoje presumida em `MERCADOPAGO_DEFAULT_FEE_RATE`.
   O valor verdadeiro vem em `fee_details` na resposta do `/v1/payments`.
3. Se `test_token=true` e necessario na troca do code (flag
   `MERCADOPAGO_OAUTH_TEST_TOKEN`, default false).
4. Se cartao salvo atravessa arenas (secao 8.5) — so importa quando K–M entrarem.
