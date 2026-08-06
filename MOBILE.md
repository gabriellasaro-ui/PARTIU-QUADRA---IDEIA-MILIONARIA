# Qadras — Web + App de celular (PWA → Play Store)

A meta é **um código só** servindo três frentes: site, app instalável (PWA) e app na
Play Store. O que já está pronto e o passo a passo de cada etapa estão aqui.

## 1. O que JÁ está funcionando (PWA)

A versão mobile (`/`) já é uma **Progressive Web App**:

- `static/manifest.webmanifest` — nome, ícones, cor, `display: standalone` (abre sem
  barra de navegador, igual app nativo).
- `static/sw.js` — service worker (servido em `/sw.js` para ter escopo `/`). Faz cache
  do app e mostra `/offline` quando cai a internet.
- `static/js/pwa.js` — registra o service worker e exibe o banner **"Instalar app"**
  (evento `beforeinstallprompt` do Android/Chrome).
- Ícones em `static/icons/` (192, 512, 512 maskable, apple-touch 180, favicon).

### Como testar a instalação
1. `python app.py`
2. PWA só instala em **HTTPS** (ou `localhost`, que é liberado para teste).
   - Local: abra `http://localhost:5000` no Chrome do PC → menu ⋮ → "Instalar".
   - No **celular Android**, use um túnel HTTPS para o seu PC, por exemplo:
     `npx localtunnel --port 5000` ou `ngrok http 5000`, e abra a URL `https://...`.
3. No Android aparece o banner "Instalar"; no iOS (Safari) use
   Compartilhar → "Adicionar à Tela de Início".

## 2. Publicar na Play Store (TWA)

A Play Store empacota a PWA como **TWA (Trusted Web Activity)** — um app Android fino
que abre a sua PWA em tela cheia. Ferramenta oficial: **Bubblewrap** (ou PWABuilder.com,
versão sem terminal).

Pré-requisitos: o site no ar em **HTTPS** com um domínio (ex.: `app.qadras.com.br`)
e conta de desenvolvedor Google Play (US$ 25, uma vez).

```bash
npm i -g @bubblewrap/cli
bubblewrap init --manifest https://SEU-DOMINIO/manifest.webmanifest
bubblewrap build          # gera o app-release-bundle.aab para subir na Play Console
```

O Bubblewrap gera uma chave de assinatura e mostra o **SHA-256**. Pegue esse fingerprint
e publique o **Digital Asset Links** para o Android confiar no seu site (sem isso a barra
de URL do Chrome aparece dentro do app):

`static/.well-known/assetlinks.json`
```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "br.com.qadras.app",
    "sha256_cert_fingerprints": ["<SHA256_DO_BUBBLEWRAP>"]
  }
}]
```
Sirva em `https://SEU-DOMINIO/.well-known/assetlinks.json`.

Alternativa sem terminal: subir o `manifest` em **https://www.pwabuilder.com**, que gera
o pacote Android (`.aab`) e os assetlinks prontos.

## 3. iOS / App Store

iOS instala a PWA por "Adicionar à Tela de Início" (já funciona). A App Store **não**
aceita TWA; se quiser presença na App Store depois, o caminho é envelopar com
**Capacitor** (`@capacitor/ios`) — mesma base web, casca nativa. Dá pra adicionar quando
for a hora, sem reescrever o front.

## 4. Quando o backend real entrar (banco + multi-tenant)

Para o app não depender do servidor a cada toque, a evolução natural é separar
**front (PWA) + API**: as telas chamam endpoints JSON (`/api/quadras`, `/api/reservas`…)
com `tenant_id` por arena. A PWA e o TWA continuam os mesmos; só a origem dos dados muda.

## Regerar os ícones
```bash
pip install Pillow
python tools/gen_icons.py
```

## 5. Capacitor instalado

O projeto tambem ja esta preparado com Capacitor usando `frontend/` como `webDir`.

Pacotes instalados:

- `@capacitor/core`
- `@capacitor/cli`
- `@capacitor/android`
- `@capacitor/ios`

Arquivos/pastas principais:

- `capacitor.config.json`
- `package.json`
- `package-lock.json`
- `android/`
- `ios/`

Comandos uteis:

```bash
npm run cap:sync
npm run cap:open:android
npm run cap:open:ios
```

No Windows, o Android foi validado pelo Capacitor Doctor. Para buildar/abrir iOS de verdade,
precisa de macOS com Xcode instalado.
