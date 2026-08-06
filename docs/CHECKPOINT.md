# CHECKPOINT — Qadras Backend Definitivo

Data: 06/08/2026 · Fases 1, 2, 3, 4, 5, 6 e 7 concluídas · Próxima: Fase 8 (Gerente)

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

## Pendências futuras (resumo)

| Fase | Domínio |
|---|---|
| 8 | Gerente (dashboard, agenda, aprovação, **financeiro/settlements**, mensalistas) |
| 9 | Clubes/peladas/partidas + mensagens clubes/jogador↔jogador |
| 10 | Admin (overview, arenas, reservas, clubes, pessoas) |
| 11 | Frontend wiring + plugins Capacitor (Push, Geolocation, WebSocket no `venues.js`/`mobile.js` — trocar `Number(id)` por string nos ids de conversa) |
| 12 | Hardening (testes, rate limit, deploy) |

Fora de escopo da F7 (adiados): wire do frontend (F11), provider FCM real com credenciais (pronto — basta `FCM_CREDENTIALS_PATH`), outbox `domain_events` (quando houver consumidores múltiplos).

Fora de escopo da F6 (adiados): conversas de clube e jogador↔jogador (F9), wire do WebSocket/chat no frontend (F11), notificações in-app/push (F7), upload de imagem nas mensagens.

Fora de escopo da F5 (adiados): carteira/ledger e top-up, `GET /api/carteira` real, settlements/repasse (F8), cupons (F8), tokenização de cartão, provedor real (interface pronta), WebSocket de status (F6).
