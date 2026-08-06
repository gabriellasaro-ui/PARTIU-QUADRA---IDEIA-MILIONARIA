# Plano — Backend Definitivo Qadras

Versão: 1.0
Data: 05/08/2026
Escopo: `backend/`, `www-usuario`, `www-gerente`, `www-admin`

## Decisões fixadas

| Decisão | Valor |
|---|---|
| Regra de preço/comissão | 9% do jogador **por cima** do preço da quadra + 3% da arena **por dentro** do repasse (R$120 → jogador paga R$130,80; arena recebe R$116,40; Qadras fica R$14,40) |
| Pagamento | Adapter plugável + mock primeiro; troca por provedor real (Asaas/MercadoPago/Stripe) sem reescrever o domínio |
| Push notifications | Firebase FCM (Android/iOS/web) |
| Tempo real | WebSocket + push FCM como fallback em background |
| Mensagens | Conversas jogador↔arena, jogador↔jogador e de clube |
| Escopo | Plano completo detalhado de todos os domínios |

---

## 1. Visão geral da arquitetura

```
3 apps (jogador, gerente, admin) + PWA + Android/iOS
        │  REST + WebSocket + FCM push
        ▼
   FastAPI (API) ───────────► Redis (cache, pub/sub, rate-limit, locks)
        │  │                  │
        │  └── Celery ────────┘  (push, expiração, repasse, webhooks)
        ▼
 PostgreSQL (fonte da verdade)  +  Alembic (migrações)
```

### Princípios (docs/QADRAS-DOCUMENTACAO-COMPLETA.md §12 e checklist §14)

- Toda regra de negócio no servidor; o cliente nunca envia `role`, `de`, `cliente` ou `status` livre.
- Disponibilidade = lock transacional no Postgres (constraint única de slot), não apenas cache.
- Valores em **centavos (int)**, timezone `America/Sao_Paulo`, timestamps `timestamptz`.
- Comandos financeiros e de reserva com **idempotency key**.
- Auditoria de ações de gerente/admin + eventos de domínio (outbox).
- 401 para sessão inválida, 403 para falta de permissão, 404 para recurso inexistente, 409 para conflito de disponibilidade/duplicidade.
- Um único contrato REST mantido em todas as superfícies (mobile, desktop, gerente, admin).

### Estrutura-alvo de `backend/app/`

```
backend/app/
  core/         config, database (SQLAlchemy), redis, celery, security (JWT), errors,
                timezone, idempotency, domain_events (outbox)
  models/       SQLAlchemy 2.0 (todas as tabelas abaixo)
  schemas/      Pydantic DTOs por domínio
  repositories/ acesso a dados
  services/     casos de uso transacionais
  api/          routers por domínio + websocket.py
  auth/         dependências current_user / current_manager / current_admin
  workers/      tarefas Celery + schedule (beat)
  notifications/ push FCM + notificações in-app
  payments/     provider adapter (base + MockProvider + futuro Asaas)
```

---

## 2. Modelo de dados (PostgreSQL)

### 2.1 Identidade e sessão

- **users** — id uuid, email único, password_hash (bcrypt), name, phone, photo, city, state, lat, lng, position, level, birth_date, foot, favorite_sport, rating, provider (`password`/`google`), onboarded_at, role (`jogador`/`gerente`/`admin`), last_active_at, created/updated/deleted_at (soft delete).
- **user_sessions** — id, user_id, access_jti, refresh_token (hash), device_info, expires_at, revoked_at.
- **user_devices** — id, user_id, fcm_token, platform (android/ios/web), app_version, created/updated_at.
- **user_preferences** — user_id, notifications_enabled, default_sport, default_radius, privacy.
- **user_favorites** — user_id + arena_id (PK composta), created_at.

### 2.2 Arenas, quadras e disponibilidade

- **arenas** — id, owner_id → users, name, description, logo, phone, email, pix_key, endereço (address, city, state), lat, lng, location (PostGIS), is_active, boosted_until, settings jsonb, deactivation (motivo/período).
- **courts** — id, arena_id, name, sport, description, price_cents, price_monthly_cents, min_duration_h, opening_time, closing_time, is_active, is_visible, is_featured, photos (array), amenities (jsonb), created/updated_at.
- **court_blocks** — id, court_id, start_at, end_at, reason (manutenção/evento).
- **court_recurring_availability** — id, court_id, day_of_week, start_time, end_time (horários fixos de funcionamento).

### 2.3 Reservas (máquina de estados §9.1 da documentação)

- **bookings** — id uuid, code `PQ-XXXX`, arena_id, court_id, user_id, status (`draft` → `pending_payment` → `payment_confirmed` → `requested` → `confirmed` → `completed`, com saídas `payment_failed`/`rejected`/`cancelled`/`expired`/`refunded`), start_at, end_at, duration_h, plan (`avulso`/`mensalista`), quote_snapshot jsonb (preço/fee/total no momento), payment_method, coupon_id, source (`app`/`manual`), created_by, **UNIQUE(court_id, start_at)** ← garante anti-dupla-ocupação, idempotency_key única, created/updated/cancelled/completed_at.
- **booking_status_events** — id, booking_id, from, to, actor_id, actor_role, reason, created_at (auditoria das transições).
- **booking_quotes** — id, court_id, start_at, duration_h, subtotal_cents, service_fee_cents, total_cents, expires_at, status, idempotency_key.

### 2.4 Pagamento, carteira e financeiro

- **payments** — id, booking_id, user_id, provider, method (`pix`/`card`), amount_cents, status, provider_ref, webhook_id único (idempotência), payload jsonb, paid_at, created_at.
- **wallet_ledger** — id, user_id, arena_id?, booking_id?, type (`credit`/`debit`), amount_cents, status, origin, reference, idempotency_key única, metadata jsonb, created_at. (ledger imutável, §4.9 da documentação)
- **coupons** — id, arena_id?, code único, discount_type, discount_value, expires_at, usage_limit, used_count, active.
- **settlements** — id, arena_id, period, gross_cents, platform_fee_cents (3%), payout_cents, status (open/scheduled/paid/failed), paid_at, proof_url.
- **settlement_items** — settlement_id + booking_id.

### 2.5 Mensagens e conversas

- **conversations** — id uuid, kind (`arena`/`user`/`club`), arena_id?, player_id?, user_a_id?, user_b_id?, club_id?, related_booking_id?, status, created/updated_at.
- **conversation_participants** — conversation_id, user_id, last_read_at, last_read_message_id.
- **messages** — id uuid, conversation_id, sender_id, content, message_type (`text`/`image`/`system`), created_at.
- **message_reads** — message_id + user_id, read_at.

### 2.6 Notificações

- **notifications** — id, user_id, type (`booking.requested`/`confirmed`/`rejected`/`payment.confirmed`/`message.new`/...), title, body, data jsonb, read_at, created_at.

### 2.7 Clubes, peladas, partidas

- **clubs** — id, name, code único, sport, city, state, description, photo, owner_id.
- **club_members** — club_id + user_id, role (`dono`/`membro`), joined_at.
- **peladas** — id, club_id?, kind (`clube`/`avulsa`), title, court_id, arena_id, start_at, duration, max_players, organizer_id, status, **source_booking_id** (evita duplicar reserva, §9.5 da documentação).
- **pelada_attendance** — pelada_id + user_id, value (`sim`/`talvez`/`nao`).
- **matches** — id, pelada_id?, booking_id?, status (`scheduled`/`live`/`ended`), started/ended_at.
- **match_teams** — id, match_id, name, color, score.
- **match_players** — match_id, user_id, team_id, presence, delay_minutes.
- **match_events** — id, match_id, type (`goal`/`card`/`period`), team_id, player_id, data jsonb.
- **match_media** — id, match_id, type, url, uploaded_by.

### 2.8 Avaliações

- **reviews** — id, booking_id, arena_id, user_id, rating 1-5, comment, reply, replied_by, replied_at.

### 2.9 Plataforma/telemetria

- **audit_logs** — id, actor_id, actor_role, action, entity_type, entity_id, arena_id, correlation_id, data jsonb.
- **domain_events** (outbox) — id, event_type (lista §13 da documentação), occurred_at, actor_id, actor_role, arena_id, entity_type, entity_id, correlation_id, data jsonb, delivered_at. **Fase 7 adiada**: a emissão é **direta** nos mutators (notificação in-app + WS + push no pós-commit, com `ignore_result=True`); o outbox entra quando houver múltiplos consumidores e necessidade de garantia de entrega.

### 2.10 Geo

- Extensão **PostGIS** nas arenas (coluna `location geography(Point)`) com índice GiST para busca por raio escalável; fallback haversine até a migração.

---

## 3. Autenticação e autorização

- `passlib[bcrypt]` para hash; `pyjwt` para tokens (access ~1h, refresh ~30d).
- `auth/` com dependências: `current_user`, `current_manager` (valida vínculo com `arenas.owner_id`), `current_admin` (role admin). Toda leitura/escrita identifica o usuário pelo token.
- Login Google: validar `idToken` (JWKS do Google) antes de criar/reaproveitar conta.
- `role` é autorização do servidor: `jogador`, `gerente` e `admin`.
- Gerente só acessa arenas às quais está vinculado; admin acessa a plataforma inteira.
- Rotas públicas vs protegidas; `REQUIRE_LOGIN` no frontend passa a `true` quando a API estiver ligada.

### Fluxo

1. `POST /api/auth/register` ou `/login` ou `/google` → retorna `{ token, user, isNew }` (mesmo contrato que `services/auth.js` já guarda em `pq:auth_token`/`pq:auth_user`).
2. Refresh: `POST /api/auth/refresh` com refresh token válido → novo access token.
3. Logout: `POST /api/auth/logout` revoga a sessão (blacklist no Redis + `revoked_at` no banco).
4. Rotas protegidas usam `Authorization: Bearer <token>`.

---

## 4. Redis — responsabilidades exatas

- **Cache** de leitura: listas de quadras/esportes/destaques (TTL), resultados de busca com raio.
- **Rate limiting** por IP/usuário (`slowapi` ou `limits` sobre Redis).
- **Pub/sub** para fanout do WebSocket entre workers (canal por `user_id` e por `arena_id`).
- **Blacklist** de JWT revogados e refresh tokens.
- **Nota:** o lock de disponibilidade é transacional no Postgres (`UNIQUE(court_id, start_at)` + validação com `SELECT ... FOR UPDATE`). Redis NÃO decide reserva.

---

## 5. Celery — tarefas e agendamento

- **Broker:** Redis. **Beat schedule:**
  - Expirar cotações/slots `pending_payment` não pagos (a cada minuto).
  - Concluir reservas após o horário (`→ completed`).
  - Gerar `settlements` semanais e marcar repasses.
  - Enviar push FCM em massa (quando houver outbox `domain_events`; na F7 o dispatch é direto nos mutators).
  - Limpeza de sessões/notificações antigas.
- **Assíncronas:** dispatch de push (FCM), processamento de webhook de pagamento (idempotente), notificações in-app, upload/processamento de mídia.

---

## 6. Tempo real — WebSocket

- Endpoint `WS /ws?token=...`, autenticado; `ConnectionManager` com Redis pub/sub (multi-worker seguro).
- Eventos enviados: `message.new`, `booking.updated`, `notification.new`, presença em partida.
- **Fallback:** app em background → push FCM. O cliente faz poll de `GET /api/notifications` e `GET /api/reservas/{id}` quando o WS não está ativo (idempotente, §4.6 da documentação).

---

## 7. Push notifications (Firebase FCM)

- Plugin **`@capacitor/push-notifications`** no `www-usuario` (Android `google-services.json`, iOS APNs, web VAPID).
- `POST /api/devices` registra `fcmToken` por usuário (tabela `user_devices`; upsert, token único, transferência de dono).
- **Provider plugável** (`backend/app/services/push/`): `PushProvider` ABC + `MockPushProvider` (padrão, sem rede, grava em `push_logs`) + `FcmPushProvider` (import lazy de `firebase-admin`, ativo só com `FCM_CREDENTIALS_PATH`; sem credencial → 503). Seleção por `PUSH_PROVIDER=mock|fcm`.
- Celery envia **por device** (`user_devices` do destinatário) via task `enviar_notificacao_push(user_id, notification_id, type, title, body, data)` com `ignore_result=True`; cada tentativa grava `push_logs`. Fire-and-forget: sem `ignore_result=True` o backend Redis faz subscribe e trava com o broker fora do ar.
- **Notificação de duas vias (fluxo central do produto), eventos `notifications.type` implementados na F7:**
  1. `payment.confirmed` → push + notificação in-app **ao jogador e ao dono da arena** ("Pagamento confirmado").
  2. Dono aprova → `booking.approved` → push + notificação **ao jogador** ("Reserva confirmada").
  3. Recusa → `booking.rejected` → jogador ("Reserva não aceita").
  4. `booking.cancelled` → jogador + dono; `booking.completed` e `booking.expired` → jogador.
  5. `message.new` → push **ao destinatário da conversa**, sem linha in-app (badge do chat).
- Todos os eventos acima também disparam WebSocket `notification.new` (+ `booking.updated`/`message.new` já existentes).

---

## 8. Geolocalização (Capacitor Geolocation)

- Plugin **`@capacitor/geolocation`** no app; `www-usuario` já monta mapa Leaflet com `lat/lng`.
- `GET /api/quadras?lat=&lng=&raio=` retorna `distancia` calculada; arenas têm `location` PostGIS.
- `#mapa` e `#quadras?agora=` passam coordenadas; servidor limita raio e esconde arenas inativas (§4.3 da documentação).

---

## 9. Rotas FastAPI organizadas (por domínio)

| Domínio | Endpoints principais |
|---|---|
| **auth** | `POST /register /login /google /logout /refresh`, `PATCH /onboarding`, `GET /user`, `GET /gerente/user` |
| **me** | `GET/PATCH /api/me`, `GET/PATCH /api/me/preferences`, `GET/POST/DELETE /api/me/favorites/{arena_id}`, `POST /api/devices` |
| **quadras** | `GET /api/quadras?local&esporte&raio&q&agora&lat&lng` (paginado), `/esportes`, `/destaques`, `/{id}`, `/{id}/horarios?data=`, `/{id}/resumo`, `/{id}/avaliacoes` |
| **reservas** | `POST /api/reservas/quote`, `POST /api/reservas` (idempotência), `GET /api/reservas`, `GET /{id}`, `POST /{id}/cancelar`, `GET /{id}/events` (ou WS) |
| **pagamentos** | `POST /api/payments`, `GET /api/payments/{id}`, `POST /api/payments/webhook/{provider}`, `GET /api/carteira` |
| **mensagens** | `GET/POST /api/conversations`, `GET/POST /{id}/messages`, `POST /{id}/read` |
| **notificações** | `GET /api/notifications`, `POST /{id}/read`, `POST /read-all` |
| **gerente** | `GET /api/gerente/overview`, `/agenda`, `GET/POST /reservas`, `GET /reservas/{id}`, `POST /reservas/{id}/aprovar\|recusar\|cancelar\|concluir`, `GET/POST/PATCH /courts`, `GET/POST/PATCH/DELETE /mensalistas`, `GET /financeiro`, `GET/PATCH /perfil`, `GET/PATCH /configuracoes`, `GET/POST/DELETE /cupons`, `POST /desativacao`, `GET /avaliacoes` |
| **clubes** | `GET/POST /api/clubs`, `GET /clubs?codigo=`, `POST /{id}/join\|leave`, `DELETE /{id}`, `GET/POST /{id}/messages` |
| **peladas/partidas** | `GET/POST /api/peladas`, `POST /peladas/{id}/presenca`, `GET /matches/active\|history`, `POST /matches/{id}/score\|goal\|card\|teams\|end\|rate\|confirm\|delay\|share-location\|media` |
| **admin** | `GET /api/admin/overview?periodo=`, `/arenas`, `/reservas`, `/clubs`, `/users` + ações administrativas com auditoria |

Contratos alinhados aos nomes que `www-usuario/services/venues.js` e `services/auth.js` já chamam (ex.: `{quadras}`, `{reservas}`, `{conversas}`), minimizando mudança no cliente.

---

## 10. Estrutura do projeto e EasyPanel

Deploy em **EasyPanel** (VPS + Docker + Traefik). Todos os containers vivem no EasyPanel — não é preciso Docker na máquina local.

### Apps criados no EasyPanel

| App | Origem | Detalhe |
|---|---|---|
| PostgreSQL | template do EasyPanel | credenciais entram em `DATABASE_URL` |
| Redis | template do EasyPanel | credenciais entram em `REDIS_URL` |
| api | repositório GitHub (público) | Dockerfile: `backend/Dockerfile`, porta 8000, domínio `api.qadras.com.br` |
| worker | mesmo repositório | comando `celery -A app.core.celery_app:celery_app worker` |
| beat | mesmo repositório | comando `celery -A app.core.celery_app:celery_app beat` |

> A instância do Celery vive em `app/core/celery_app.py` (broker/backend = Redis); as tarefas em `app/workers/tasks.py`. O agendamento (beat) cresce nas Fases 4–7.

### Variáveis de ambiente (mesmo conjunto nos 3 apps)

```
DATABASE_URL=postgresql+psycopg://USUARIO:SENHA@<app-postgres>:5432/qadras
REDIS_URL=redis://:SENHA@<app-redis>:6379/0
JWT_SECRET=<openssl rand -hex 32>
CORS_ORIGINS=https://app.qadras.com.br,https://gerente.qadras.com.br,https://admin.qadras.com.br
ENVIRONMENT=production
TIMEZONE=America/Sao_Paulo
```

Referência completa: `backend/.env.example`. Nenhum segredo entra no repositório.

### Fluxo de deploy

1. `git push` para o GitHub.
2. No EasyPanel, clicar em **Redeploy**.
3. O entrypoint (`backend/docker-entrypoint.sh`) roda `alembic upgrade head` (idempotente) → seed apenas se vazio → sobe uvicorn na porta 8000.

### Arquivos de infraestrutura

- `backend/Dockerfile` — imagem Python 3.12 (build context: raiz do repositório)
- `backend/docker-entrypoint.sh` — migração + seed + uvicorn
- `backend/.dockerignore`
- `backend/.env.example` — todas as variáveis documentadas
- `backend/alembic/` + `alembic.ini` — migrações (initial: tabela `users`)
- `backend/app/seed.py` — usuários demo (`u-gabriel`, gerente, admin), idempotente

---

## 11. Execução por fases

1. **Fundação:** Docker + config + SQLAlchemy + Alembic + seed + Redis + Celery wiring + health.
2. **Auth:** users, sessões, JWT, roles, Google, onboarding, `current_user/manager/admin`.
3. **Arenas/quadras + geo:** CRUD público de quadras, horários reais, busca por raio/cache.
4. **Reservas:** cotação, lock de slot, criação idempotente, máquina de estados, cancelamento, WS de status.
5. **Pagamentos:** adapter mock + webhook idempotente + ledger + `GET /api/carteira`.
6. **Mensagens:** conversas (arena/user/club), WS, badges, autorização de vínculo (§3.2 da documentação).
7. **Notificações:** ~~FCM, `user_devices`, notificações in-app, eventos de domínio → dispatch~~ → **concluída na F7**: `notifications`/`user_devices`/`push_logs`, API `/api/notifications` + `/api/devices`, push plugável (mock/FCM), hooks nos mutators, WS `notification.new`. Outbox `domain_events` adiado (emissão direta).
8. **Gerente:** overview, agenda, aprovação, CRUD quadras, financeiro/repasse, mensalistas, cupons, avaliações.
9. **Clubes/peladas/partidas:** CRUD, presença, partida ativa, placar/eventos.
10. **Admin:** overview/arenas/reservas/clubs/users + ações com auditoria.
11. **Frontend wiring + plugins:** `app.config.js` com `API_BASE_URL` nos 3 apps, `REQUIRE_LOGIN=true`, instalar/registrar plugins Push e Geolocation, substituir mocks por API.
12. **Hardening:** rate limit, testes (auth, disponibilidade concorrente, pagamento, chat), telemetria, deploy.
