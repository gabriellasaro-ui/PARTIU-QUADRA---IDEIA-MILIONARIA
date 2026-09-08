# Lembrete — remover dados de teste e credenciais do repositório

## O que
Arquivos de teste/legado do backend versionados no git que devem ser
removidos quando o sistema sair do ambiente de teste:

- `backend/state.json`
- `backend/ag25.json`
- `backend/ritmo.json`
- `backend/notif.json`
- `backend/err.bin`
- `senha do admin.txt`

## Por que
- `state.json`, `ag25.json`, `ritmo.json`, `notif.json` contêm **dados de
  demonstração/clientes** (nomes, telefones, reservas) — pertencem ao app
  legado, não ao repositório.
- `err.bin` é um dump de erro.
- `senha do admin.txt` contém **credenciais de admin** que já estiveram no
  histórico do git. Mesmo trocadas, devem sair do controle de versão e o
  arquivo entrar no `.gitignore`.

## Como remover (quando decidir)
1. `git rm --cached backend/state.json backend/ag25.json backend/ritmo.json \
   backend/notif.json backend/err.bin "senha do admin.txt"` (mantém os
   arquivos localmente).
2. Adicionar os paths ao `.gitignore`:
   ```
   backend/state.json
   backend/ag25.json
   backend/ritmo.json
   backend/notif.json
   backend/err.bin
   senha do admin.txt
   ```
3. `git commit` e `git push`.
4. (Opcional, recomendado para o `senha do admin.txt`) purgar do histórico
   com `git filter-repo` e rotacionar as credenciais que vazaram.