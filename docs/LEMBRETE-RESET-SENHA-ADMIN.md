# Lembrete — resetar a senha do admin (pendente)

## O que
Resetar a senha do `admin@qadras.com.br` no ambiente EasyPanel.

## Por que
O deploy atual usa `ENVIRONMENT=staging` e nenhuma `ADMIN_PASSWORD` foi
definida: sem ela, a senha do admin é a demo `qadras123`. Queremos uma
senha própria e segura.

## Como fazer (quando decidir)
1. Nas Variables do app **api** no EasyPanel, adicionar:
   - `ADMIN_PASSWORD=<nova senha forte>`
   - `RESET_ADMIN_PASSWORD=true`  (necessário só se o admin já existir no banco)
2. Redeploy da **api** (o seed roda no boot e regrava o hash).
3. Confirmar login com a nova senha.
4. **Remover `RESET_ADMIN_PASSWORD`** das Variables e redeploy — senão todo
   redeploy redefine a senha.

## Referência
Código: backend/app/seed.py (linhas 74-110, 166-175).
Depende da guarda: com `ENVIRONMENT=staging` e `ADMIN_PASSWORD` vazia, a
senha é `qadras123`; em production seria sorteada e impressa no log.