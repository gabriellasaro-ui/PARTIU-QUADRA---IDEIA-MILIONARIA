# CHECKPOINT — Qadras Backend Definitivo

Data: 05/08/2026 · Fases 1 e 2 concluídas · Próxima: Fase 3 (Arenas/geo)

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

## Pendências futuras (resumo)

| Fase | Domínio |
|---|---|
| 3 | Arenas/quadras + geo (PostGIS, horários, raio) |
| 4 | Reservas (cotação, lock de slot, máquina de estados) |
| 5 | Pagamentos (adapter mock, webhook, ledger) |
| 6 | Mensagens (conversas, WS, badges) |
| 7 | Notificações (FCM) — requer conta Firebase + `google-services.json` |
| 8 | Gerente (dashboard, agenda, aprovação, financeiro, mensalistas) |
| 9 | Clubes/peladas/partidas |
| 10 | Admin (overview, arenas, reservas, clubes, pessoas) |
| 11 | Frontend wiring + plugins Capacitor (Push, Geolocation) |
| 12 | Hardening (testes, rate limit, deploy) |
