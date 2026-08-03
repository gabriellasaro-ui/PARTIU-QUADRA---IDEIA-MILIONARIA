# Qadras — documentação funcional e técnica do aplicativo

Versão: 1.0
Data do levantamento: 03/08/2026
Escopo: `www`, `www-usuario`, `www-gerente`, `www-admin` e `backend/`
Backend-alvo: FastAPI + banco relacional + autenticação por token

Esta é a especificação de referência para a próxima etapa do produto. Ela descreve o comportamento que já existe no frontend, os eventos disparados por cada tela, os dados necessários e as lacunas que precisam ser fechadas no backend. Onde o código atual usa mock, `localStorage` ou estado JSON, isso está identificado; não deve ser tratado como regra de produção sem a implementação correspondente na API.

## 1. Visão geral do produto

O Qadras conecta três perfis:

| Perfil | Superfície | Objetivo principal |
|---|---|---|
| Jogador | PWA/app Capacitor (`www-usuario`) e web (`www`) | Encontrar quadras, solicitar e pagar reservas, conversar com arenas, organizar clubes e partidas |
| Gerente/dono da arena | `www-gerente` e dashboard desktop de `www` | Administrar quadras, agenda, reservas, mensalistas, financeiro, avaliações e comunicação |
| Administrador da plataforma | `www-admin` | Acompanhar toda a operação, arenas, reservas, clubes e pessoas |

O `www` é a SPA mais completa e contém as experiências do jogador e do gerente. O `www-usuario` é a cópia destinada ao `webDir` do Capacitor (`capacitor.config.json`); o `www-gerente` isola a área de gestão; o `www-admin` é um painel independente. A documentação usa `www` como referência comportamental quando há duplicação.

### 1.1 Estado atual

- A API FastAPI já está montada em `backend/app/main.py` e expõe alguns domínios: autenticação, quadras, reservas, mensagens, gerente, carteira, perfil e favoritos.
- A persistência atual do backend é `backend/state.json`, manipulada por `backend/app/core/store.py`; ainda não há models, repositories ou migrations implementados.
- O frontend alterna entre API e dados locais. Quando `API_BASE_URL` está vazio, `services/venues.js` usa `config/mock-data.js` e `storage/storage.js`.
- O painel `www-admin` ainda calcula tudo em memória a partir de mocks e `localStorage`; não existe router administrativo equivalente no FastAPI.
- Clubes, peladas e partidas aparecem no frontend e são chamados pelo cliente, mas seus endpoints não estão presentes nos routers atuais do backend.
- O modo de confirmação usa espera simulada de cinco segundos e janela visual de quinze minutos. A decisão de reserva precisa ser feita pelo servidor.

Legenda usada nesta documentação:

- **Atual/API**: existe chamada e router correspondente no código atual.
- **Atual/local**: existe na interface, mas a fonte é mock/localStorage ou JSON local.
- **A implementar**: o frontend já espera o comportamento, mas o contrato FastAPI ainda não existe ou é insuficiente.
- **Regra crítica**: precisa de validação transacional no servidor; nunca confiar apenas no estado visual do cliente.

## 2. Arquitetura de navegação

### 2.1 Entrada e shells

| Entrada | Uso | Arquivo |
|---|---|---|
| `/` ou `index.html` | App mobile/PWA do jogador | `www/index.html` |
| `/pc.html` | Jogador em tela grande | `www/pc.html` |
| `/dashboard.html` | Gestão da arena | `www/dashboard.html` |
| `/www-admin/index.html` | Administração da plataforma | `www-admin/index.html` |
| Android/iOS | App Capacitor | `www-usuario` como `webDir` |

O roteamento do jogador mobile usa hash para funcionar dentro do WebView. O desktop do jogador e o gerente também usam hash. A troca de hash dispara renderização, atualização do título, navegação ativa e carregamento do fragmento HTML.

### 2.2 Rotas do jogador mobile

| Hash | Tela | Parâmetros |
|---|---|---|
| `#home` | Início | — |
| `#quadras` | Explorar quadras | `q`, `local`, `esporte`, `raio`, `agora` |
| `#mapa` | Mapa | filtros de busca |
| `#quadra/:id` | Detalhes da quadra | `id` |
| `#pagamento/:id` | Revisão e pagamento | `hora`, `dur`, `data`, `plan`, `method` |
| `#confirmado/:id` | Solicitação/aguardando aprovação | dados da reserva |
| `#reservas` | Próximas e histórico | filtro `proxima` ou `historico` |
| `#favoritos` | Quadras salvas | — |
| `#carteira` | Saldo, cartões, extrato | — |
| `#carteira/adicionar` | Adicionar saldo via Pix | — |
| `#carteira/cartao` | Adicionar cartão | — |
| `#carteira/cupom` | Aplicar cupom | — |
| `#mensagens` | Lista de conversas | — |
| `#mensagens/:id` | Conversa | `id` |
| `#perfil` | Perfil do jogador | — |
| `#config` | Configurações | — |
| `#clubes` | Buscar/entrar em clube | `codigo` ou `q` |
| `#clube` | Clube atual, peladas, membros e chat | `clubId` implícito |
| `#onboarding` | Posição e nível | — |
| `#game` | Game Day/partida ativa | `matchId` implícito |
| `#entrar` | Login | — |
| `#cadastro` | Cadastro | — |

Aliases aceitos: `#buscar` e `#explorar` apontam para `#quadras`; `#chat` para `#mensagens`; `#configuracoes` para `#config`; `#login` para `#entrar`; `#registrar` para `#cadastro`.

### 2.3 Rotas do jogador desktop

`pc.html` compartilha serviços e regras com o mobile, mas possui renderizadores próprios em `assets/js/player-desktop.js`:

`#quadras`, `#quadra/:id`, `#pagamento/:id`, `#confirmado/:id`, `#reservas`, `#favoritos`, `#carteira`, `#carteira/adicionar`, `#carteira/cartao`, `#carteira/cupom`, `#perfil`, `#config`, `#mensagens/:id` e `#game`.

O desktop acrescenta o fluxo explícito de reserva em três etapas: **data → duração → horário**. O mobile apresenta o mesmo domínio com organização vertical e seleção de plano.

### 2.4 Rotas do gerente

`dashboard.html` usa `www/pages/dashboard.html` como visão inicial e as páginas `www/pages/desktop/`:

| Hash | Tela |
|---|---|
| vazio ou `#dashboard` | Visão geral |
| `#reservas` | Reservas e solicitações |
| `#mensagens` | Conversas com jogadores |
| `#reserva-nova` | Nova reserva manual |
| `#reserva/:id` | Detalhe de reserva |
| `#quadras` ou `#minhas-quadras` | Minhas quadras |
| `#quadra` | Cadastro/edição de quadra |
| `#mensalistas` | Mensalistas |
| `#agenda` | Agenda semanal |
| `#financeiro` | Financeiro e repasses |
| `#avaliacoes` | Avaliações |
| `#config` ou `#configuracoes` | Configurações da arena |

### 2.5 Rotas do administrador

`www-admin/index.html` é uma página única com hash:

| Hash | Visão |
|---|---|
| vazio ou `#visao` | Visão geral da plataforma |
| `#arenas` | Arenas cadastradas |
| `#reservas` | Volume de reservas |
| `#clubes` | Clubes e peladas |
| `#pessoas` | Jogadores e donos |

## 3. Sessão, autenticação e autorização

### 3.1 Fluxo do jogador

1. O usuário entra por `#entrar`, `login.html` ou `login-pc.html`.
2. Login envia e-mail e senha para `POST /api/auth/login`.
3. Cadastro envia nome, e-mail e senha para `POST /api/auth/register`.
4. Login Google envia o `idToken` para `POST /api/auth/google`.
5. O cliente guarda `token` e `user` em `pq:auth_token` e `pq:auth_user`.
6. `services/api.js` envia `Authorization: Bearer <token>` quando há token.
7. Rotas protegidas passam por `middleware/auth.js`; quando não há sessão, o destino vira `#entrar?next=...`.
8. Usuário novo vai para onboarding; usuário já configurado vai para a tela de origem ou início.
9. Logout chama `POST /api/auth/logout` quando há API e sempre limpa a sessão local.

### 3.2 Regras obrigatórias da futura API

- Senha deve ser armazenada somente com hash forte; nunca em texto puro.
- O token mockado deve ser substituído por access token com expiração e refresh/revogação.
- Toda leitura e escrita deve identificar o usuário pelo token, não por `role`, `de`, `cliente` ou `id` enviado pelo navegador.
- `role` deve ser uma autorização do servidor: `jogador`, `gerente` e `admin`.
- Gerente só acessa arenas às quais está vinculado; admin acessa a plataforma inteira.
- A API deve devolver `401` para sessão inválida, `403` para falta de permissão, `404` para recurso inexistente e `409` para conflito de disponibilidade/duplicidade.
- O chat só deve ficar disponível quando existir relacionamento permitido: reserva confirmada/paga ou conversa criada por uma regra de negócio explícita.

## 4. Telas do jogador mobile/PWA

### 4.1 Início — `#home`

Arquivo principal: `www/pages/home.html`; renderização: `renderHome()` e `renderHomeGameCard()`.

**Objetivo:** orientar o jogador para localização, esporte, quadras próximas, destaques e partida ativa.

**Dados:** saudação e usuário; localização atual; esportes; quadras em destaque; quadras próximas; notificações; partida ativa.

**Eventos e comportamentos:**

- Abrir seletor de localização; escolher cidade/região; salvar `current_location` e atualizar as listas.
- Usar localização atual; solicitar permissão do navegador; salvar coordenadas em `current_coordinates`; remover coordenadas quando o usuário limpar.
- Abrir notificações; marcar notificações como lidas e remover o ponto de badge.
- Pesquisar por texto; enviar para `#quadras?q=...`.
- Escolher esporte; navegar para `#quadras?esporte=...`.
- Abrir “Ver todos” ou “Explorar”; navegar para exploração.
- Abrir card de quadra; navegar para `#quadra/:id`.
- Abrir card “Partiu agora”; carregar partida ativa ou ir para Game Day.
- Abrir menu inferior: Início, Explorar, Mapa, Reservas e Perfil.
- Abrir instalação PWA; aceitar/recusar o prompt `beforeinstallprompt`.

**Estados:** carregando; localização não concedida; localização escolhida manualmente; sem quadras; API indisponível; usuário visitante; partida ativa; notificações lidas/não lidas.

**Contratos FastAPI:** `GET /api/quadras/destaques`, `GET /api/quadras`, `GET /api/partidas/ativa`, `GET /api/mensagens/nav/badges`, `GET /api/auth/user`.

### 4.2 Explorar quadras — `#quadras`

Arquivo: `www/pages/explorar.html`; renderização: `renderExplore()`.

**Dados:** termo, local, esporte, raio, modo “agora”, lista de quadras, distância, nota, preço, tags e status de disponibilidade.

**Eventos:**

- Digitar ou submeter a busca por arena, esporte ou bairro.
- Abrir filtro; escolher esporte, distância e “disponível agora”; aplicar ou limpar filtros.
- Alterar localização pelo market sheet.
- Abrir mapa.
- Abrir card, favoritar/desfavoritar e recalcular a lista.
- Repetir busca com lista vazia; exibir estado “nenhum resultado”.
- Clicar em horário/CTA de uma quadra; navegar para seus detalhes.

**Regra:** filtros devem ser parâmetros de consulta e não somente filtros visuais. A API deve devolver a busca aplicada, paginação e ordenação.

**Contrato:** `GET /api/quadras?local=&esporte=&raio=&q=&agora=`. O endpoint atual aceita apenas `local`, `esporte` e `raio`; `q` e `agora` precisam ser formalizados.

### 4.3 Mapa — `#mapa`

Arquivo: `www/pages/mapa.html`; integração: Leaflet em `findmap.js`/`mobile.js`.

**Eventos:** abrir mapa; centralizar na posição atual; conceder/recusar geolocalização; aplicar filtros; clicar em marcador; abrir popup; navegar para detalhes; alternar lista/mapa quando disponível.

**Dados:** latitude/longitude da busca e das quadras, zoom, distância calculada, filtros ativos e seleção do marcador.

**Estados:** permissão negada; GPS indisponível; sem resultados; carregamento do mapa; erro de tiles; marcador selecionado.

**Contrato:** `GET /api/quadras` deve devolver `lat`, `lng`, `distancia` e identificação estável. O servidor deve limitar o raio e evitar expor dados de arenas inativas.

### 4.4 Detalhe da quadra — `#quadra/:id`

Arquivo: `www/pages/quadra.html`; renderização: `renderVenue()` e `renderBooking()`.

**Conteúdo:** galeria, foto hero, nome, esporte, bairro, distância, avaliação, quantidade de avaliações, estrutura/comodidades, avaliações, dias, calendário, duração e horários.

**Eventos:**

- Voltar para exploração.
- Trocar foto da galeria, avançar/recuar e abrir foto atual.
- Favoritar/desfavoritar.
- Escolher plano avulso ou mensalista.
- Escolher dia da semana e data no calendário.
- Navegar mês anterior/próximo.
- Escolher duração de 1, 2 ou 3 horas.
- Escolher horário disponível; bloquear horário passado, ocupado ou incompatível com a duração.
- Atualizar resumo de preço, início/fim e CTA.
- Prosseguir para `#pagamento/:id`.
- Exibir avaliações e estado sem avaliações.

**Regra crítica:** o navegador pode sugerir disponibilidade, mas o horário deve ser revalidado no servidor no momento da criação da reserva. O preço também deve vir de uma cotação assinada/expirável.

**Contratos:** `GET /api/quadras/:id`, `GET /api/quadras/:id/horarios` (chamado pelo frontend, ausente no router atual), `GET /api/quadras/:id/resumo?hora=&dur=`. O resumo atual retorna `subtotal`, `service_fee` e `total`; esse contrato precisa ser alinhado à regra financeira final da plataforma.

### 4.5 Pagamento/revisão — `#pagamento/:id`

Arquivo: `www/pages/pagamento.html`; renderização: `renderPayment()`.

**Conteúdo:** arena, data, horário, duração, valor da quadra, taxa/total, jogador, Pix, cartão e carteira.

**Eventos:** selecionar Pix; selecionar cartão; selecionar carteira; bloquear carteira sem saldo; voltar; confirmar solicitação; abrir cadastro/login se necessário; tratar cotação expirada; exibir sucesso/erro do provedor.

**Dados enviados:** `venue_id`, data ISO, hora inicial, duração, plano, método de pagamento, cupom e idempotency key.

**Fluxo de produção recomendado:** criar cotação → reservar temporariamente o slot → iniciar pagamento → receber webhook do provedor → confirmar pagamento → submeter para aprovação da arena. Nunca marcar como pago apenas porque o botão foi clicado.

**Contrato-alvo:** `POST /api/reservas/quote`, `POST /api/reservas`, `POST /api/pagamentos`, `GET /api/pagamentos/:id`, webhook interno do provedor. O backend atual não possui `POST /api/reservas` nem pagamento do jogador.

### 4.6 Confirmação/aguardando aprovação — `#confirmado/:id`

Arquivo: `www/pages/confirmado.html`; renderização: `renderConfirmation()`.

**Estados visuais atuais:** solicitação em análise, progresso/contagem regressiva, confirmação aprovada, recusa, cancelamento e criação das peladas vinculadas à reserva.

**Eventos:** copiar código da reserva; abrir compartilhamento; voltar para reservas; acompanhar alteração de status; abrir chat quando liberado; abrir Game Day/pelada; repetir/reservar outro horário.

**Regra crítica:** a contagem de quinze minutos é apenas UX. O status oficial vem do servidor. A tela deve fazer polling ou receber evento em tempo real e ser idempotente ao recarregar.

**Contrato-alvo:** `GET /api/reservas/:id`, `GET /api/reservas/:id/events` ou WebSocket, `POST /api/reservas/:id/cancelar`.

### 4.7 Minhas reservas — `#reservas`

Arquivo: `www/pages/reservas.html`; renderização: `renderReservations()`.

**Eventos:** alternar Próximas/Histórico; abrir reserva; pagar pendência; cancelar conforme política; abrir conversa; reagendar; avaliar após conclusão; abrir mensalidades; entrar no Game Day.

**Estados:** nenhuma próxima; nenhum histórico; aguardando pagamento; solicitada; confirmada; paga; recusada; cancelada; concluída; erro de carregamento.

**Contrato:** `GET /api/reservas`. O backend atual devolve uma lista derivada de seed, sem usuário autenticado, e não oferece criação, cancelamento, reagendamento ou avaliação.

### 4.8 Favoritos — `#favoritos`

Arquivo: `www/pages/favoritos.html`; renderização: `renderFavorites()`.

**Eventos:** carregar lista; abrir quadra; remover favorito; atualizar vazio; favoritar a partir de qualquer card.

**Contrato atual:** `GET /api/favoritos`; gravação ainda é local no frontend. Contrato-alvo: `POST /api/favoritos/:venue_id` e `DELETE /api/favoritos/:venue_id`.

### 4.9 Carteira — `#carteira` e ações

Arquivos: `www/pages/carteira.html`, `carteira-acao.html`; renderização: `renderWallet()` e `renderWalletAction()`.

**Conteúdo:** saldo, Pix, cartão principal, extrato, cupons e indicação.

**Eventos:** adicionar saldo; escolher valor; gerar Pix; copiar código/link de indicação; adicionar/editar cartão; aplicar cupom; copiar cupom; navegar pelo extrato; pagar reserva com carteira.

**Contratos atuais:** `GET /api/carteira`, `GET /api/carteira/adicionar`, `POST /api/carteira/adicionar`, `GET /api/carteira/cupons`, `POST /api/carteira/cupom/aplicar?codigo=`. Os endpoints atuais não identificam usuário, não retornam transação/Pix real e não validam cupom.

**Regras:** saldo é dinheiro e deve ter ledger imutável; cada crédito/débito precisa de idempotência, origem, status e auditoria; cartão não deve ser armazenado no backend sem tokenização do provedor.

### 4.10 Mensagens — `#mensagens` e `#mensagens/:id`

Arquivo: `www/pages/mensagens.html`; renderização: `renderMessages()`.

**Eventos:** abrir lista; selecionar conversa; carregar thread; digitar; enviar; impedir mensagem vazia; atualizar badge; tratar conversa indisponível; voltar; fazer polling/receber nova mensagem.

**Contrato atual:** `GET /api/mensagens?role=jogador`, `GET /api/mensagens/:id`, `POST /api/mensagens/:id/enviar?texto=&de=` e `GET /api/mensagens/nav/badges`. A API atual aceita `de` vindo do cliente; isso precisa ser removido e inferido pela sessão.

**Regra atual de produto:** a interface informa que mensagens ficam disponíveis após uma reserva confirmada. Essa autorização deve ser implementada no serviço de domínio e verificada em cada leitura/envio.

### 4.11 Perfil — `#perfil`

Arquivo: `www/pages/perfil.html`; renderização: `renderProfile()`.

**Dados:** nome, foto, cidade, e-mail, posição, nível, nascimento, pé dominante, esporte favorito, estatísticas, próxima reserva e conquistas.

**Eventos:** abrir edição; escolher foto; validar formulário; salvar; cancelar; abrir mensagens, carteira, favoritos ou configurações.

**Contrato atual:** `GET /api/perfil`; cliente também chama `PATCH /api/perfil`, ausente no backend atual, enquanto o router possui `POST /api/perfil/salvar`. É necessário escolher um único contrato REST e mantê-lo em todas as superfícies.

### 4.12 Configurações — `#config`

Arquivo: `www/pages/config.html`.

**Eventos:** ligar/desligar notificações; trocar esporte padrão; trocar distância padrão; alterar privacidade; salvar; sair da conta.

**Estado:** hoje o formulário é predominantemente demonstrativo (`data-demo-form`). Produção exige persistência por usuário e sincronização entre dispositivos.

**Contrato-alvo:** `GET /api/me/preferences`, `PATCH /api/me/preferences`, `POST /api/auth/logout`.

### 4.13 Clubes — `#clubes` e `#clube`

Arquivos: `www/pages/clubes.html` e `clube.html`; renderização: `renderClubSearch()` e `renderClub()`.

**Ações de clube:** criar; buscar por nome/código; entrar; sair; apagar se dono; editar nome/esporte/cidade/descrição; copiar código; compartilhar convite; abrir peladas; abrir membros; abrir chat.

**Ações de pelada:** criar a partir de reserva; escolher plano avulso/mensalista; confirmar presença (`sim`, `talvez`, `nao`); remover membro; criar nova sessão; reservar quadra.

**Ações de chat:** carregar mensagens; enviar; validar até 500 caracteres; atualizar lista.

**Contratos chamados pelo frontend e ainda ausentes no backend:** `GET/POST /api/clubes`, `GET /api/clubes?codigo=`, `POST /api/clubes/:id/entrar`, `POST /api/clubes/:id/sair`, `DELETE /api/clubes/:id`, `DELETE /api/clubes/:id/membros/:member_id`, `GET/POST /api/clubes/:id/mensagens`, `GET/POST /api/peladas`, `POST /api/peladas/:id/presenca`.

### 4.14 Onboarding — `#onboarding`

Arquivo: `www/pages/onboarding.html`; renderização: `renderOnboarding()`.

**Etapas:** escolher posição → escolher nível → confirmação “Tudo pronto”.

**Eventos:** selecionar opção; habilitar/desabilitar continuar; voltar; pular; avançar; finalizar; salvar no servidor; retornar à rota original.

**Contrato atual:** `PATCH /api/auth/onboarding` recebe `position` e `level`. O usuário deve ser obtido da sessão e não ser fixado em `u-gabriel`.

### 4.15 Game Day — `#game`

Arquivos: `www/pages/game.html`, `assets/js/game-mode.js`, `assets/js/mobile.js`.

**Abas:** partida, cronômetro e times.

**Eventos da partida:** confirmar presença; informar atraso; abrir mapa; compartilhar localização; encerrar partida; adicionar foto; compartilhar resultado; compartilhar no WhatsApp.

**Eventos do cronômetro:** iniciar; pausar; resetar; escolher duração de 5/7/10/15/20 minutos; finalizar rodada; avançar rodada.

**Eventos dos times:** escolher de 2 a 6 times; sortear times; ajustar placar A/B; somar/remover gol; selecionar aba; abrir modo TV; fechar modo TV.

**Persistência atual:** estado do jogo em `match_state` no storage local. Contratos chamados: `GET /api/partidas/ativa`, `GET /api/partidas/historico`, `PUT /api/partidas/:id/score`, `POST /goal`, `/card`, `/teams`, `/end`, `/rate`, `/confirmar`, `/atraso`, `/compartilhar-localizacao`, `/media` — todos precisam de router, permissão e regras de concorrência.

## 5. Telas do jogador desktop

O desktop usa o mesmo domínio funcional, mas o arquivo `assets/js/player-desktop.js` renderiza as páginas abaixo com layout próprio.

| Tela | Eventos específicos |
|---|---|
| Explorar | Alternar lista/mapa; buscar; abrir menu de esporte; aplicar chips; usar mapa; abrir card; favoritar |
| Detalhe da quadra | Galeria; calendário mensal; etapa data/duração/horário; selecionar slot; avançar; voltar; reservar |
| Checkout | Selecionar Pix/cartão/carteira; verificar saldo; revisar dados; enviar solicitação |
| Aguardando aprovação | Contagem regressiva visual; copiar código; abrir chat; acompanhar status |
| Reservas | Abas próximas/histórico/canceladas; buscar; reagendar; pagar; conversar; avaliar |
| Favoritos | Abrir e remover quadra |
| Carteira | Saldo; extrato; cartão; Pix; cupom; exportação quando disponível |
| Perfil | Editar dados; trocar foto; escolher esportes; salvar/cancelar |
| Configurações | Preferências, notificações e conta |
| Mensagens | Lista, thread, envio e atualização de badge |
| Game Day | Mesmo estado da experiência mobile |

Os eventos devem gerar os mesmos comandos de domínio do mobile. A diferença de tela não pode criar uma segunda regra de reserva, preço ou permissão.

## 6. Telas do gerente/dono da arena

### 6.1 Dashboard — `#dashboard`

**Dados:** KPIs de faturamento, ticket, reservas, ocupação; gráfico; heatmap; faixas de horário; insights; solicitações; próximas reservas.

**Eventos:** abrir reserva; abrir solicitação; navegar para agenda, quadras, financeiro, avaliações ou mensagens; atualizar dados; visualizar badges.

**Contrato atual:** `GET /api/gerente/dashboard`. Parte dos valores ainda é calculada por `domain.gerente_dados()` sobre seed.

### 6.2 Reservas — `#reservas`

**Dados:** busca, volume, total, pendentes, filtros Todas/Solicitações/Pagas/Pendentes/Confirmadas, mensalistas.

**Eventos:** buscar por cliente/código/quadra; filtrar; aprovar; recusar; abrir detalhe; criar reserva manual; gerenciar mensalistas.

**Contratos:** `GET /api/gerente/reservas`, `GET /api/reservas/todas`, `POST /api/reservas/:id/aprovar`, `/recusar`, `/pagar`, `/cancelar`, `/status`. A autorização por arena e transição válida ainda precisa ser implementada.

### 6.3 Nova reserva manual — `#reserva-nova`

**Campos:** cliente, telefone, e-mail, quadra, data, início, duração, valor e status.

**Eventos:** preencher; selecionar quadra/horário; calcular valor; validar; criar; cancelar.

**Contrato-alvo:** `POST /api/gerente/reservas`, com auditoria de quem criou e distinção `manual`/`app`. O backend atual não possui criação.

### 6.4 Detalhe da reserva — `#reserva/:id`

**Dados:** cliente, telefone, quadra, data, horário, valor bruto, comissão, repasse, status, histórico e conversa.

**Eventos:** aprovar, recusar, marcar como pago, confirmar, cancelar, abrir chat, voltar.

**Regra:** cada ação deve validar estado atual, política de cancelamento, disponibilidade e efeito financeiro; retorno deve ser uma operação idempotente.

### 6.5 Agenda — `#agenda`

**Dados:** semana, dias, horas, quadras, eventos posicionados por início/duração, status, cliente, telefone, valor e código.

**Eventos:** semana anterior/próxima; abrir evento; fechar detalhe; falar com cliente; alternar visual desktop/mobile; selecionar quadra quando houver mais de uma.

**Contrato atual:** `GET /api/gerente/agenda?semana=`. O servidor deve receber datas ISO/timezone e não apenas offset numérico.

### 6.6 Minhas quadras — `#quadras`

**Dados:** quadras, status ativa/inativa, ocupação, preço, mensalista, vitrine da arena.

**Eventos:** abrir/editar quadra; alternar ativa/inativa; marcar visível; marcar destaque; atualizar preview; abrir cadastro.

**Contratos atuais/parciais:** `GET /api/gerente/quadras`; o frontend espera `PUT /api/quadras/:id`, ausente no router atual. As configurações de vitrine estão locais.

### 6.7 Cadastro/edição de quadra — `#quadra`

**Campos:** foto, nome/apelido, esporte, bairro, descrição, preço avulso, preço mensalista, duração mínima, horário de abertura/fechamento, comodidades e status.

**Eventos:** abrir formulário novo/edição; upload/preview de foto; preencher; alternar comodidade; salvar; cancelar; atualizar lista.

**Contrato-alvo:** `POST /api/gerente/quadras`, `GET/PATCH /api/gerente/quadras/:id`, upload de mídia, validação de horário e conflito de alteração de preço.

### 6.8 Mensalistas — `#mensalistas`

**Dados:** cliente, quadra, dia fixo, horário, mensalidade, quantidade de sessões, slots, receita e origem.

**Eventos:** pesquisar; criar; editar; salvar; cancelar; remover; associar quadra/dia/horário; gerar sessões do plano.

**Regra:** mensalista não é apenas uma reserva repetida. Deve ter plano, vigência, cobrança, sessões geradas, cancelamento e política de falha de pagamento.

**Contrato-alvo:** `GET/POST/PATCH/DELETE /api/gerente/mensalistas` e `GET /api/gerente/mensalistas/:id/sessoes`.

### 6.9 Financeiro — `#financeiro`

**Dados:** hoje/7 dias/30 dias; faturamento bruto; comissão; reservas; ocupação; gráfico; composição da receita; ledger de reservas; repasses; exportação CSV.

**Eventos:** trocar período; visualizar gráfico; exportar receitas; exportar repasses; abrir reserva; acompanhar status de repasse.

**Contrato atual:** `GET /api/gerente/financeiro`; valores ainda são derivados de seed. O CSV é gerado no cliente e não substitui relatório auditável.

**Regra crítica:** o financeiro deve usar ledger e eventos de pagamento, não recalcular com base em status visual. O repasse deve possuir ciclo, vencimento, pagamento, falha e comprovante.

### 6.10 Avaliações — `#avaliacoes`

**Dados:** média, distribuição por estrela, total, texto, autor, data e resposta do gerente.

**Eventos:** carregar; abrir caixa de resposta; escrever; enviar resposta; cancelar; atualizar média/lista.

**Contrato atual:** `GET /api/gerente/avaliacoes`; respostas são locais em `manager-review-replies`. Contrato-alvo: `GET /api/avaliacoes?arena_id=`, `POST /api/avaliacoes/:id/resposta`.

### 6.11 Configurações da arena — `#config`

**Campos:** perfil/logo; esporte; quantidade de quadras; descrição; endereço; telefone; e-mail; Pix; notificações; cupons; conta.

**Eventos:** trocar logo; editar dados; salvar; criar cupom; cancelar cupom; remover cupom; sair; solicitar desativação.

**Regra:** desativar arena deve ser uma operação administrativa com confirmação, motivo, período de bloqueio e impacto em reservas futuras; não pode ser apenas toast.

**Contratos-alvo:** `GET/PATCH /api/gerente/perfil`, `GET/PATCH /api/gerente/configuracoes`, `GET/POST/DELETE /api/gerente/cupons`, `POST /api/gerente/desativacao`.

## 7. Painel administrativo da plataforma

Arquivo: `www-admin/index.html`; lógica: `www-admin/assets/js/admin.js`.

### 7.1 Visão geral — `#visao`

Exibe receita da plataforma, volume transacionado, jogos marcados, planos mensalistas, cadastrados, ativos, inativos há mais de sete dias, arenas ativas, fila de reativação e últimas reservas.

Eventos: trocar aba; atualizar por mudança de hash; abrir links de navegação. Hoje a lista é somente leitura e local.

### 7.2 Arenas — `#arenas`

Lista arena, esporte, preço avulso, mensalista, número de reservas e status ativa/pausada. Deve evoluir para filtros, detalhes, aprovação, bloqueio e auditoria administrativa.

### 7.3 Reservas — `#reservas`

Exibe planos mensalistas, reservas avulsas e sessões agendadas. Deve permitir busca, filtros, detalhe e auditoria, sem permitir que o admin altere uma reserva sem uma permissão específica.

### 7.4 Clubes — `#clubes`

Exibe clubes, esporte, cidade, membros e peladas. Depende dos domínios de clubes/peladas ainda ausentes no FastAPI.

### 7.5 Pessoas — `#pessoas`

Exibe nome, papel, cidade, cadastro, última atividade e status ativo/inativo. O critério atual de inatividade é mais de sete dias. Em produção, isso deve vir de `last_active_at` persistido e respeitar privacidade.

### 7.6 Contrato administrativo recomendado

Criar router protegido por `role=admin`: `GET /api/admin/overview`, `/arenas`, `/reservas`, `/clubes`, `/pessoas`, além de endpoints explícitos para ações administrativas, logs, exportações e paginação.

## 8. Componentes compartilhados e eventos transversais

| Componente | Eventos/estado |
|---|---|
| Topbar/header | abrir menu; voltar; abrir notificações; abrir modal de horário; atualizar título/subtítulo |
| Tabbar/sidebar | navegar; marcar item ativo; mostrar badge; fechar menu mobile |
| Market sheet/modal | abrir; fechar por X, backdrop ou Escape; confirmar; restaurar foco |
| Toast | sucesso, erro, aviso, cópia, ação concluída; expiração automática |
| Loader | início/fim de carregamento; retry; estado de erro |
| Empty state | nenhum resultado; CTA alternativo; filtro limpo |
| Card de quadra | abrir; favoritar; selecionar horário; mostrar preço/status |
| Card de reserva | abrir; status; pagar; cancelar; reagendar; chat |
| Upload | escolher arquivo; preview; remover; validar tipo/tamanho; enviar |
| Seletor de esporte | abrir; escolher; limpar; aplicar |
| Exportação CSV | selecionar tabela; gerar; baixar; informar erro |
| PWA/service worker | instalar; atualizar; offline; voltar online; carregar fallback |

Eventos de teclado obrigatórios: `Escape` fecha modal/sheet/TV mode; `Enter` submete buscas/formulários; tabulação deve preservar ordem acessível; botões de ícone precisam de `aria-label`.

## 9. Estados e máquinas de domínio

### 9.1 Reserva

Estados recomendados para persistência:

`draft` → `pending_payment` → `payment_confirmed` → `requested` → `confirmed` → `completed`

Saídas alternativas: `payment_failed`, `rejected`, `cancelled`, `expired`, `refunded`.

Mapeamento aproximado da interface atual: `Solicitada` = `requested`; `Pendente`/`Aguardando pagamento` dependem do contexto e devem ser separados; `Confirmado` = `confirmed`; `Pago` = pagamento confirmado, não necessariamente arena confirmada; `Recusada` = `rejected`; `Cancelada` = `cancelled`.

Transições devem ser permitidas pelo papel:

| Transição | Autor |
|---|---|
| criar solicitação | jogador ou gerente |
| pagar | jogador/provedor via webhook |
| aprovar/recusar | gerente da arena |
| cancelar | jogador ou gerente conforme política |
| reembolsar | serviço financeiro/admin |
| concluir | sistema após horário ou gerente |

### 9.2 Preço e comissão

Há uma divergência que precisa ser resolvida antes do backend definitivo:

- `backend/app/api/quadras.py` atualmente calcula `service_fee = 5%` e soma ao total do jogador.
- O histórico do projeto registra a regra comercial desejada de jogador pagar apenas o valor cheio da quadra, com 5% retidos no repasse do dono.
- `www-admin` calcula a parte da plataforma como fração interna do valor recebido.

A decisão recomendada para o contrato final, se a regra comercial continuar sendo a registrada no projeto, é:

`player_total = court_price - discount + wallet_debit`
`platform_commission = gross_settlement × 0.05`
`owner_payout = gross_settlement - platform_commission`

Até essa decisão ser confirmada, não alterar silenciosamente templates, JS ou FastAPI. O documento trata o conflito como requisito aberto para evitar que telas diferentes mostrem totais diferentes.

### 9.3 Chat

Uma conversa possui arena, jogador, reserva/clube relacionado, mensagens, remetente, horário, leitura e status. Mensagem enviada deve ser persistida, autorizada, ordenada pelo servidor e entregue por polling/WebSocket; o `de` nunca deve ser confiado ao cliente.

### 9.4 Favoritos, perfil e preferências

São dados do usuário autenticado. Devem ser sincronizados no servidor, com `updated_at`, controle de concorrência e resposta normalizada para mobile e desktop.

### 9.5 Clube, pelada e partida

Separar as entidades:

`Club` → `ClubMember` → `Pelada`/sessão → `Match` → presença, times, placar, cartões, mídia, avaliação e resultado.

Uma reserva pode originar uma pelada, mas não deve duplicar a reserva quando a tela for recarregada. Use chave idempotente e relação explícita.

## 10. Inventário da API FastAPI atual

| Router | Endpoint atual | Observação |
|---|---|---|
| auth | `POST /api/auth/login`, `/register`, `/google`, `/logout`, `PATCH /onboarding`, `GET /user`, `GET /gerente/user` | Respostas mockadas; token fixo; falta persistência e JWT |
| quadras | `GET /api/quadras`, `/esportes`, `/destaques`, `/:id`, `/:id/resumo` | Listagem/detalhe seed; horários específico não existe; resumo inclui taxa |
| reservas | `GET /api/reservas`, `/todas`, `/:id`; `POST /:id/status`, `/aprovar`, `/recusar`, `/pagar`, `/cancelar` | Falta criação do jogador, usuário/arena e máquina de estados |
| mensagens | `GET /api/mensagens`, `/:id`, `/nav/badges`; `POST /:id/enviar` | JSON local; autorização e remetente ainda frágeis |
| gerente | `GET /api/gerente/dashboard`, `/agenda`, `/reservas`, `/quadras`, `/financeiro`, `/avaliacoes`, `/config` | Vários dados calculados de seed; quase todas as escritas faltam |
| carteira | `GET /api/carteira`, `/adicionar`, `/cupons`; `POST /adicionar`, `/cupom/aplicar` | Mock; sem ledger, provedor ou usuário |
| perfil | `GET /api/perfil`, `POST /api/perfil/salvar` | Cliente novo espera `PATCH /api/perfil` |
| favoritos | `GET /api/favoritos` | Escritas ainda locais |
| health | `GET /api/health` | Retorna status simples |

## 11. Endpoints esperados pelo frontend e ainda ausentes

Antes de considerar o backend estruturado, implementar ou remover conscientemente as chamadas abaixo:

- Quadras: `GET /api/quadras/:id/horarios`, `PUT/PATCH /api/quadras/:id`, filtros `q/agora`, criação e upload.
- Reservas: `POST /api/reservas`, cotação, pagamento, cancelamento do jogador, reagendamento, avaliação e eventos de status.
- Perfil: `PATCH /api/perfil` ou padronização para o `POST` existente.
- Favoritos: `POST` e `DELETE` por quadra.
- Clubes: CRUD, membros, convite, mensagens e presença.
- Peladas: listagem, criação e presença.
- Partidas: partida ativa/histórico, placar, gols, cartões, times, fim, avaliação, atraso, localização e mídia.
- Jogador: preferências, notificações, cartões tokenizados e indicação.
- Gerente: CRUD de quadras, reservas manuais, mensalistas, perfil, configurações, cupons, respostas de avaliação e desativação.
- Admin: visão geral, arenas, reservas, clubes, pessoas, auditoria e ações administrativas.

## 12. Arquitetura FastAPI recomendada

```text
backend/app/
  api/              # routers HTTP por domínio e websocket de mensagens/status
  auth/             # hash, JWT, dependências current_user/current_manager/current_admin
  models/           # SQLAlchemy/SQLModel: usuários, arenas, quadras, reservas, pagamentos...
  schemas/          # DTOs de entrada/saída versionados
  services/         # casos de uso transacionais
  repositories/     # acesso ao banco
  core/             # config, logging, timezone, erros, idempotência
  workers/          # webhook, notificações, expiração e repasse
  migrations/       # Alembic
```

Casos de uso prioritários:

1. autenticar e carregar sessão;
2. buscar quadras e disponibilidade real;
3. cotar e criar reserva com lock de slot;
4. processar pagamento/webhook;
5. aprovar/recusar/cancelar com auditoria;
6. notificar e liberar chat;
7. conciliar financeiro e repasse;
8. estruturar clubes/peladas/partidas;
9. proteger gerente e admin por escopo.

Padrões obrigatórios: paginação, filtros tipados, timezone `America/Sao_Paulo`, valores monetários em centavos/Decimal, idempotency key em comandos financeiros e de reserva, soft delete quando necessário, logs estruturados, auditoria de ações de gerente/admin e testes de transição de estado.

## 13. Eventos de domínio e telemetria

Além dos eventos de interface, registrar eventos de negócio para métricas e suporte:

`auth.login_succeeded`, `auth.login_failed`, `auth.registered`, `auth.onboarding_completed`, `venue.viewed`, `venue.favorited`, `search.performed`, `availability.viewed`, `booking.quote_created`, `booking.created`, `booking.payment_started`, `booking.payment_confirmed`, `booking.requested`, `booking.approved`, `booking.rejected`, `booking.cancelled`, `booking.completed`, `message.thread_opened`, `message.sent`, `club.created`, `club.joined`, `pelada.created`, `match.started`, `match.goal_recorded`, `match.ended`, `wallet.credit_created`, `wallet.debit_created`, `coupon.applied`, `manager.court_updated`, `manager.booking_approved`, `manager.payout_viewed`, `admin.view_loaded`.

Cada evento deve conter `event_id`, `occurred_at`, `actor_id`, `actor_role`, `tenant/arena_id` quando aplicável, `entity_type`, `entity_id`, `correlation_id` e dados mínimos sem informação sensível.

## 14. Checklist de aceite da próxima fase

- [ ] Todas as telas do mobile e desktop carregam dados pela mesma API, sem divergência de regra.
- [ ] Todas as chamadas listadas como ausentes possuem contrato Pydantic, status HTTP e teste.
- [ ] Reserva não permite dupla ocupação mesmo com dois usuários clicando simultaneamente.
- [ ] Total, desconto, pagamento, comissão e repasse são iguais em jogador, gerente e admin.
- [ ] Webhook de pagamento é idempotente e atualiza o ledger.
- [ ] Chat respeita vínculo e permissão em leitura e envio.
- [ ] Dados de perfil, favoritos, clubes e preferências persistem por usuário.
- [ ] Gerente só enxerga sua arena; admin possui escopo separado.
- [ ] Status não é alterado por `localStorage` nem por `status` livre enviado pelo cliente.
- [ ] Notificações, badges, polling/WebSocket e offline têm estados de erro/reconexão.
- [ ] Imagens, cartões e documentos usam upload/tokenização segura.
- [ ] Todas as ações importantes possuem auditoria e telemetria.
- [ ] Testes cobrindo autenticação, autorização, disponibilidade, pagamento, cancelamento, aprovação, repasse, chat e Game Day.

## 15. Arquivos de referência do levantamento

- Entradas e roteamento: `www/index.html`, `www/pc.html`, `www/dashboard.html`, `www/assets/js/app.js`, `www/config/routes.js`.
- Experiência do jogador: `www/pages/`, `www/pages/player-desktop/`, `www/assets/js/mobile.js`, `www/assets/js/player-desktop.js`.
- Experiência do gerente: `www/pages/desktop/`, `www/assets/js/manager-*.js`.
- Admin: `www-admin/index.html`, `www-admin/assets/js/admin.js`.
- Serviços: `www/services/api.js`, `www/services/auth.js`, `www/services/venues.js`, `www/storage/storage.js`.
- Backend: `backend/app/main.py`, `backend/app/api/`, `backend/app/core/data.py`, `backend/app/core/domain.py`, `backend/app/core/store.py`, `backend/state.json`.
- Empacotamento: `capacitor.config.json`, `www-usuario/README.md`, `MOBILE.md`.
