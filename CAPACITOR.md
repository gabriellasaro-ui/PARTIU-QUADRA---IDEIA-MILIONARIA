# Capacitor — por que `androidScheme: "http"`

O Capacitor 8 carrega o app em `https://localhost` por padrão
(`CapConfig.java`: `androidScheme = CAPACITOR_HTTPS_SCHEME`).

Com a API de desenvolvimento em `http://192.168.x.x:8000`, toda chamada vira
**conteúdo misto** (origem https → destino http) e o WebView do Android
bloqueia antes de sair do aparelho. O sintoma é `Failed to fetch` no login e
no cadastro, sem nenhuma requisição chegando ao backend.

`androidScheme: "http"` põe o app em `http://localhost`, mesma origem-esquema
da API, e o bloqueio some. `cleartext: true` acompanha, junto com o
`usesCleartextTraffic` que já existe no AndroidManifest.

## Ao ir para produção

Com a API em `https://api.qadras.com.br` não há conteúdo misto, e o esquema
volta a ser `https` — que é o recomendado. Basta remover o bloco `server`
deste arquivo e rodar `npx cap sync`.

## Efeito colateral de trocar o esquema

`localStorage` é escopado por origem. Sair de `https://localhost` para
`http://localhost` descarta a sessão guardada: quem já estava logado precisa
entrar de novo, uma vez. Não é perda de dado — a conta e o histórico vivem no
banco.
