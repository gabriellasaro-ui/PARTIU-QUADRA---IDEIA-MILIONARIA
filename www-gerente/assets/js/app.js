import { loadComponents, refreshIcons } from './component-loader.js';
import { requireAuth } from '../../middleware/auth.js';
import { qsa } from '../../utils/helpers.js';
import { ROUTES } from '../../config/routes.js';
import { renderManagerCourts, initManagerCourts } from './manager-courts.js';
import { renderManagerReservations, initManagerReservations } from './manager-reservations.js';
import { renderManagerMembers, initManagerMembers } from './manager-members.js';
import { renderManagerOverview, initGraficoDashboard } from './manager-overview.js';
import { renderManagerAgenda, initManagerAgenda } from './manager-agenda.js';
import { renderManagerReviews, initManagerReviews } from './manager-reviews.js';
import { renderManagerMessages, initManagerMessages } from './manager-messages.js';
import { renderManagerBookingDetail, initManagerBookingDetail } from './manager-booking-detail.js';
import {
  renderManagerBookingForm, renderManagerCourtForm, renderManagerSettings, initManagerForms
, prefillReservaNova, initGaleriaQuadra } from './manager-forms.js';
import { renderManagerFinance, initManagerFinance } from './manager-finance.js';
import { aplicarTema, definirTema, claroLigado } from '../../services/tema.js';
import { connectWS, disconnectWS } from '../../services/ws.js';
import storage from '../../storage/storage.js';
import managerService from '../../services/manager-api.js';
import { API_BASE_URL } from '../../config/constants.js';

/* Antes de qualquer rota: sem isto o painel abre claro e SALTA para
   escuro quando o tema for aplicado — um flash branco a cada abertura. */
aplicarTema();

/* TEMPO REAL no painel.

   O painel nao tinha WebSocket nenhum — o dono so descobria uma solicitacao
   nova recarregando a pagina, e a reserva expira sozinha em 15 minutos. Ele
   esta no balcao, com o cliente na frente; F5 nao e um plano.

   Conecta so com sessao: sem token o /ws responde 401 e o backoff ficaria
   tentando para sempre numa tela de login. */
if (storage.getAuthToken()) connectWS();

window.addEventListener('pq:auth-expired', disconnectWS);

const DESKTOP_ROUTES = {
  dashboard: {
    aliases: ['', 'dashboard'],
    page: './pages/dashboard.html',
    title: 'Dashboard - Qadras',
    heading: 'Dashboard',
    sub: 'Arena Bola na Rede'
  },
  reservas: {
    aliases: ['reservas'],
    page: './pages/desktop/reservas.html',
    title: 'Reservas - Qadras',
    heading: 'Reservas',
    sub: 'Fila, status e próximos horários'
  },
  mensagens: {
    aliases: ['mensagens', 'chat'],
    page: './pages/desktop/mensagens.html',
    title: 'Mensagens - Qadras',
    heading: 'Mensagens',
    sub: 'Conversas com jogadores'
  },
  agenda: {
    aliases: ['agenda'],
    page: './pages/desktop/agenda.html',
    title: 'Agenda - Qadras',
    heading: 'Agenda',
    sub: 'Semana de reservas por horário'
  },
  financeiro: {
    aliases: ['financeiro'],
    page: './pages/desktop/financeiro.html',
    title: 'Financeiro - Qadras',
    heading: 'Financeiro',
    sub: 'Receitas e pagamentos'
  },
  quadras: {
    aliases: ['quadras', 'minhas-quadras'],
    page: './pages/desktop/quadras.html',
    title: 'Minhas quadras - Qadras',
    heading: 'Minhas quadras',
    sub: 'Estrutura, preços e disponibilidade'
  },
  reservaNova: {
    aliases: ['reserva-nova'],
    page: './pages/desktop/reserva-nova.html',
    title: 'Nova reserva - Qadras',
    heading: 'Nova reserva',
    sub: 'Agende manualmente para um cliente'
  },
  reservaDetalhe: {
    aliases: ['reserva'],
    page: './pages/desktop/reserva-detalhe.html',
    title: 'Detalhes da reserva - Qadras',
    heading: 'Detalhes da reserva',
    sub: 'Aprove, confirme o pagamento ou cancele'
  },
  quadraForm: {
    aliases: ['quadra'],
    page: './pages/desktop/quadra-form.html',
    title: 'Cadastrar quadra - Qadras',
    heading: 'Cadastrar quadra',
    sub: 'Dados, preço, comodidades e status do espaço'
  },
  mensalistas: {
    aliases: ['mensalistas'],
    page: './pages/desktop/mensalistas.html',
    title: 'Mensalistas - Qadras',
    heading: 'Mensalistas',
    sub: 'Quem tem dia e horário fixos na sua grade'
  },
  avaliacoes: {
    aliases: ['avaliacoes'],
    page: './pages/desktop/avaliacoes.html',
    title: 'Avaliações - Qadras',
    heading: 'Avaliações',
    sub: 'Notas e respostas aos jogadores'
  },
  config: {
    aliases: ['config', 'configuracoes'],
    page: './pages/desktop/config.html',
    title: 'Configurações - Qadras',
    heading: 'Configurações',
    sub: 'Perfil da arena e operacao'
  }
};

function applyRouteGuards() {
  const page = document.documentElement;
  if (page.dataset.authRequired === 'true') requireAuth();
  if (page.dataset.guestOnly === 'true') globalThis.location.assign(ROUTES.dashboard);
}

/* Sessao vencida apos refresh falho: o api.js despacha pq:auth-expired.
   Cai para o login sem o usuario ver um catch de 401 pelado. */
function initAuthLifecycle() {
  window.addEventListener('pq:auth-expired', () => {
    globalThis.location.assign(ROUTES.login);
  });
  document.addEventListener('click', async (event) => {
    const sair = event.target.closest('[data-auth-logout]');
    if (!sair) return;
    try {
      const { authService } = await import('../../services/auth.js');
      await authService.logout();
    } catch (error) {}
    globalThis.location.assign(ROUTES.login);
  });
}

function markActiveNav() {
  const current = document.documentElement.dataset.page;
  qsa('[data-nav-page]').forEach((item) => {
    const active = item.dataset.navPage === current;
    item.classList.toggle('on', active);
    if (active) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
}

function routeFromHash(routes, fallback) {
  const bruto = location.hash.replace(/^#/, '').trim();
  /* A QUERY sai antes de procurar a rota.

     `#reserva-nova?dia=2026-08-20&hora=15:00` — que e como a agenda abre o
     formulario ja preenchido — nao casava com nenhum alias e caia no
     dashboard: o clique no horario vazio levava a pessoa para a tela errada,
     sem erro nenhum. O `?` nao faz parte do nome da rota. */
  const hash = bruto.split('?')[0];
  // Rotas com parametro: #reserva/7 e #quadra/2 resolvem pela primeira parte.
  const base = hash.split('/')[0];
  return Object.entries(routes)
    .find(([, route]) => route.aliases.includes(hash) || route.aliases.includes(base))?.[0] || fallback;
}

async function setFragment(container, path) {
  if (!container) return;
  if (!path) {
    container.replaceChildren();
    container.removeAttribute('data-route-error');
    return;
  }

  try {
    const response = await fetch(path, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`Não foi possível carregar ${path}`);
    container.innerHTML = await response.text();
    container.removeAttribute('data-route-error');
    await loadComponents(container);
    initModals();
  } catch (error) {
    container.setAttribute('data-route-error', path);
    container.innerHTML = '<div class="container route-page"><div class="empty"><h3>Tela indisponivel</h3><p>Tente novamente em instantes.</p><a class="btn block" href="./dashboard.html">Voltar ao inicio</a></div></div>';
  }
}

function updateDesktopMeta(routeName, route) {
  document.documentElement.dataset.page = routeName;
  document.title = route.title;

  const title = document.querySelector('[data-page-title]');
  const sub = document.querySelector('[data-page-sub]');
  if (title) title.textContent = route.heading;
  if (sub) sub.textContent = route.sub;
}

async function renderDesktopRoute() {
  const view = document.querySelector('[data-desktop-route-view]');
  if (!view) return;

  const routeName = routeFromHash(DESKTOP_ROUTES, 'dashboard');
  const route = DESKTOP_ROUTES[routeName];

  if (view.dataset.currentRoute === routeName && view.dataset.currentHash === location.hash) {
    updateDesktopMeta(routeName, route);
    markActiveNav();
    return;
  }

  view.dataset.currentRoute = routeName;
  view.dataset.currentHash = location.hash;
  // O manager-app.css tem regras por tela penduradas neste atributo.
  document.documentElement.dataset.managerView = routeName;
  updateDesktopMeta(routeName, route);

  /* A SIDEBAR MARCA A TELA ANTES DE ELA CARREGAR.

     `markActiveNav()` era a ultima linha desta funcao, depois de todos os
     `await`: buscar o fragmento e chamar a API leva de meio segundo a dois, e
     nesse tempo o menu continuava marcando a tela ANTERIOR. Clicava em Agenda,
     o titulo mudava, o endereco mudava, e a sidebar seguia dizendo Mensagens —
     parecia que o clique nao pegou, e a reacao natural e clicar de novo.

     Marcar a navegacao e instantaneo e nao depende de dado nenhum: e uma
     comparacao de string. So o CONTEUDO precisa esperar. */
  markActiveNav();

  /* E a tela avisa que esta carregando, em vez de ficar com o desenho da
     anterior. Sem isto, trocar de rota deixava a tela velha parada na frente e
     depois ela era substituida de uma vez — o que o Gabriel leu como "demora
     demais para aparecer". */
  view.setAttribute('aria-busy', 'true');
  try {
    await setFragment(view, route.page);
    if (routeName === 'dashboard') await renderManagerOverview(view);
    if (routeName === 'quadras') await renderManagerCourts(view);
    if (routeName === 'reservas') await renderManagerReservations(view);
    if (routeName === 'mensalistas') await renderManagerMembers(view);
    if (routeName === 'agenda') await renderManagerAgenda(view);
    if (routeName === 'financeiro') await renderManagerFinance(view);
    if (routeName === 'avaliacoes') await renderManagerReviews(view);
    if (routeName === 'mensagens') await renderManagerMessages(view);
    if (routeName === 'config') {
      await renderManagerSettings(view);
      sincronizarInterruptorDeTema(view);
    }
    if (routeName === 'reservaNova') {
      await renderManagerBookingForm(view);
    // Depois do render: o select de horas so existe quando o formulario ja foi
    // montado, e preencher antes escreveria num campo que sera reescrito.
      prefillReservaNova(view);
    }
    if (routeName === 'reservaDetalhe') await renderManagerBookingDetail(view);
    if (routeName === 'quadraForm') await renderManagerCourtForm(view);
  } finally {
    /* `finally`: uma rota que falha ao carregar nao pode deixar a tela marcada
       como ocupada para sempre. */
    view.removeAttribute('aria-busy');
  }
  document.querySelector('.main')?.scrollTo({ top: 0, behavior: 'auto' });
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function initDesktopRouter() {
  if (!document.querySelector('[data-desktop-route-view]')) return;
  initManagerCourts();
  initManagerReservations();
  initManagerMembers();
  initManagerAgenda();
  initManagerFinance();
  initGraficoDashboard();
  initManagerReviews();
  initManagerMessages();
  initManagerBookingDetail();
  initManagerForms();
  initGaleriaQuadra();
  window.addEventListener('hashchange', renderDesktopRoute);
  return renderDesktopRoute();
}

/* O DONO NO PE DA SIDEBAR.

   O nome sai do usuario da SESSAO (quem esta logado), e a arena do perfil. Sao
   duas coisas diferentes de proposito: quem opera pode nao ser o dono do nome
   da arena, e e justamente essa distincao que o rodape existe para mostrar.

   A sessao ja esta em memoria, entao o nome aparece na hora; so a arena espera
   a rede. Se a chamada falhar, fica o nome — meia informacao verdadeira e
   melhor do que "Carregando..." para sempre. */
async function renderPerfilSidebar() {
  const caixa = document.querySelector('[data-sb-perfil]');
  if (!caixa) return;

  const usuario = storage.getAuthUser?.() || null;
  const nome = usuario?.name || 'Minha conta';
  const set = (sel, valor) => {
    const el = caixa.querySelector(sel);
    if (el) el.textContent = valor;
  };
  set('[data-sb-perfil-nome]', nome);
  set('[data-sb-perfil-inicial]', nome.trim().charAt(0).toUpperCase() || '?');
  set('[data-sb-perfil-arena]', usuario?.email || '');

  /* A MESMA conta no rodape da folha de menu: no celular a sidebar nao
     aparece, e sem isto nao ha onde ver com qual conta se esta logado. */
  const naFolha = (sel, valor) => {
    const el = document.querySelector(sel);
    if (el) el.textContent = valor;
  };
  naFolha('[data-sheet-nome]', nome);
  naFolha('[data-sheet-inicial]', nome.trim().charAt(0).toUpperCase() || '?');
  naFolha('[data-sheet-arena]', usuario?.email || '');

  /* O NOME CABE EM ~150px e "Dono Arena Bola na Rede" vira "Dono Arena Bo...".
     O `title` guarda o texto inteiro, junto do e-mail: com a barra recolhida
     sobra so o avatar, e ai ele e a unica forma de saber de quem e a conta. */
  caixa.title = usuario?.email ? `${nome} · ${usuario.email}` : nome;

  if (!API_BASE_URL) return;
  try {
    const perfil = await managerService.perfil();
    if (perfil?.nome) {
      set('[data-sb-perfil-arena]', perfil.nome);
      const arenaFolha = document.querySelector('[data-sheet-arena]');
      if (arenaFolha) arenaFolha.textContent = perfil.nome;
    }
    /* A LOGO DA ARENA no lugar da inicial, quando houver. O avatar vira uma
       imagem de fundo em vez de <img> para nao mexer no markup do componente
       — e porque a logo chega como data URL, que num <img> exigiria o mesmo
       tratamento de erro que os cartoes de quadra ja precisaram. */
    const av = caixa.querySelector('[data-sb-perfil-inicial]');
    if (av && perfil?.logo) {
      av.style.backgroundImage = `url("${perfil.logo}")`;
      av.classList.add('tem-logo');
    }
  } catch (error) {
    // Sem rede fica o nome da sessao, que ja esta na tela.
  }
}

/* ══════════ FOLHA DE MENU (celular) ══════════════════════════════════════

   Abre pelo "Menu" da barra de baixo e pelo hamburguer do topo — os dois
   apontam para a mesma folha, porque dois gestos diferentes para o mesmo menu
   obrigam a pessoa a aprender os dois.

   Delegado no documento: a folha e um componente carregado por fetch, entao
   prender o listener nela no boot correria o risco de ela ainda nao existir. */
function abrirFolha(id) {
  const folha = document.getElementById(id);
  if (!folha) return;
  folha.hidden = false;
  document.body.classList.add('mgr-sheet-aberta');
  document.querySelectorAll(`[data-sheet-open="${id}"]`).forEach((b) => {
    b.setAttribute('aria-expanded', 'true');
  });
  window.pqRefreshIcons?.(folha);
  // O foco vai para o fechar: quem navega por teclado ou leitor de tela cai
  // dentro da folha, e nao continua no botao que ficou atras dela.
  folha.querySelector('[data-sheet-close]')?.focus?.();
}

function fecharFolha(folha) {
  if (!folha) return;
  folha.hidden = true;
  document.body.classList.remove('mgr-sheet-aberta');
  document.querySelectorAll(`[data-sheet-open="${folha.id}"]`).forEach((b) => {
    b.setAttribute('aria-expanded', 'false');
  });
}

function initFolhaMenu() {
  document.addEventListener('click', (event) => {
    const abrir = event.target.closest('[data-sheet-open]');
    if (abrir) {
      event.preventDefault();
      abrirFolha(abrir.dataset.sheetOpen);
      return;
    }
    const fechar = event.target.closest('[data-sheet-close]');
    if (fechar) {
      fecharFolha(fechar.closest('[data-mgr-sheet]'));
    }
  });

  // Esc fecha, como qualquer dialogo.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    document.querySelectorAll('[data-mgr-sheet]:not([hidden])').forEach(fecharFolha);
  });

  /* Trocar de rota fecha a folha. Os links dentro dela ja tem
     `data-sheet-close`, mas o botao fisico de voltar do Android nao passa por
     eles — e a folha ficaria aberta sobre a tela nova. */
  window.addEventListener('hashchange', () => {
    document.querySelectorAll('[data-mgr-sheet]:not([hidden])').forEach(fecharFolha);
  });
}

function initAppShell() {
  const app = document.getElementById('app');
  if (!app) return;

  const openNav = () => app.classList.add('nav-open');
  const closeNav = () => app.classList.remove('nav-open');

  qsa('[data-nav-open]').forEach((button) => button.addEventListener('click', openNav));
  qsa('[data-nav-close]').forEach((button) => button.addEventListener('click', closeNav));

  /* No mobile a gaveta cobre a tela inteira: toque fora fecha, e Esc
     tambem. Sem isso, abrir o Menu e mudar de ideia deixava a pessoa presa
     atras do painel — nao havia botao de fechar visivel. */
  document.addEventListener('click', (event) => {
    if (!app.classList.contains('nav-open')) return;
    if (event.target.closest('.sidebar, [data-nav-open]')) return;
    closeNav();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeNav();
  });

  // Trocar de rota fecha a gaveta; senao ela fica aberta sobre a tela nova.
  window.addEventListener('hashchange', closeNav);
  qsa('.sidebar a').forEach((link) => link.addEventListener('click', closeNav));
  qsa('.web-account a').forEach((link) => link.addEventListener('click', () => {
    link.closest('.web-account')?.removeAttribute('open');
  }));
  document.addEventListener('click', (event) => {
    qsa('.web-account[open]').forEach((menu) => {
      if (!menu.contains(event.target)) menu.removeAttribute('open');
    });
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeNav();
  });

  try {
    if (localStorage.getItem('pq-rail') === '1') app.classList.add('collapsed');
  } catch (error) {}

  qsa('[data-collapse]').forEach((button) => {
    button.addEventListener('click', () => {
      const collapsed = app.classList.toggle('collapsed');
      button.setAttribute('title', collapsed ? 'Expandir menu' : 'Recolher menu');
      button.setAttribute('aria-label', collapsed ? 'Expandir menu' : 'Recolher menu');
      try {
        localStorage.setItem('pq-rail', collapsed ? '1' : '0');
      } catch (error) {}
    });
  });
}

function initModals() {
  const closeModals = () => qsa('.modal').forEach((modal) => {
    modal.hidden = true;
  });

  qsa('[data-open-modal]').forEach((button) => {
    if (button.dataset.modalBound === 'true') return;
    button.dataset.modalBound = 'true';
    button.addEventListener('click', () => {
      const modal = document.getElementById(button.getAttribute('data-open-modal'));
      if (modal) modal.hidden = false;
    });
  });

  qsa('[data-close-modal]').forEach((button) => {
    if (button.dataset.modalCloseBound === 'true') return;
    button.dataset.modalCloseBound = 'true';
    button.addEventListener('click', closeModals);
  });

  if (document.documentElement.dataset.modalEscBound !== 'true') {
    document.documentElement.dataset.modalEscBound = 'true';
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeModals();
    });
  }
}

function initRedirectToast() {
  try {
    const params = new URLSearchParams(location.search);
    const message = params.get('toast');
    if (!message || !window.pqToast) return;

    window.pqToast(message);
    params.delete('toast');
    const query = params.toString();
    history.replaceState({}, '', location.pathname + (query ? `?${query}` : '') + location.hash);
  } catch (error) {}
}

document.addEventListener('DOMContentLoaded', async () => {
  /* O LOADER SAI MESMO SE O BOOT FALHAR.

     `esconderLoader()` estava na ultima linha deste bloco: qualquer excecao no
     meio — uma rota que nao carrega, a API fora do ar — pulava a chamada e
     deixava a tela de carregamento presa. O painel podia estar inteiro atras
     dela e ninguem veria.

     Com try/finally ela sai nos dois casos. O erro continua subindo para o
     console; o que muda e que o dono ve a tela em vez de um vazio. */
  try {
    await iniciarPainel();
  } finally {
    esconderLoader();
  }
});

async function iniciarPainel() {
  window.pqRefreshIcons = refreshIcons;
  await loadComponents();
  window.pqSyncAuthControls?.();
  applyRouteGuards();
  initAuthLifecycle();
  await initDesktopRouter();
  markActiveNav();
  initAppShell();
  initFolhaMenu();
  renderPerfilSidebar();
  initModals();
  initRedirectToast();
}

/* A TELA DE CARREGAMENTO SAI QUANDO HA O QUE MOSTRAR.

   Ela e inline no dashboard.html para estar pintada no primeiro frame; o
   trabalho que ela cobre e o `loadComponents()` + a primeira rota, que chegam
   por fetch.

   Uma pausa minima de 900ms: a animacao tem 2s e, num painel que ja respondeu
   do cache, ela apareceria e sumiria em 80ms — um flash que le como defeito.
   Uma tela de carregamento que pisca e pior do que nenhuma.

   `remove()` depois da transicao, e nao so `hidden`: o video continuaria
   decodificando 120 frames em loop atras da tela, para sempre. */
function esconderLoader() {
  const el = document.querySelector('[data-loader]');
  if (!el) return;
  const sair = () => {
    el.classList.add('is-saindo');
    el.addEventListener('transitionend', () => el.remove(), { once: true });
    // Rede de seguranca: sem transicao (prefers-reduced-motion, aba em
    // segundo plano) o transitionend nunca dispara e a tela ficaria travada.
    setTimeout(() => el.remove(), 600);
  };
  const decorrido = performance.now();
  setTimeout(sair, Math.max(0, 900 - decorrido));
}

/* Interruptor de tema em Configuracoes.

   O ui.js ja vira a classe .on de qualquer .switch-row (handler generico);
   aqui so lemos o resultado e gravamos. Fica fora do "Salvar alteracoes" do
   formulario de proposito: o tema muda a tela na hora, e confirmar depois
   disso nao faria sentido. */
document.addEventListener('click', (event) => {
  const linha = event.target.closest('[data-cfg-tema]');
  if (!linha) return;
  const claro = linha.querySelector('.switch')?.classList.contains('on');
  definirTema(claro ? 'light' : 'dark');
});

/* A tela de Configuracoes e remontada a cada visita e o interruptor nasce
   desligado no HTML. Sem sincronizar, quem esta no claro abriria e leria
   "modo claro: desligado". */
export function sincronizarInterruptorDeTema(raiz = document) {
  const sw = raiz.querySelector('[data-cfg-tema] .switch');
  if (sw) sw.classList.toggle('on', claroLigado());
}
