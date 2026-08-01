# Frontend web + mobile

Esta pasta prepara o frontend para web e aplicativo mobile com Capacitor, sem alterar o backend Flask/Jinja atual.

- `assets/` guarda CSS, JS, imagens, icones e fontes usados pelo app.
- `components/` guarda fragments reutilizaveis de UI, sem regra de negocio.
- `pages/` guarda o conteudo das telas que futuramente consumirao a API.
- `services/` centraliza comunicacao HTTP e autenticacao.
- `utils/`, `storage/`, `middleware/` e `config/` deixam as dependencias explicitas.

Para a fase Capacitor, o `webDir` pode apontar para `frontend`. Os HTMLs usam caminhos relativos e a comunicacao futura deve passar por `services/api.js`.

## Camada visual

- `assets/css/style.css` preserva a base compartilhada.
- `assets/css/mobile-v2.css` contem a experiencia mobile clara, arredondada e responsiva sem interferir no desktop.
- `assets/css/desktop.css` aplica a identidade monocromatica verde ao jogador no PC usando o escopo `data-player-desktop`.
- `assets/vendor/lucide/` mantem os icones do aplicativo locais para Android e iOS.
- A home prioriza localizacao, busca, `Partiu agora`, esportes e quadras proximas.
- Localizacao, notificacoes e filtros usam paineis isolados em `components/modal/`.
- A navegacao mobile fixa usa Inicio, Explorar, Mapa, Reservas e Perfil, sempre fora da area util do mapa.
- O site para PC usa o mesmo servico de dados e a mesma linguagem visual, com layout proprio para telas grandes.
- A camada mobile foi espelhada em `static/css/` para o Flask manter a mesma experiencia no celular sem alterar backend.
- `pc.html` usa o shell desktop original com sidebar, topbar e rotas desacopladas.
- Em navegadores com largura a partir de 900px, `index.html` encaminha para `pc.html`; dentro do Capacitor, permanece no app mobile.

## FastAPI

- Defina `window.__PQ_CONFIG__.API_BASE_URL` antes de `assets/js/app.js` quando a API existir.
- Use `config/app.config.example.js` como referencia.
- Todas as chamadas HTTP novas devem passar por `services/api.js`.
- Autenticacao e sessao devem passar por `services/auth.js`, `middleware/auth.js` e `storage/storage.js`.
- Fragments com `<!-- TODO: substituir renderizacao Jinja por dados da API -->` indicam pontos que devem trocar dados server-side por JSON da API.

## Rotas mobile

O app usa hash routing para funcionar dentro do WebView do Capacitor sem depender
de configuracao de servidor:

- `#home`, `#quadras` e `#mapa`
- `#quadra/:id`
- `#pagamento/:id?hora=19:00&dur=2`
- `#confirmado/:id?hora=19:00&dur=2`
- `#reservas` e `#favoritos`
- `#mensagens` e `#mensagens/:id`
- `#carteira`, `#carteira/adicionar`, `#carteira/cartao` e `#carteira/cupom`
- `#perfil` e `#config`

Enquanto a FastAPI nao estiver conectada, `services/venues.js` fornece a mesma
interface usando `config/mock-data.js` e `storage/storage.js`. As paginas nao
acessam os dados mockados diretamente.

## Rotas desktop

O site para PC usa as mesmas rotas e servicos do aplicativo:

- `pc.html#quadras` e `pc.html#quadra/:id`
- `pc.html#pagamento/:id` e `pc.html#confirmado/:id`
- `pc.html#reservas`, `#favoritos`, `#mensagens` e `#mensagens/:id`
- `pc.html#carteira`, `#carteira/adicionar`, `#carteira/cartao` e `#carteira/cupom`
- `pc.html#perfil` e `pc.html#config`
