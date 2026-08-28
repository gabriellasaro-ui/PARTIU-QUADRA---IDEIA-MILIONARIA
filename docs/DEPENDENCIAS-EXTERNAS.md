# Dependências Externas — tudo que você precisa pegar "por fora"

Este arquivo reúne **tudo o que precisa ser obtido/criado fora do código** para o
Qadras funcionar de verdade: contas, chaves, certificados, arquivos de
configuração e domínios. Para cada item há o passo a passo do console, o lugar
exato onde o código espera a informação (variável de ambiente ou caminho de
arquivo) e o que acontece hoje se você não configurar.

> **Regra de segurança:** nenhuma credencial entra no repositório. No EasyPanel
> as variáveis são preenchidas no painel de cada app; `google-services.json`,
> `GoogleService-Info.plist` e o service account do Firebase ficam fora do git
> (o `android/.gitignore` já ignora `google-services.json`).

---

## Visão geral

| # | Item externo | Para quê | Onde entra no código | Status |
|---|---|---|---|---|
| A | Firebase / FCM | Push notifications (notificações quando o app está fechado) | `FCM_CREDENTIALS_PATH`, `FCM_PROJECT_ID`, `android/app/google-services.json`, iOS `GoogleService-Info.plist`, VAPID web | Mock funciona; real pendente |
| B | Google Cloud (OAuth) | Login "Entrar com Google" | `GOOGLE_CLIENT_ID` + `www-usuario/services/google-auth.js` | Mock; valida idToken real quando configurado |
| C | Provedor de Pix real | Receber pagamentos das reservas | `services/payments/` (registry) + webhook `POST /api/payments/webhook/{provider}` | Mock (Pix fake) |
| D | Tiles de mapa (CARTO) | Mapas de busca (Leaflet) | `mobile.js`, `player-desktop.js`, `findmap.js` | Funciona grátis sem chave |
| E | Infra (VPS/EasyPanel + DNS + SSL) | Hospedar API, worker, banco, cache | Variáveis do painel EasyPanel | Postgres/Redis já existem |
| F | Google Play + Apple | Publicar o app nos celulares | `android/` e `ios/` (projetos já criados, `br.com.qadras.app`) | Pendente |
| G | Upload de arquivos (bucket) | Fotos de quadras/partidas/perfil (Fases 8–9) | ainda não implementado | Pendente |

---

## A. Firebase / FCM — push notifications

**Status atual:** o backend funciona em modo `mock` (grava em `push_logs` sem
enviar nada). Com `PUSH_PROVIDER=fcm` **sem** credencial, o provider responde
503 (mesmo comportamento do login Google sem `GOOGLE_CLIENT_ID`).

### A.1 Criar o projeto no Firebase

1. Acesse <https://console.firebase.google.com> → **Add project** (ex.: `qadras-app`).
2. Em **Configurações do projeto → Contas de serviço**, clique em **Gerar nova
   chave privada**. Isso baixa o **service account JSON** (único segredo do
   backend; nunca commitar).

### A.2 Configurar o backend (env vars no EasyPanel)

| Variável | Valor |
|---|---|
| `PUSH_PROVIDER` | `fcm` (era `mock`) |
| `FCM_CREDENTIALS_PATH` | caminho do JSON no servidor (monte num volume/secret do EasyPanel, ex.: `/var/secrets/firebase.json`) |
| `FCM_PROJECT_ID` | id do projeto (ex.: `qadras-app`) |

Código: `backend/app/services/push/fcm.py` (import lazy de `firebase-admin`;
inicializa app nomeado `qadras-fcm`). Sem `FCM_CREDENTIALS_PATH` o provider
não instancia → 503.

### A.3 Registro dos dispositivos

O app envia o token de push em `POST /api/devices` com `{ fcmToken, platform }`
(tabela `user_devices`). O Celery (`enviar_notificacao_push`) busca os devices
do usuário, envia via FCM e grava uma linha em `push_logs` por tentativa.

### A.4 Android — `google-services.json`

1. No Firebase: **Configurações do projeto → Seus apps → Adicionar app → Android**.
2. Pacote: `br.com.qadras.app` (confere com `android/app/build.gradle`).
3. Baixe o `google-services.json` e coloque em **`android/app/google-services.json`**.
4. O `build.gradle` já detecta o arquivo e aplica o plugin do Google Services
   automaticamente — sem ele o push Android simplesmente não registra.

### A.5 iOS — `GoogleService-Info.plist` + APNs

1. Firebase → **Adicionar app → iOS** (bundle ID `br.com.qadras.app`).
2. Baixe `GoogleService-Info.plist` e adicione no projeto Xcode.
3. Precisa do **APNs Auth Key** (Apple Developer → Certificates → Keys) e
   upload dele no Firebase (Configurações → Cloud Messaging) para o FCM enviar
   via APNs.

### A.6 Web — chave VAPID

O `@capacitor/push-notifications` no web usa uma chave VAPID (Configurações do
projeto → Cloud Messaging → Web configuration). Necessário quando o app rodar
no navegador (Fase 11).

---

## B. Google Cloud — login "Entrar com Google"

**Status atual:** o backend **já valida idToken real** (`backend/app/api/auth.py`
usa `google.oauth2.id_token`); basta preencher `GOOGLE_CLIENT_ID`. Sem ele, o
endpoint responde 503. No cliente, `www-usuario/services/google-auth.js` tem
`GOOGLE_READY = false` e devolve perfis de teste — é a única camada "descartável".

### B.1 Projeto no Google Cloud

1. <https://console.cloud.google.com> → criar projeto (ou usar o mesmo do
   Firebase) → **APIs & Services → OAuth consent screen** (External).
2. **Credentials → Create OAuth client ID** — você precisará de 3 clientes:

| Tipo | Uso | Detalhe |
|---|---|---|
| **Web** | app web | cola em `GOOGLE_CLIENT_ID` no backend |
| **Android** | app mobile | exige a **SHA-1 do keystore de release** (ver F.1) |
| **iOS** | app mobile | bundle ID `br.com.qadras.app` |

3. Autorizar os domínios do app (ex.: `qadras.com.br`) e e-mails de teste no
   consent screen enquanto o app não for aprovado pela Google.

#### ⚠️ O painel do gerente é uma ORIGEM a mais

O login com Google agora existe também em `www-gerente/login.html`, com o
**mesmo client ID** do app do jogador — a credencial é a mesma, o que muda é a
origem. O Google só devolve token para origens que estão na lista, e o painel
roda em outra porta/domínio.

Em **Authorized JavaScript origins** do client Web precisa haver uma linha para
cada porta em uso, não só a do jogador:

```
http://localhost:5176        app do jogador (dev)
http://localhost:5175        painel do gerente (dev)
http://192.168.x.x:5175      painel na LAN, se for testar de outro aparelho
https://gerente.qadras.com.br    produção
```

Falta a origem? O sintoma engana: **o botão aparece normalmente** (ele é
desenhado só no cliente) e o erro só chega no clique, como `origin_mismatch` no
console. Quem estiver testando lê "não aconteceu nada".

### B.2 Backend (env var)

| Variável | Valor |
|---|---|
| `GOOGLE_CLIENT_ID` | Client ID Web do OAuth 2.0 |

### B.3 Cliente

- Web: **feito** nas duas pontas. `services/google-auth.js` existe em
  `www-usuario/` e em `www-gerente/` (mesmo arquivo), e `GOOGLE_READY` deriva de
  `GOOGLE_CLIENT_ID` — vazio desliga tudo e nem baixa o script do Google.
- **Painel do gerente: só ENTRA, não cadastra.** O pedido leva
  `contexto: "gerente"`, e com ele o backend deixa de criar conta para e-mail
  desconhecido: responde 404 ("cadastre sua arena") ou 403 se a conta for de
  jogador. Sem isso, um dono clicando no painel ganharia em silêncio uma conta
  de **jogador** presa ao e-mail dele — e o e-mail já estaria tomado quando
  fosse cadastrar a arena de verdade.
- App mobile: instalar **`@codetrix-studio/capacitor-google-auth`** (Fase 11).

---

## C. Provedor de pagamento (Mercado Pago)

**Status:** implementado em `backend/app/services/payments/mercadopago.py`.
Falta apenas a credencial — o codigo esta pronto e testado na parte que da para
testar sem conta (assinatura do webhook, leitura de status, idempotencia).

O `MockProvider` continua no repositorio para desenvolver sem credencial. Ele
nao chega a producao: `Settings` recusa o boot com `PAYMENT_PROVIDER=mock` fora
de desenvolvimento.

### C.1 O que voce precisa fazer

1. **Criar a aplicacao** em mercadopago.com.br/developers > Suas integracoes.
2. **Pegar o access token**: aplicacao > Credenciais.
   - `TEST-...` = teste (cobranca simulada)
   - `APP_USR-...` = producao (dinheiro de verdade)
3. **Pegar a assinatura secreta**: aplicacao > Webhooks > Configurar
   notificacao. Ela e **gerada pelo painel** — nao invente um valor.
4. **Preencher o `.env`**:
   ```
   PAYMENT_PROVIDER=mercadopago
   MERCADOPAGO_ACCESS_TOKEN=TEST-...
   PAYMENT_WEBHOOK_SECRET=<a assinatura secreta copiada do painel>
   ```
5. **Cadastrar a URL do webhook** no mesmo lugar:
   `https://SEU-DOMINIO/api/payments/webhook/mercadopago`, evento **Pagamentos**.

   Precisa ser publica e HTTPS. Em desenvolvimento, exponha com ngrok ou
   cloudflared — `localhost` o Mercado Pago nao alcanca.

### C.2 Particularidades que ja estao tratadas no codigo

- **Nao existe URL de sandbox.** A API e a mesma; quem separa teste de producao
  e o token. Por isso a guarda de producao recusa o boot com um token `TEST-`:
  senao as cobrancas seriam simuladas, o dinheiro nunca entraria e **nada
  falharia visivelmente** — o pior jeito de descobrir.

- **O webhook nao diz o que aconteceu.** A notificacao traz so
  `{"type": "payment", "data": {"id": ...}}` — avisa que algo mudou naquele
  pagamento, nao o que mudou. O status vem de `GET /v1/payments/{id}`.
  Confiar num status escrito no corpo seria confiar em quem POSTou.

- **Assinatura `x-signature: ts=...,v1=...`**, HMAC-SHA256 sobre o manifesto
  `id:{data.id};request-id:{x-request-id};ts:{ts};`. O `data.id` vai em
  **minusculas**: o Mercado Pago as vezes entrega o id em maiusculas e assina a
  versao minuscula. Sem normalizar, a assinatura falha **so em producao**, onde
  os ids tem letras — bug classico dessa integracao.

- **Idempotencia por pagamento + situacao.** O Mercado Pago reenvia a mesma
  notificacao ate receber 2xx, e manda novas a cada mudanca. Chavear so pelo id
  do pagamento descartaria a aprovacao como repeticao do "pendente", e a
  reserva ficaria presa em "Aguardando pagamento".

- **`X-Idempotency-Key` na criacao**, derivada do codigo da reserva: se a rede
  cair depois do POST e o jogador tentar de novo, volta a MESMA cobranca em vez
  de nascer uma segunda para o mesmo horario.

### C.3 Cartao ainda nao funciona

O Mercado Pago exige que o cartao seja tokenizado **no navegador**
(MercadoPago.js) — o numero nunca pode chegar ao nosso servidor. Enquanto o
front nao gerar esse token, `create_payment` recusa `card` com mensagem clara,
e a tela ja mostra cartao como "Em breve". Pix funciona.

### C.4 O que NAO foi testado

A criacao de cobranca contra a API real, porque exige conta e credencial. Ao
ligar o token de teste pela primeira vez, faca uma reserva de ponta a ponta e
confira: cobranca no painel, QR na tela, webhook chegando e reserva saindo de
"Aguardando pagamento".

---

## D. Mapas (tiles CARTO)

**Status atual:** os mapas usam o serviço gratuito da CARTO, **sem chave**:
`https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png`
(em `www-usuario/assets/js/mobile.js`, `player-desktop.js` e `findmap.js`).

Funciona sem nenhum cadastro. Para produção com volume alto recomenda-se:

1. Criar conta em **CARTO** (ou usar **Mapbox** como alternativa) e gerar um
   **token de acesso** para os tiles.
2. Trocar a URL do `tileLayer` pelo domínio/token do provedor escolhido.

---

## E. Infraestrutura — EasyPanel / VPS / DNS / SSL

**Status atual:** PostgreSQL e Redis externos já existem e estão funcionando.
Falta publicar os domínios e subir a API (Fase 12 / deploy).

### E.1 VPS + EasyPanel

- Uma VPS (ex.: Hetzner, Contabo, DigitalOcean) com EasyPanel instalado.
- Apps no EasyPanel: `api` (uvicorn), `worker` (celery worker), `beat` (celery
  beat) a partir do Dockerfile do repositório; `postgres` e `redis` como
  templates (já existem em ambiente externo).

### E.2 Domínios e DNS

Criar os 4 registros **A** apontando para o IP do VPS:

| Domínio | Uso |
|---|---|
| `api.qadras.com.br` | backend REST + WS |
| `app.qadras.com.br` | app do jogador (web) |
| `gerente.qadras.com.br` | painel do gerente |
| `admin.qadras.com.br` | painel admin |

- **SSL:** o Traefik do EasyPanel emite Let's Encrypt automaticamente.
- **CORS:** preencher `CORS_ORIGINS` com os 3 subdomínios **e com as origens
  dos APKs** (ver `backend/.env.example`).

#### ⚠️ O APK não manda o domínio do site como origem

Os dois aplicativos agora falam com `https://api.qadras.com.br` — o endereço
fica compilado dentro do APK, e era isso que quebrava a cada troca de rede.

Só que dentro do aparelho a página é servida pelo Capacitor, não pelo site.
A origem que chega na API é:

| Plataforma | Origem enviada |
|---|---|
| Android (`androidScheme: "http"`) | `http://localhost` |
| iOS | `capacitor://localhost` |

Se as duas não estiverem em `CORS_ORIGINS`, o WebView bloqueia **todos** os
requests e o sintoma é exatamente o mesmo de um IP errado — "o app não
conecta" — por um motivo completamente diferente. Confira com:

```bash
curl -si -X OPTIONS https://api.qadras.com.br/api/quadras   -H "Origin: http://localhost" -H "Access-Control-Request-Method: GET"   | grep -i access-control-allow-origin
```

Sem linha de resposta = bloqueado.

### E.3 Variáveis por app (mesmo conjunto nos 3 apps)

```
DATABASE_URL=postgresql+psycopg://USUARIO:SENHA@<host>:5432/qadras_db
REDIS_URL=redis://default:SENHA@<host>:6379
JWT_SECRET=<openssl rand -hex 32>
GOOGLE_CLIENT_ID=<Client ID Web>
PUSH_PROVIDER=fcm
FCM_CREDENTIALS_PATH=/var/secrets/firebase.json
FCM_PROJECT_ID=<project id>
CORS_ORIGINS=https://app.qadras.com.br,https://gerente.qadras.com.br,https://admin.qadras.com.br
```

---

## F. Publicação mobile (Play + Apple)

Os projetos nativos **já existem** no repositório (`android/`, `ios/`, appId
`br.com.qadras.app`). Para o app sair do desenvolvimento:

### F.1 Google Play

1. Conta no **Google Play Console** (taxa única ~US$ 25).
2. Gerar o **keystore de release** (comandos `keytool`) e guardá-lo bem — a
   **SHA-1 dele é obrigatória** para configurar o client ID Android do Google
   login (seção B).
3. Configurar `android/app/build.gradle` com o keystore e subir o bundle.

### F.2 Apple

1. Conta de **Apple Developer** (US$ 99/ano).
2. **APNs Auth Key** (seção A.5) — necessária para o push iOS.
3. **App Store Connect** + arquivos de assinatura/entitlements de push
   (`aps-environment`).

---

## G. Pendências futuras (Fases 8–9)

- **Bucket de upload** (S3-compatível: Backblaze B2, AWS S3, etc.) para fotos de
  quadras, partidas e perfil. Ainda **não implementado** — surgirá no backend
  com as Fases 8–9.
- **QR do Pix fake:** o mock usa `https://qadras.app/pix/mock.png` como imagem
  do QR — placeholder; o provedor real (seção C) substitui.
- **FCM no app (Fase 11):** instalar `@capacitor/push-notifications` no
  `www-usuario`, registrar token em `POST /api/devices` e escutar `notification.new`.

---

## Checklist de execução (ordem sugerida)

- [ ] Firebase: projeto criado + service account JSON baixado (A.1–A.2)
- [ ] EasyPanel: `FCM_CREDENTIALS_PATH` apontando para o JSON + `PUSH_PROVIDER=fcm` (A.2)
- [ ] Android: `google-services.json` em `android/app/` (A.4)
- [ ] iOS: `GoogleService-Info.plist` + APNs Auth Key (A.5)
- [ ] Web: chave VAPID (A.6)
- [ ] Google Cloud: consent screen + Client ID Web → `GOOGLE_CLIENT_ID` (B.1–B.2)
- [ ] Google Cloud: Client IDs Android (com SHA-1 do keystore) e iOS (B.1)
- [ ] Cliente: plugar GIS/capacitor-google-auth e `GOOGLE_READY=true` (B.3)
- [ ] Domínios + DNS + CORS + SSL (E.2)
- [ ] Escolher provedor de Pix e configurar webhook (C)
- [ ] (Opcional) token de tiles para produção (D)
- [ ] Keystore + Play Console e Apple Developer (F)
- [ ] Bucket de upload quando a Fase 8 exigir (G)
