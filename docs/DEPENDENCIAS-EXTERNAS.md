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

### B.2 Backend (env var)

| Variável | Valor |
|---|---|
| `GOOGLE_CLIENT_ID` | Client ID Web do OAuth 2.0 |

### B.3 Cliente

- Web: implementar **Google Identity Services** (`accounts.id.initialize`) em
  `services/google-auth.js` e setar `GOOGLE_READY = true`.
- App mobile: instalar **`@codetrix-studio/capacitor-google-auth`** (Fase 11).

---

## C. Provedor de pagamento (Asaas)

**Status:** implementado em `backend/app/services/payments/asaas.py`. Falta
apenas a chave — o codigo esta pronto e testado na parte que da para testar
sem conta (leitura de webhook, mapeamento de evento, validacao de token).

O `MockProvider` continua no repositorio para desenvolver sem chave. Ele nao
chega a producao: `Settings` recusa o boot com `PAYMENT_PROVIDER=mock` fora de
desenvolvimento.

### C.1 Por que Asaas

O repasse deste projeto (`models/settlement.py`) e periodico: a Qadras recebe o
valor cheio e acerta com a arena depois, com comissao e comprovante. Isso
dispensa split no adquirente — basta **uma conta recebedora**, o que simplifica
muito a integracao.

### C.2 O que voce precisa fazer

1. **Criar a conta** em asaas.com e aprovar o cadastro (pede CNPJ ou CPF,
   documentos e conta bancaria para saque).
2. **Pegar a chave de API**: painel > Integracoes > Chave de API.
   Sandbox comeca com `$aact_hmlg_`; producao, com `$aact_prod_`.
3. **Preencher no `.env`**:
   ```
   PAYMENT_PROVIDER=asaas
   ASAAS_API_KEY=$aact_hmlg_sua_chave
   ASAAS_AMBIENTE=sandbox
   PAYMENT_WEBHOOK_SECRET=<openssl rand -hex 32>
   ```
4. **Cadastrar o webhook** no painel > Integracoes > Webhooks:
   - URL: `https://SEU-DOMINIO/api/payments/webhook/asaas`
   - Token de autenticacao: **o mesmo** `PAYMENT_WEBHOOK_SECRET`
   - Eventos: os de cobranca (`PAYMENT_*`)

   A URL precisa ser publica e HTTPS. Em desenvolvimento, exponha com ngrok
   ou cloudflared — `localhost` o Asaas nao alcanca.

### C.3 Cuidados que ja estao tratados no codigo

- **A fila do Asaas para depois de 15 respostas nao-2xx seguidas**, e os eventos
  so ficam guardados por 14 dias. Por isso evento irrelevante (`PAYMENT_CREATED`,
  eventos de split) devolve `None` e a rota responde **200 com `ignored: true`**,
  em vez de erro. Recusar com 4xx um evento qualquer derrubaria a entrega dos
  pagamentos seguintes.
- **`PAYMENT_CONFIRMED` e `PAYMENT_RECEIVED` contam os dois como pago.** No Pix
  chegam juntos; no cartao, CONFIRMED (capturado) vem antes de RECEIVED
  (liquidado). Tratar so um deixaria metade dos pagamentos pendurados.
- **Idempotencia pelo `id` do evento**, e nao pelo id da cobranca: o Asaas
  reenvia o mesmo evento quando nao recebe 2xx, e uma mesma cobranca gera mais
  de um evento legitimo.
- **O QR do Pix vem em chamada separada** (`GET /v3/payments/{id}/pixQrCode`).
  Se ela falhar, a cobranca ja existe — o codigo segue sem o QR em vez de
  deixar uma cobranca orfa no Asaas e a reserva sem pagamento.

### C.4 O que NAO foi testado

A criacao de cobranca contra a API real, porque exige conta e chave. Ao ligar o
sandbox pela primeira vez, faca uma reserva de ponta a ponta e confira: cobranca
criada no painel, QR exibido, webhook chegando e reserva saindo de "Aguardando
pagamento".

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
- **CORS:** preencher `CORS_ORIGINS` com os 3 subdomínios
  (ver `backend/.env.example`).

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
