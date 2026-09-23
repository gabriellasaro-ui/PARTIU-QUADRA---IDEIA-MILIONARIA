# TESTAR MERCADO PAGO — Split 1:1 no sandbox

Runbook para validar o split de pagamentos com contas de teste, antes de virar
para contas reais. Ordem importa: a **Fase 1** conecta a arena, a **Fase 2**
liga a cobrança. Ligar a Fase 2 antes da Fase 1 dar certo faz toda reserva
responder `409`.

- **Ambiente:** `https://api.qadras.com.br`
- **Branch dos services no EasyPanel:** `merge/redeploy-e-correcoes-front`
- **Apps a redeployar, nesta ordem:** `api` → `worker` → `beat`

> **Por que os três, e nessa ordem.** Só o `api` roda `alembic upgrade head`
> (o `Dockerfile` usa `CMD`, e `worker`/`beat` sobrescrevem o comando, então o
> `docker-entrypoint.sh` não executa neles). O `worker` precisa de redeploy
> para conhecer a task `renovar_tokens_mercadopago`; o `beat`, para agendá-la.
> Redeployar só o `api` faz tudo parecer certo hoje e falhar em 180 dias,
> quando os tokens vencerem em silêncio.

---

## Passo 0 — Pegar o token de gerente

O `TOKEN_GERENTE` não está guardado em lugar nenhum: é um JWT gerado no login
e válido por cerca de 1 hora. Se no meio do teste começar a vir `401`, gere
outro — não é problema na integração.

### Rota

```
POST /api/auth/login
Content-Type: application/json
{"email": "...", "senha": "..."}
```

A resposta traz `{"token": "eyJ...", "user": {...}, "refreshToken": "..."}`.
O campo que interessa é **`token`**.

### Forma simples

```bash
curl -s -X POST https://api.qadras.com.br/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"EMAIL_DO_GERENTE","senha":"SENHA"}'
```

### Guardando numa variável (recomendado)

```bash
TOKEN=$(curl -s -X POST https://api.qadras.com.br/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"EMAIL_DO_GERENTE","senha":"SENHA"}' \
  | python -c "import sys,json;print(json.load(sys.stdin)['token'])")

echo "${TOKEN:0:20}..."   # confere que veio algo, sem imprimir o token inteiro
```

Daí em diante, todas as chamadas usam `-H "Authorization: Bearer $TOKEN"`.

### Qual conta usar

A conta precisa de **duas** coisas:

1. `role = gerente`
2. ser **dona de uma arena** (a rota resolve a arena por `arenas.owner_id`)

| Sintoma | Causa |
|---|---|
| `401` | e-mail/senha errados, ou token expirado |
| `403 Acesso restrito a gerentes de arena` | logou como jogador ou admin |
| `404` | é gerente, mas nenhuma arena tem esse `owner_id` |

Se o banco foi semeado pelo `seed.py`, existe `dono@arenabolanarede.com.br`
com senha `qadras123`. Em banco com dados reais, use a conta de um dono de
quadra de verdade.

---

## Fase 1 — Conectar a conta da arena (OAuth)

Aqui a arena autoriza a Qadras a cobrar na conta dela. **Nada é cobrado nesta
fase** — as rotas só guardam credenciais.

### Variáveis no EasyPanel (apps `api` e `worker`)

```
MERCADOPAGO_SPLIT_ENABLED=false
MERCADOPAGO_CLIENT_ID=4296136270617244
MERCADOPAGO_CLIENT_SECRET=<Client Secret de PRODUÇÃO>
MERCADOPAGO_REDIRECT_URI=https://api.qadras.com.br/api/mercadopago/oauth/callback
```

Deixe `PAYMENT_PROVIDER=mock` como está.

> **O flag fica em `false` de propósito.** `MERCADOPAGO_SPLIT_ENABLED` governa
> a **cobrança**, não o OAuth. As rotas de conexão funcionam com ele
> desligado, porque a ideia é conectar todas as arenas primeiro e só então
> ligar a cobrança.

> **Não existe Client Secret de teste.** O par `client_id`/`client_secret`
> aparece **só** em *Credenciais de produção* e serve aos dois ambientes. O
> que faz o teste ser teste é **qual conta autoriza** — autorizando com conta
> de teste, tudo é simulado.

> **O `REDIRECT_URI` tem de ser idêntico ao cadastrado no painel do MP**,
> caractere por caractere, **sem barra final**. Divergência devolve
> `invalid_grant` na troca do code.

### Preparação no painel do Mercado Pago

1. **Suas integrações → sua aplicação → Contas de teste → + Criar conta de teste**
2. Crie **duas**, ambas do Brasil:
   - uma **vendedora** — faz o papel da arena (não precisa de saldo)
   - uma **compradora** — faz o papel do jogador (**dê saldo fictício**)
3. Anote usuário, senha e o código de 6 dígitos de cada uma **na hora**.
   Conta de teste **não pode ser apagada**, e o limite é 15.

### Passo a passo

**1. A API está de pé e o deploy pegou?**

```bash
curl -s https://api.qadras.com.br/api/health
```
Espere `"db":"ok"` e `"redis":"ok"`. O campo `rotas` diz quantas rotas este
build tem — serve para confirmar que a imagem nova subiu.

**2. Estado inicial da conexão**

```bash
curl -s https://api.qadras.com.br/api/mercadopago/status \
  -H "Authorization: Bearer $TOKEN"
```
Espere `{"mercadopago":{"conectada":false,...}}`.

Se vier `404`, o EasyPanel subiu a imagem antiga — confira a branch.

**3. Gerar a URL de autorização**

```bash
curl -s https://api.qadras.com.br/api/mercadopago/oauth/iniciar \
  -H "Authorization: Bearer $TOKEN"
```
Espere `{"url":"https://auth.mercadopago.com.br/authorization?..."}`.

Se vier `503`, alguma das três variáveis do MP não chegou no container.

**4. Autorizar — o passo com pegadinha**

Abra a URL **numa janela anônima, logado como a conta de teste VENDEDORA.**

> Se você estiver logado na sua conta pessoal do Mercado Pago, vai conectar a
> **conta errada** à arena. Funciona tecnicamente, e é justamente por isso que
> passa despercebido: a autorização é legítima, só que da conta errada.

O navegador volta no callback e responde `{"ok": true}`.

**5. Confirmar**

```bash
curl -s https://api.qadras.com.br/api/mercadopago/status \
  -H "Authorization: Bearer $TOKEN"
```

Espere:
```json
{"mercadopago":{
  "conectada": true,
  "expiraEm": "2027-03-...",       // ~180 dias à frente
  "precisaRenovar": false,
  "collectorId": "...",            // user_id da conta de teste vendedora
  "meios": ["pix"]
}}
```

**Só passe para a Fase 2 depois que isso vier `true`.**

### Se precisar refazer

```bash
curl -s -X POST https://api.qadras.com.br/api/mercadopago/desconectar \
  -H "Authorization: Bearer $TOKEN"
```
Depois repita do passo 3. Reconectar **sobrescreve** a linha, não duplica.

### Se o OAuth não se comportar como sandbox

Existe um flag opcional que pede credencial de sandbox do vendedor na troca do
code. Default `false`; ligue **só se necessário** (é variável de ambiente, não
exige deploy de código):

```
MERCADOPAGO_OAUTH_TEST_TOKEN=true
```

---

## Fase 2 — Ligar a cobrança com split

### Variáveis no EasyPanel (apps `api` e `worker`)

```
MERCADOPAGO_SPLIT_ENABLED=true
PAYMENT_PROVIDER=mercadopago
MERCADOPAGO_ACCESS_TOKEN=<Access Token TEST- da aplicação>
PAYMENT_WEBHOOK_SECRET=<assinatura secreta do webhook>
```

O `MERCADOPAGO_ACCESS_TOKEN` continua necessário: é o fallback para pagamentos
criados antes de a arena conectar, e o provider recusa subir sem token.

### Webhook no painel do MP

**Suas integrações → sua aplicação → Webhooks → Configurar notificação**

- URL: `https://api.qadras.com.br/api/payments/webhook/mercadopago`
- Evento: **Pagamentos** (`payment`)
- Copie a **assinatura secreta** gerada → `PAYMENT_WEBHOOK_SECRET`

> Não invente esse valor: ele é **gerado pelo Mercado Pago**. Sem ele,
> qualquer um que conheça o id do pagamento confirma uma reserva sem pagar.

### Redeploy e verificação

Redeploy `api` → `worker` → `beat`. Depois:

```bash
# worker e beat estão vivos? (precisa de token de ADMIN, não de gerente)
curl -s https://api.qadras.com.br/api/health/workers \
  -H "Authorization: Bearer $TOKEN_ADMIN"
```

Procure `app.workers.tasks.renovar_tokens_mercadopago` em
`tarefas_registradas`. Se estiver lá, o redeploy do `worker` pegou.

> O `beat` não responde a ping — ele produz tarefas, não consome. O
> `beat_schedule` na resposta é o que *este build* agenda; só o log do
> container `beat` confirma que ele foi redeployado.

### Teste de ponta a ponta

1. No app do jogador, faça uma reserva na arena conectada
2. Escolha Pix → deve aparecer QR code de verdade (não mais o mock)
3. Pague **com a conta de teste COMPRADORA**
4. A reserva deve sair de `pending_payment` para `payment_confirmed` sozinha,
   via webhook

---

## Rotas usadas

| Rota | Método | Quem chama | Auth |
|---|---|---|---|
| `/api/auth/login` | POST | você | — |
| `/api/health` | GET | você | — |
| `/api/health/workers` | GET | você | admin |
| `/api/mercadopago/oauth/iniciar` | GET | você | gerente |
| `/api/mercadopago/oauth/callback` | GET | navegador (vindo do MP) | — |
| `/api/mercadopago/status` | GET | você | gerente |
| `/api/mercadopago/desconectar` | POST | você | gerente |
| `/api/payments/webhook/mercadopago` | POST | Mercado Pago | assinatura HMAC |

---

## Erros comuns

| O que aparece | O que significa |
|---|---|
| `503` em `/oauth/iniciar` | falta `CLIENT_ID`, `CLIENT_SECRET` ou `REDIRECT_URI` no container |
| `404` em `/mercadopago/status` | imagem antiga no ar — confira a branch no EasyPanel |
| `invalid_grant` no callback | `REDIRECT_URI` diferente do cadastrado no painel (barra final, http vs https) |
| `{"ok":false,"erro":"recusado"}` no callback | o MP recusou a troca do code — code expirado (vale 10 min) ou secret errado |
| `state expirado` | passou de 10 min entre gerar a URL e autorizar. Refaça do passo 3 |
| `409 Esta arena ainda nao conectou a conta de recebimento` | Fase 2 ligada antes da Fase 1 dar certo |
| reserva fica em `pending_payment` para sempre | webhook não está chegando: confira URL e `PAYMENT_WEBHOOK_SECRET` |
| `401` no meio do teste | token de gerente expirou (~1h). Gere outro |

---

## O que verificar no primeiro pagamento real do sandbox

Três coisas que **só o sandbox responde** — nenhuma dá para confirmar na
documentação:

1. **`application_fee` funcionou em Pix?** No painel do MP o pagamento deve
   mostrar a comissão do marketplace separada. A doc é clara para cartão e
   ambígua para Pix — é o risco que sobrou do plano.
2. **Qual a taxa real do MP?** Vem no campo `fee_details` da resposta do
   `/v1/payments`. Hoje presumimos 0,99% em `MERCADOPAGO_DEFAULT_FEE_RATE`. Se
   for diferente, ajuste a variável e o `fee_rate` daquela conexão.
3. **A arena recebeu R$ 97,00 líquidos** (para subtotal de R$ 100,00)? É a
   promessa do contrato de credenciamento. Se der 96,99 ou 97,01, o
   arredondamento precisa de ajuste.

### A conta esperada (subtotal R$ 100,00, Pix a 0,99%)

| Linha | Valor |
|---|---|
| Jogador paga | R$ 109,89 |
| MP retém | R$ 1,09 |
| `application_fee` (Qadras) | R$ 11,80 |
| **Arena recebe** | **R$ 97,00** |
| **Qadras líquido** | **R$ 11,80** |

A Qadras banca a taxa do MP até 0,99% do valor pago; o que exceder é da arena.
No Pix a taxa cabe no teto, então a arena recebe os 97% cheios.

---

## Depois de validado: virar para contas reais

1. Trocar `MERCADOPAGO_ACCESS_TOKEN` de `TEST-` para `APP_USR-`
2. `MERCADOPAGO_OAUTH_TEST_TOKEN=false`
3. **Cada arena real precisa refazer o OAuth** com a conta de verdade dela —
   as conexões de teste não servem. Use `/desconectar` e reconecte
4. Considerar `ENVIRONMENT=production`, que liga as guardas de boot. Antes de
   virar, confirme que estas passam, senão a API não sobe:
   `JWT_SECRET` ≥ 32 chars · `CORS_ORIGINS` ≠ `*` · `PAYMENT_PROVIDER` ≠ `mock`
   · `MERCADOPAGO_ACCESS_TOKEN` sem prefixo `TEST-` ·
   `VERIFICATION_PROVIDER` ≠ `log` · `PAYMENT_WEBHOOK_SECRET` preenchido

---

## Pendências conhecidas

- **Etapa I** — botão "Conectar Mercado Pago" no painel do gerente. Hoje a
  conexão só acontece por `curl`; nenhuma arena consegue se conectar sozinha.
- **Etapas K–M** — cartão com tokenização (`MercadoPago.js v2`) e LGPD. Hoje o
  provider recusa qualquer método que não seja Pix.
- **Etapas N–P** `[DECIDIR]` — parcelamento, 3-D Secure, política de chargeback.

Detalhes de cada uma em `IMPLEMENTAR_MERCADO PAGO.md`, seções 8 e 9.
