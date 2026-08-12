# CHECKPOINT — Qadras Backend Definitivo

Data: 11/08/2026 · Fases 1, 2, 3, 4, 5, 6, 7, 8 e 9 concluídas · Próxima: Fase 10 (Admin)

## Decisões fixadas

- Preço/comissão: **9% jogador por cima** + **3% arena por dentro** (R$120 → R$130,80 / R$116,40 / R$14,40).
- Pagamento: adapter plugável + mock primeiro.
- Push: Firebase FCM. Tempo real: WebSocket. Mensagens: jogador↔arena, jogador↔jogador, clube.
- Deploy: EasyPanel (Postgres, Redis, api, worker, beat como apps).

## Já feito (Fase 1 — Fundação)

| Item | Status |
|---|---|
| `backend/requirements.txt` (sqlalchemy, psycopg, alembic, pydantic-settings, redis, celery) | ✅ |
| `core/config.py` (env via pydantic-settings, taxas, CORS) | ✅ |
| `core/database.py` (SQLAlchemy 2.0, engine/session/Base, `check_database`) | ✅ |
| `core/redis.py` (cliente + `ping_redis`) | ✅ |
| `core/celery_app.py` (broker Redis, beat schedule) | ✅ |
| `models/user.py` — tabela `users` (uuid, role, provider, soft delete) | ✅ |
| `workers/tasks.py` — tarefa `ping` (prova wiring) | ✅ |
| Alembic — migração inicial `b2e5a1c3d4f6` (cria `users`) | ✅ |
| `app/seed.py` — idempotente (u-gabriel, gerente, admin) | ✅ |
| `Dockerfile` + `docker-entrypoint.sh` (migra → seed → uvicorn) + `.dockerignore` | ✅ |
| `backend/.env.example` + `.gitignore` (`!.env.example`) | ✅ |
| `main.py` — CORS via config + `/api/health` (DB+Redis) | ✅ |
| `docs/Plano_Backend_Definitivo.md` §10 atualizado (EasyPanel) | ✅ |
| Verificação: imports OK, `alembic upgrade head --sql` OK, smoke test da API OK (health = degraded sem DB/Redis locais, demais endpoints funcionando) | ✅ |

**Não commitado** — alterações pendentes em `git status` (aguardando confirmação).

## Fase 2 — Auth (concluída)

| Item | Status |
|---|---|
| Deps: `bcrypt==4.2.0`, `pyjwt`, `google-auth` (passlib removido — quebra com bcrypt 5.x) | ✅ |
| `models/user_session.py` — `user_sessions` (access_jti, refresh hash, expires/revoked) | ✅ |
| `users` ampliado: birth_date, foot, favorite_sport, rating | ✅ |
| Migração `c7a9e4b2f8d1` (fase 2 auth) — SQL renderizado OK | ✅ |
| `auth/security.py` — bcrypt, JWT access (jti/sid/sub, exp do settings), refresh opaco sha256 | ✅ |
| `auth/deps.py` — `current_user`, `current_manager`, `current_admin` (Bearer; 401/403) | ✅ |
| `POST /api/auth/register` (409 dup), `/login`, `/google` (503 sem `GOOGLE_CLIENT_ID`), `/logout` (blacklist Redis + revoga sessão), `/refresh` (rotação) | ✅ |
| `PATCH /api/auth/onboarding` (protegido) | ✅ |
| `GET /api/auth/user` e `GET /api/auth/gerente/user` — contrato antigo mantido (mock como fallback sem token) | ✅ |
| Seed com `password_hash` (demo: `qadras123`) | ✅ |
| `schemas/auth.py` — `{token, user, isNew, refreshToken}`; `user` camelCase (birthDate, memberSince, onboardedAt, role aditivo) | ✅ |
| Verificação: fluxo completo register/login/refresh/logout/onboarding + guards de role + login demo, tudo no SQLite | ✅ |

Senhas demo: `gabriel@email.com` (jogador), `dono@arenabolanarede.com.br` (gerente), `admin@qadras.com.br` (admin) — todas `qadras123`.

## Fase 3 — Catálogo (concluída)

| Item | Status |
|---|---|
| Models: `arena` (owner_id, lat/lng, boosted_until, settings), `court` (preço em centavos, photos/amenities, abertura/fechamento), `court_block`, `court_recurring_availability` (dow 0=segunda), `review` (booking_id nulo por ora), `user_favorite` (PK composta user_id+arena_id) | ✅ |
| Migração `d2b4f6a8c9e0` (fase 3 catálogo) — SQL renderizado OK (9 CREATE TABLE, JSONB no Postgres) | ✅ |
| `core/cache.py` (cache_get/set fail-open, `catalog_version`/`bump`), `core/geo.py` (haversine), `core/timezone.py` | ✅ |
| `repositories/venues.py` — catálogo (só arena ativa/court visível), review_stats, reviews, availability/blocks, sports, favoritos | ✅ |
| `services/catalog.py` — serializer `to_venue` camelCase (`name, sport, neighborhood, distance, rating, reviews, price, priceMonthly, image, gallery, tags, map, reviewItems`), list/detail/horarios/resumo/esportes/destaques/favoritos | ✅ |
| API `/api/quadras`: list (esporte/q/lat/lng/agora/limit/offset), /esportes?destaque, /destaques, /{id}, /{id}/horarios?data=, /{id}/resumo?hora=&dur=, /{id}/avaliacoes | ✅ |
| API `/api/favoritos`: GET opcional (sem token → `{quadras:[]}`), POST/DELETE autenticados (check-then-insert, sem `on_conflict` PG-only) | ✅ |
| Seed idempotente por entidade: 6 arenas/courts espelhando mock VENUES (preços em centavos), 10 reviews/arena (rating real), favoritos do gabriel, 2 blocks de exemplo (manutenção/evento) | ✅ |
| Verificação integração SQLite: list (6, shape camelCase, ordenação boost→rating→dist), filtros esporte/q, geo haversine, `agora`, paginação, detalhe (gallery/tags/reviewItems), horarios (blocks busy 12–13h e 09h), resumo (R$120 → R$130,80), esportes/destaques, favoritos (401/404/toggle/idempotência), idempotência do seed 2× | ✅ |

Detalhes que os testes pegaram e já estão corrigidos:
- `JSONB` quebrava `create_all` no SQLite → `JSON().with_variant(JSONB, "postgresql")` em `models/_types.py`.
- Comparação de UUID string × coluna UUID falhava no SQLite → parse `_uuid` em `repositories/venues.py` e `api/favoritos.py`.
- Block do seed gravado em UTC voltava naive do SQLite e `_as_local` assumia fuso local → naive agora é tratado como UTC (`services/catalog.py`).
- `_is_open_now(db, r[1])` recebia a Arena em vez do Court (`list_venues`) → `r[0]`.
- `on_conflict_do_nothing` é só do dialect PG → check-then-insert portátil em `favoritar`.

**Não commitado** — Fases 1+2+3 pendentes em `git status` (aguardando confirmação).

## Fase 4 — Reservas (concluída)

Decisões aprovadas pelo dono: **paga primeiro** (conforme doc §9.1, não aprova-antes-cobra), **aprovação/recusa do gerente já na F4**, **mensalista completo** (4 sessões semanais), **status via polling** (`/events`; WebSocket fica na Fase 6).

| Item | Status |
|---|---|
| `models/booking.py` — `bookings` (code único, FKs arena/court/user, start_at/end_at, duration_h, weekday, subtotal/service_fee/total_cents, quote_snapshot JSONB, group_id, is_session, idempotency_key único, source, created_by, cancelled_at/completed_at; `UNIQUE(court_id, start_at)` `uq_booking_slot`) + `booking_status_events` (booking_id CASCADE, from/to, actor) | ✅ |
| Migração `e5a7c9b1d3f2` (fase 4 reservas) — SQL renderizado OK (bookings, events, índices, JSONB) | ✅ |
| `core/config.py` — `booking_payment_expire_minutes=15`, `booking_approval_expire_minutes=15`, `booking_code_prefix="PQ-"` | ✅ |
| Máquina de estados `services/bookings.py`: `pending_payment → payment_confirmed → requested → confirmed → completed`; saídas payment_failed/rejected/cancelled/expired/refunded; transições por papel (`ROLE_JOGADOR/GERENTE/ADMIN/SISTEMA`) | ✅ |
| `create_booking`: cotação 100% server-side (avulso `price*dur`; mensalista `price_monthly` como base), Idempotency-Key obrigatório (replay devolve a reserva), lock da court (`FOR UPDATE`) + overlap com ativas + blocks, 409 se passado/ocupado, code `PQ-xxxxx`, mensalista = 4 bookings (sessões 2–4 `is_session` total 0, `group_id` compartilhado) | ✅ |
| `pay_booking` (mock F4) → payment_confirmed → requested; `approve/reject` (gerente dono da arena, 403 c.c.); `cancel` propaga ao grupo; `expire_stale`/`complete_finished` (janelas 15min, worker); `create_review` (só completed, 1 por booking) | ✅ |
| `repositories/bookings.py` — lock_court, overlapping_bookings, get/list/events, idempotência, grupo, arena; bounds de query normalizados para UTC-naive (SQLite) | ✅ |
| API `/api/reservas`: POST /quote, POST "" (Idempotency-Key), GET "" (lista do jogador, só pais, grupos `proxima`/`historico`), GET /{id} (+events), GET /{id}/events, POST /pagar|/aprovar|/recusar|/cancelar|/avaliar | ✅ |
| Contrato app: `{reservas:[{id, code, venueId, venueName, sport, neighborhood, image, date, dateValue, hour, endHour, duration, plan, weekday, subtotal, serviceFee, price, status, statusClass, group, statusAt}]}` — espelha `INITIAL_RESERVATIONS` + `renderReservations` | ✅ |
| Disponibilidade `/horarios` marca `busy` com reservas ativas (pending_payment→completed) além dos blocks | ✅ |
| Celery: tasks `expirar_reservas` (60s) e `concluir_reservas` (300s) no beat | ✅ |
| Seed idempotente de bookings demo (confirmada, pendente, grupo mensalista, concluída) espelhando INITIAL_RESERVATIONS | ✅ |
| Verificação integração SQLite (41 asserts): horarios busy, cotação avulso/mensalista, 422 sem chave, replay, 409 slot/passado, mensalista 4 sessões, lista só pais, pagar→Solicitada, events chain, avaliar só concluída, 403 cross-user/gerente alheio, aprovar/recusar dono, cancelar grupo (4 sessões), expire (pagar depois 409), complete (Concluída), avaliar + duplicidade, seed 2× idempotente | ✅ |

Detalhes que os testes pegaram e já estão corrigidos:
- Datas naive do SQLite são paredes UTC: queries de sobreposição (`overlapping_bookings`, `blocks_for_court`) e `complete_finished` agora convertem bounds para UTC-naive (`_utc_naive`); gravação usa `.astimezone(UTC).replace(tzinfo=None)` em `create_booking` e no seed.
- UUID guardado como hex no SQLite: atualizações de teste usam ORM (bind nativo), não `text()` cru.

**Não commitado** — Fases 1+2+3+4 pendentes em `git status` (aguardando confirmação).

## Fase 5 — Pagamentos (concluída)

Decisões aprovadas pelo dono: **sem carteira/ledger na F5** (top-up e `GET /api/carteira` real ficam para depois), **Pix mock + auto-confirmação** (task confirma ~15s após criar; webhook manual disponível para testes), **settlements/repasse adiados para F8**. O adapter é plugável (`settings.payment_provider`); o fluxo segue o doc §4.5 — **nunca marcar como pago só porque o botão foi clicado**.

| Item | Status |
|---|---|
| `models/payment.py` — `payments` (booking_id FK UNIQUE, user_id FK, provider, method pix/card, amount_cents, status pending/confirmed/failed/refunded, provider_ref, webhook_id UNIQUE, payload JSONB, qr_code/qr_code_image, expires_at, paid_at) | ✅ |
| Migração `f6a8b1c3e5d4` (fase 5 pagamentos) — SQL renderizado OK (UNIQUE booking_id/webhook_id, índices user_id/status) | ✅ |
| `core/config.py` — `payment_provider="mock"`, `payment_mock_confirm_seconds=15` | ✅ |
| `services/payments/` — `base.py` (PaymentIntent/WebhookResult + ABC PaymentProvider), `mock.py` (MockProvider: Pix copia-e-cola fake, expira 15min, `auto_result` para a task), `factory.py` (`get_provider` por settings) | ✅ |
| `pay_booking` → cria o intent Pix no provider, **não transiciona**; reserva segue `pending_payment` até o webhook; 2º `/pagar` devolve o mesmo intent (`replay`); sessão de mensalista → 409; expirada → 409 | ✅ |
| `confirm_payment` idempotente por `webhook_id`/`provider_ref` (replay silencioso; `webhook_id` UNIQUE): `pending_payment → payment_confirmed → requested`; webhook em booking terminal → Payment `refunded` (nunca volta terminal); status failed → `payment_failed`; re-confirm após failed → replay | ✅ |
| `expire_stale` também marca o Payment pendente como `failed` | ✅ |
| `serialize_payment` camelCase `{id, bookingId, provider, method, amount, status, statusLabel, qrCode, qrCodeImage, expiresAt, providerRef}` | ✅ |
| API `/api/payments`: `POST /webhook/{provider}` (sem auth, idempotente, ignora evento não reconhecido) + `GET /{id}` (dono ou admin, 403 c.c.) | ✅ |
| `POST /api/reservas/{id}/pagar` agora retorna `{reserva, payment, replay}` com o intent | ✅ |
| Celery: task `confirmar_pagamentos_pendentes` (beat 10s) auto-confirma mocks pending ≥ 15s | ✅ |
| Verificação integração SQLite (58 asserts): regressão F1–F4 + intent no `/pagar` sem transicionar, pagar 2× mesmo intent, GET payment 200/403/admin, sessão de mensalista 409, webhook → Solicitada, replay idempotente, pagar após pago 409, events chain, aprovar/recusar com webhook, webhook atrasado → refunded, webhook failed, expiração → payment failed, task auto-confirm → Solicitada, complete/avaliação, horarios busy | ✅ |

Detalhes que os testes pegaram e já estão corrigidos:
- Webhook identifica o pagamento por `providerRef` (como provedores reais), não por id interno; `webhook_id` repetido é tratado como replay sem novo commit.
- `list_pending_mock` compara `created_at` com cutoff naive-UTC (SQLite guarda paredes UTC), alinhado ao padrão da F4.
- `services/payments/service.py` ficou em `bookings.py` (usa `_transition_booking`); `services/payments/` tem só o adapter, sem ciclo de import.

## Fase 6 — Mensagens + WebSocket (concluída)

Decisões aprovadas pelo dono: **shape do SPA** (contrato de `mobile.js`/`venues.js`), **backend + testes apenas** (wire do frontend na F11), **conversa criada no pagamento confirmado** (dentro de `confirm_payment`, não na aprovação), **somente `kind=arena`** (clubes e jogador↔jogador na F9). API mantém os paths legados do SPA (`GET /api/mensagens`, `GET /{id}`, `POST /{id}/enviar?texto=`, `GET /nav/badges`) + novo `POST /{id}/read`. `role`/`de` do cliente são **ignorados** — identidade/remetente vêm do token.

| Item | Status |
|---|---|
| `models/message.py` — `conversations` (booking_id UNIQUE), `conversation_participants` (PK composta + UniqueConstraint), `messages` (index conversation_id, CASCADE) + constantes | ✅ |
| Migração `g1b2c3d4e5f6` (fase 6 mensagens) — SQL renderizado OK | ✅ |
| `repositories/messages.py` — get/list por player/gerente/admin, messages, participantes, `count_newer_messages`, `unread_conversation_count` (subqueries `any_msg`/`newer` com `.scalar_subquery()`, cobre caso "nunca leu"), `requested_count` | ✅ |
| `services/messages.py` — `ensure_conversation_for_booking` (hook no `confirm_payment`, idempotente, não commita), `list_conversations`, `get_conversation`, `send_message`, `mark_read`, `badges`; autorização por token (`_can_access`), serialização shape do SPA `{id, bookingId, venueId, venue, subject, messages:[{from, text, time}], unread}` (`from` relativo ao espectador) | ✅ |
| `core/ws.py` — `ConnectionManager` por user_id (fila + loop por conexão, entrega thread-safe), Redis pub/sub `qadras:ws` com `worker_id` (multi-worker, sem loop-back), subscriber em thread com fail-open | ✅ |
| `api/ws.py` — `WS /ws?token=` autenticado (`authenticate_ws`, blacklist) → 1008 se inválido; startup/shutdown do subscriber no `main.py` | ✅ |
| `bookings.py` — hook `ensure_conversation_for_booking` no `confirm_payment` + `_notify_booking_update` publicando `booking.updated` (jogador + dono da arena) em pagar/confirmar/aprovar/recusar/cancelar/expirar/concluir (com `db.flush()` antes do notify nos loops, pois o session é `autoflush=False`) | ✅ |
| `send_message` publica `message.new` só para o destinatário, serializado na **perspectiva do destinatário** (`from` correto de cada lado) | ✅ |
| `seed.py` — conversa demo Gabriel ↔ Arena Bola na Rede (reserva confirmada), idempotente | ✅ |
| Verificação SQLite (46 asserts): regressão F5 + conversa **só** após webhook confirmado, shape do SPA, `de` ignorado nos dois lados, unread/read/badges, 401/403/404 (não-participante, arena sem dono fora do gerente, inexistente), reserva sem pagamento sem conversa, seed 2×, WS `booking.updated`/`message.new`/token inválido→1008, `alembic --sql` OK | ✅ |
| Postgres externo: `alembic upgrade head` → `g1b2c3d4e5f6` + seed (1 conversa, 2 mensagens, 2 participantes) idempotente | ✅ |
| Redis externo: pub/sub `qadras:ws` round-trip OK | ✅ |

Detalhes que os testes pegaram e já estão corrigidos:
- `unread_conversation_count` quebrava com `Select > int` — corrigido com `.scalar_subquery()` + `.correlate()`.
- Conversa criada para uma arena **sem dono** (owner NULL) só é visível ao admin (gerente não a vê) — comportamento esperado do vínculo `arenas.owner_id`.
- `message.new` precisa serializar para o **destinatário**; serializar para o remetente invertia `from` no cliente.

**Não commitado** — Fases 1+2+3+4+5+6+7 pendentes em `git status` (aguardando confirmação).

## Fase 7 — Notificações + Push FCM (concluída)

Decisões aprovadas pelo dono: **emissão direta** (sem outbox `domain_events` — consistente com a F6; outbox fica adiado), **push plugável** (mock por padrão, gravando em `push_logs` sem rede; `FcmPushProvider` com import lazy de `firebase-admin`, ativo apenas com `FCM_CREDENTIALS_PATH` — igual ao login Google que responde 503), **backend + testes apenas** (wire do frontend na F11). `message.new` é **push + WS apenas** para o destinatário, **sem linha in-app** (o chat já tem badge de não-lidos).

| Item | Status |
|---|---|
| `models/notification.py` — `notifications` (user_id FK, type, title, body, data JSONB, read_at, created_at; índice composto user_id/read_at), `user_devices` (fcm_token UNIQUE, platform, is_active), `push_logs` (user_id, notification_id nullable, provider, status ok/errored, error) + constantes | ✅ |
| Migração `h3b4c5d6e7f8` (fase 7 notificações) — SQL renderizado OK (3 CREATE TABLE + índices) | ✅ |
| `core/config.py` — `push_provider="mock"`, `fcm_credentials_path=""`, `fcm_project_id=""` (+ `.env.example`) | ✅ |
| `services/push/` — `base.py` (PushResult + ABC PushProvider), `mock.py` (sem rede), `fcm.py` (import lazy firebase-admin, inicialização única), `__init__.py` (`get_push_provider()` com `lru_cache`, 503 sem FCM configurado); `firebase-admin==6.5.0` no requirements | ✅ |
| `repositories/notifications.py` — `_uuid` para strings, list/unread/mark_read (só as próprias)/mark_all_read, upsert de device (token transferido ao dono atual), add_push_log | ✅ |
| `services/notifications.py` — `notify_user`/`emit_notification` (cria + commit + dispatch), `dispatch_notification` (WS `notification.new` + Celery `enviar_notificacao_push` com `ignore_result=True`, fail-open), `notify_booking_event` (mapeia evento → título/body pt-BR + destinatários), `notify_message_new` (push sem in-app) | ✅ |
| Hooks pós-commit nos mutators (`bookings.py`): `confirm_payment` → `payment.confirmed` (jogador + dono), `approve/reject` → jogador, `cancel` → ambos, `complete_finished`/`expire_stale` → jogador (coletam `notified` e notificam após o commit); `send_message` (`messages.py`) → push do `message.new` ao destinatário | ✅ |
| API `/api/notifications`: `GET ""` (lista), `GET /unread-count`, `POST /{id}/read`, `POST /read-all` + `/api/devices` `POST ""` (upsert `{fcmToken, platform}`, 401 sem token) — autorização por token | ✅ |
| Celery: task `enviar_notificacao_push(user_id, notification_id, type, title, body, data)` — busca devices do usuário, envia via provider (mock/fcm), grava 1 `push_logs` por dispositivo | ✅ |
| Seed idempotente: 2 notificações demo do Gabriel + 1 device demo | ✅ |
| Verificação SQLite (49 asserts): regressão F5/F6 + devices (401/upsert/troca/transferência), notificação em cada evento (payment.confirmed, approved, rejected, cancelled, completed, expired), `message.new` → push sem in-app, API read/read-all/unread + isolamento cross-user, WS `notification.new` para jogador e dono, push mock grava `push_logs` via task (sem devices → 0), seed 2×, `alembic --sql` com as 3 tabelas | ✅ |
| F5 (58) + F6 (46) continuam verdes (harness F6 adaptado: WS ignora `notification.new` no meio do fluxo) | ✅ |
| Postgres externo: `alembic upgrade head` → `h3b4c5d6e7f8` + seed (2 notificações, 1 device) idempotente | ✅ |

Detalhes que os testes pegaram e já estão corrigidos:
- `celery_app.send_task` sem `ignore_result=True` faz o backend Redis assinar o resultado e entrar em `retry_over_time` infinito com broker fora do ar → fire-and-forget com `ignore_result=True`.
- `push_logs` recebe ids como string do worker → `_uuid()` normaliza para UUID no SQLite.

## Fase 8 — Gerente (concluída)

Decisões aprovadas pelo dono: **reserva manual com `user_id` nulo + `client_name/phone/email`** (sem auto-criar conta; sem chat/carteira para manuais), **cupons só CRUD do gerente** (aplicação no checkout fica para fase de pagamentos futura), **mensalista sem PATCH** (editar = cancelar/recriar), **settlements reais** (tabela própria + task semanal — nunca só leitura derivada). Financeiro sempre do ledger de `payments.confirmed` (nunca status visual).

| Item | Status |
|---|---|
| `models/settlement.py` — `settlements` (arena_id, period_start/end, gross/commission/net_cents, bookings_count, status pending/paid/failed, due_at, paid_at, receipt_url) + `models/coupon.py` — `coupons` (arena_id, court_id nullable, code UNIQUE, discount_percent, active, expires_at, max_uses, used_count) | ✅ |
| `models/booking.py` — `user_id` nullable + `client_name/client_phone/client_email`; `models/payment.py` — `user_id` nullable (Payment `provider=manual` não tem usuário) | ✅ |
| Migração `i4c5d6e7f8a9` (fase 8 gerente) — SQL renderizado e aplicado no Postgres externo (ALTERs user_id → NULL, client_*, CREATE settlements/coupons) | ✅ |
| `repositories/gerente.py` — tudo parte da arena do gerente (`arenas.owner_id`): bookings com cliente, `revenue_for_period` (ledger confirmado; comissão = 9% jogador + 3% arena; líquido = subtotal×0.97), settlements, coupons, courts, avaliações + distribuição 5→1, slots/ocupação, próximas | ✅ |
| `services/gerente.py` — dashboard (KPIs hoje/semana, ocupação, bruto/comissão/repasse, ticket médio, pendências, próximas), agenda (semana `YYYY-MM-DD`, colunas/quadras/horas 8–23/eventos), reservas (lista + filtro status/q), reserva manual (`confirmed` + Payment `manual` confirmado, lock + overlap, `valor` override, 409 passado/ocupado), mensalistas (4 sessões semanais, list/sessões/cancelar grupo), financeiro (`today|7d|30d` + repasses), `generate_settlements` (semana anterior, nunca duplica arena+period_start), quadras (CRUD + esconder da vitrine), avaliações (list + resposta), cupons (CRUD, 409 código duplicado), perfil/config (settings.notifications), desativação (is_active=False + cancelamento das futuras) | ✅ |
| `schemas/gerente.py` — DTOs camelCase (BookingCreate, MensalistaCreate com `dia` 0–6, CourtCreate/Update, AvaliacaoReply, CouponCreate, ArenaProfileUpdate, ArenaConfigUpdate, DesativacaoBody) | ✅ |
| `api/gerente.py` reescrito (removeu mock `core/data`/`domain`/`store`): dashboard, agenda, reservas GET/POST, mensalistas GET/POST/sessoes/DELETE, financeiro, quadras GET/POST/GET{PATCH `{id}`, avaliacoes + resposta, cupons GET/POST/DELETE, perfil GET/PATCH, configuracoes GET/PATCH, desativacao — tudo `get_current_manager` + checagem da arena (403/404 cross-arena) | ✅ |
| Celery: task `gerar_settlements_semanais` + beat `crontab(day_of_week=0, hour=3)` (segunda 03:00) | ✅ |
| Seed idempotente: payments confirmados do ledger (F8), reserva manual "Time da Firma" + Payment manual, cupom `QADRAS10`, settlement pago demo | ✅ |
| Verificação SQLite (77 asserts): 401/403/404 (jogador, gerente sem arena), dashboard, agenda, reserva manual (conflito 409, passado 409, outra arena 404, override de valor), mensalistas (4 sessões, conflito, cancelar grupo), financeiro + `generate_settlements` (cria ≥1, idempotente 0), quadras (CRUD, escondida some da vitrine), avaliações (dist/media/resposta), cupons (duplicado 409, delete), perfil/config, desativação (cancelou futuras, some da vitrine) | ✅ |
| Regressão F4–F7 (24 asserts): criar/pagar/webhook confirmado → conversa + notificação, replay webhook, aprovar, events, mensagem, push mock → push_logs, expire/complete/avaliação, dashboard F8 | ✅ |
| Postgres externo: `alembic upgrade head` → `i4c5d6e7f8a9` + seed (3 payments, 1 manual, 1 coupon, 1 settlement) idempotente | ✅ |

Detalhes que os testes pegaram e já estão corrigidos:
- `payments.user_id` era NOT NULL no model F5 — a reserva manual exigiu `nullable` no model **e** ALTER na migração F8.
- `services/gerente.py` importava `TERMINAL` de `..models` (não existe lá) e usava `STATUS_EXPIRED` sem importar — corrigidos.

**Não commitado** — Fases 1–8 pendentes em `git status` (aguardando confirmação).

## Fase 9 — Clubes / Peladas / Partidas (Game Day) (concluída)

Decisões aprovadas pelo dono: **um clube por usuário** (409 ao entrar em outro sem sair; membro nasce do perfil; sair sendo o último apaga o clube; apagar só dono com clube vazio), **pelada nasce só da reserva** (`reservationCode`/`bookingId`; idempotente por `(source_booking_id, date_iso)`; mensalista gera 4 com +7 dias; data/hora/quadra/esporte sempre derivados da reserva no servidor; `avulsa` a menos que `clubId` explícito), **partida materializada sob demanda** no `GET /api/partidas/ativa` (id estável; janela 48h; exclui reservas cuja partida já encerrou; sem match → `null`), fase `pre/during/post` calculada por timestamps (nunca persistida), código de convite 6 chars sem hífen com alfabeto sem ambíguos (I/L/O/0/1) e match exato.

| Item | Status |
|---|---|
| `models/club.py` — `clubs` (code UNIQUE 6 chars, sport, city, is_active), `club_members` (UNIQUE club+user, role dono/membro, bornFrom, since), `club_messages` (texto≤500, author, read_by JSON) | ✅ |
| `models/pelada.py` — `peladas` (UNIQUE `(source_booking_id, date_iso)`, kind avulsa/clube, arena, sport, date_iso, start_time, duration_min, max_players, organizer, plan, reservation_code, status) + `pelada_attendance` (UNIQUE pelada+user, sim/talvez/nao) | ✅ |
| `models/match.py` — `matches` (booking_id UNIQUE, status scheduled/live/ended, scores JSON, teams JSON `{version,rule,list,onCourt,queue}`, ratings JSON `{userId:stars}`, venue_id/venue_name/venue_photo, organizer_name/phone) + `match_teams/players/events/media` (gol/cartão/tempo/fase), mídia por URL (`type` photo\|video) | ✅ |
| Migração `j5d6e7f8a9b1` (fase 9) — SQL renderizado e aplicado no Postgres externo (10 tabelas + índices + FKs) | ✅ |
| `repositories/clubs.py` (get/list/by_code/is_member/my_club/join/leave/remove/delete/mensagens), `repositories/peladas.py` (by_booking_date/upsert_attendance/visíveis), `repositories/matches.py` (list_candidate_bookings 48h excluindo encerradas, players/events/media, snapshots) | ✅ |
| `services/clubs.py` — criar (409 `active` já existe), código de convite gerado, entrar (409 em outro clube; membro nasce do perfil), sair (último → apaga clube), remover membro (só dono), apagar (só dono, 409 com membros), mural ler/postar (403 não-membro, texto≤500) | ✅ |
| `services/peladas.py` — criar da reserva (403 não é dono/estado inválido, 409 status, 404 sem código, replay idempotente), presença (403 não-membro em pelada de clube, 422 valor), notificação `pelada.criada` p/ membros do clube + `pelada.presenca` p/ organizador | ✅ |
| `services/matches.py` — materialização sob demanda na `ativa`, fase por timestamps (normalizando naive-UTC do SQLite com `_as_local`), placar/gol/cartão/times/fim só organizador (403), confirmar/atraso/nota/mídia/localização de participantes, `end_match` → `partida.encerrada` p/ todos | ✅ |
| `api/clubes.py` (`GET/POST /api/clubes` + `?codigo=`, `POST /:id/entrar\|sair`, `DELETE /:id`, `DELETE /:id/membros/:mid`, `GET/POST /:id/mensagens`), `api/peladas.py` (`GET/POST /api/peladas`, `POST /:id/presenca`), `api/partidas.py` (`GET /ativa\|historico`, `PUT /:id/score`, `POST /:id/goal\|card\|teams\|end\|rate\|confirmar\|atraso\|compartilhar-localizacao\|media`) — app passa a 90 rotas /api | ✅ |
| Constantes de notificação F9 + seed idempotente: clube "Bola na Rede F.C." (code BANRED, 5 membros), 5 peladas (1 avulsa + 4 mensalistas), 1 partida da reserva avulsa confirmada | ✅ |
| Verificação SQLite (99 asserts): clube (convite exato, 1 por usuário, membro nasce do perfil, sair apaga último, dono remove/apaga, mural), pelada (5 seedadas, replay, data/hora derivadas, presença livre/clube, 422/403/404), partida (ativa com id estável, fase pre/during/post, permissões 403, placar/gol/cartão/times/fim, encerrada sai da ativa, histórico, presença/atraso/nota/mídia/localização), notificações + regressão F4–F8 | ✅ |
| Postgres externo: `alembic upgrade head` → `j5d6e7f8a9b1` + seed idempotente (1 clube/5 membros, 5 peladas, 1 partida) | ✅ |

Detalhes que os testes pegaram e já estão corrigidos:
- `bookings_repo.get_booking` retorna 3-tupla `(Booking, Court, Arena)` — `_is_visible`/`_audience` acessavam `booking.user_id` direto (AttributeError) → normalizar com `row[0]`.
- Organizador da partida com `client_name` nulo (reserva via app) → fallback para o nome do usuário (antes vinha `null` no ACTIVE_MATCH).
- Partida encerrada reaparecia na `ativa` (a reserva continua confirmada) → candidatos excluem bookings com `Match.status == ended`.
- Pelada sem `clubId` assumia o clube do usuário (`my_club`) → contrato define `avulsa`; `clube` só com `clubId` explícito.
- `matches.ratings` usa chave string (uuid str) — o `ncount` do harness compara `uuid.UUID` direto (falhava com `'str' object has no attribute 'hex'`); na API o `#rate` normaliza.

**Não commitado** — Fases 1–9 pendentes em `git status` (aguardando confirmação).

## Pendências futuras (resumo)

| Fase | Domínio |
|---|---|
| 10 | Admin (overview, arenas, reservas, clubes, pessoas) |
| 11 | Frontend wiring + plugins Capacitor (Push, Geolocation, WebSocket no `venues.js`/`mobile.js` — trocar `Number(id)` por string nos ids de conversa) |
| 12 | Hardening (testes, rate limit, deploy) |

Fora de escopo da F8 (adiados): wire do frontend gerente (F11), aplicação de cupom no checkout do jogador (fase de pagamentos futura), upload de mídia das quadras, provedor Pix real (interface pronta — `payment_provider` plugável), repasse automático via provedor (task grava settlement; o pagamento ao dono segue fora do backend).

Fora de escopo da F7 (adiados): wire do frontend (F11), provider FCM real com credenciais (pronto — basta `FCM_CREDENTIALS_PATH`), outbox `domain_events` (quando houver consumidores múltiplos).

Fora de escopo da F6 (adiados): conversas de clube e jogador↔jogador (F9), wire do WebSocket/chat no frontend (F11), notificações in-app/push (F7), upload de imagem nas mensagens.

Fora de escopo da F5 (adiados): carteira/ledger e top-up, `GET /api/carteira` real, settlements/repasse (F8), cupons (F8), tokenização de cartão, provedor real (interface pronta), WebSocket de status (F6).
