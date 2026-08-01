import { loadComponents, refreshIcons } from './component-loader.js';
import { requireAuth, redirectWhenAuthenticated } from '../../middleware/auth.js';
import { qsa } from '../../utils/helpers.js';
import authService from '../../services/auth.js';
import { API_BASE_URL } from '../../config/constants.js';
import { parseMobileRouteHash, ROUTES } from '../../config/routes.js';
import { initMobileActions, renderMobilePage } from './mobile.js';
import { initPlayerDesktopActions, renderPlayerDesktopPage } from './player-desktop.js';
import { loadGame, destroyGame } from './game-mode.js';
import { renderManagerVenues, initManagerVenues } from './manager-venues.js';

const MOBILE_ROUTES = {
  home: {
    header: './components/header/mobile-home-header.html',
    page: './pages/home.html',
    title: 'Qadras',
    nav: 'home'
  },
  quadras: {
    header: null,
    page: './pages/explorar.html',
    title: 'Quadras - Qadras',
    nav: 'quadras'
  },
  mapa: {
    header: null,
    page: './pages/mapa.html',
    title: 'Mapa de quadras - Qadras',
    nav: 'mapa'
  },
  quadra: {
    header: null,
    page: './pages/quadra.html',
    title: 'Detalhes da quadra - Qadras',
    nav: 'quadras'
  },
  pagamento: {
    header: null,
    page: './pages/pagamento.html',
    title: 'Solicitar reserva - Qadras',
    nav: 'quadras'
  },
  confirmado: {
    header: null,
    page: './pages/confirmado.html',
    title: 'Aguardando aprovação - Qadras',
    nav: 'reservas'
  },
  reservas: {
    header: null,
    page: './pages/reservas.html',
    title: 'Reservas - Qadras',
    nav: 'reservas'
  },
  favoritos: {
    header: null,
    page: './pages/favoritos.html',
    title: 'Favoritos - Qadras',
    nav: 'menu'
  },
  carteira: {
    header: null,
    page: './pages/carteira.html',
    title: 'Carteira - Qadras',
    nav: 'menu'
  },
  carteiraAcao: {
    header: null,
    page: './pages/carteira-acao.html',
    title: 'Carteira - Qadras',
    nav: 'menu'
  },
  perfil: {
    header: null,
    page: './pages/perfil.html',
    title: 'Perfil - Qadras',
    nav: 'menu'
  },
  config: {
    header: null,
    page: './pages/config.html',
    title: 'Configurações - Qadras',
    nav: 'menu'
  },
  mensagens: {
    header: null,
    page: './pages/mensagens.html',
    title: 'Mensagens - Qadras',
    nav: 'menu'
  },
  clube: {
    header: null,
    page: './pages/clube.html',
    title: 'Clube - Qadras',
    nav: 'menu'
  },
  game: {
    header: null,
    page: './pages/game.html',
    title: 'Sua partida - Qadras',
    nav: 'home'
  }
};

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
    sub: 'Receitas, repasses e pagamentos'
  },
  quadras: {
    aliases: ['quadras', 'minhas-quadras'],
    page: './pages/desktop/quadras.html',
    title: 'Minhas quadras - Qadras',
    heading: 'Minhas quadras',
    sub: 'Estrutura, precos e disponibilidade'
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

const PLAYER_DESKTOP_ROUTES = {
  quadras: {
    page: './pages/player-desktop/explorar.html',
    title: 'Explorar quadras - Qadras',
    heading: 'Explorar quadras',
    sub: 'Quadras disponíveis perto de Goiânia',
    nav: 'quadras'
  },
  quadra: {
    page: './pages/player-desktop/quadra.html',
    title: 'Detalhes da quadra - Qadras',
    heading: 'Detalhes da quadra',
    sub: 'Estrutura, disponibilidade e reserva',
    nav: 'quadras'
  },
  pagamento: {
    page: './pages/player-desktop/checkout.html',
    title: 'Solicitar reserva - Qadras',
    heading: 'Solicitar reserva',
    sub: 'Revise os dados e envie a solicitação',
    nav: 'quadras'
  },
  confirmado: {
    page: './pages/player-desktop/confirmado.html',
    title: 'Aguardando aprovação - Qadras',
    heading: 'Aguardando aprovação',
    sub: 'A arena está analisando a solicitação',
    nav: 'reservas'
  },
  reservas: {
    page: './pages/player-desktop/reservas.html',
    title: 'Minhas reservas - Qadras',
    heading: 'Minhas reservas',
    sub: 'Acompanhe seus jogos agendados',
    nav: 'reservas'
  },
  favoritos: {
    page: './pages/player-desktop/favoritos.html',
    title: 'Favoritos - Qadras',
    heading: 'Favoritos',
    sub: 'As quadras que você salvou',
    nav: 'favoritos'
  },
  carteira: {
    page: './pages/player-desktop/carteira.html',
    title: 'Carteira - Qadras',
    heading: 'Carteira',
    sub: 'Saldo, extrato e formas de pagamento',
    nav: 'carteira'
  },
  carteiraAcao: {
    page: './pages/player-desktop/carteira-acao.html',
    title: 'Carteira - Qadras',
    heading: 'Carteira',
    sub: 'Gerencie seu saldo e pagamentos',
    nav: 'carteira'
  },
  perfil: {
    page: './pages/player-desktop/perfil.html',
    title: 'Perfil - Qadras',
    heading: 'Perfil',
    sub: 'Seus dados, conquistas e preferências',
    nav: 'perfil'
  },
  config: {
    page: './pages/player-desktop/config.html',
    title: 'Configurações - Qadras',
    heading: 'Configurações',
    sub: 'Notificações, preferências e conta',
    nav: 'config'
  },
  mensagens: {
    page: './pages/player-desktop/mensagens.html',
    title: 'Mensagens - Qadras',
    heading: 'Mensagens',
    sub: 'Fale direto com as arenas',
    nav: 'mensagens'
  },
  game: {
    page: './pages/game.html',
    title: 'Game Day - Qadras',
    heading: 'Game Day',
    sub: 'Sua partida',
    nav: 'game'
  }
};

function applyRouteGuards() {
  const page = document.documentElement;
  if (page.dataset.authRequired === 'true') requireAuth();
  if (page.dataset.guestOnly === 'true') redirectWhenAuthenticated();
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
  const hash = location.hash.replace(/^#/, '').trim();
  return Object.entries(routes).find(([, route]) => route.aliases.includes(hash))?.[0] || fallback;
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
    container.innerHTML = '<div class="container route-page"><div class="empty"><h3>Tela indisponivel</h3><p>Tente novamente em instantes.</p><a class="btn block" href="./index.html">Voltar ao inicio</a></div></div>';
  }
}

function mobileRouteFromHash() {
  const parsed = parseMobileRouteHash(location.hash);
  const name = MOBILE_ROUTES[parsed.name] ? parsed.name : 'home';
  return {
    ...parsed,
    name,
    route: MOBILE_ROUTES[name],
    signature: name === parsed.name ? parsed.signature : 'home::'
  };
}

async function renderMobileRoute() {
  const header = document.querySelector('[data-route-header]');
  const view = document.querySelector('[data-route-view]');
  if (!header || !view) return;

  const routeState = mobileRouteFromHash();
  const { name: routeName, route } = routeState;
  if (view.dataset.currentRoute === routeState.signature) {
    document.documentElement.dataset.page = route.nav;
    document.documentElement.dataset.route = routeName;
    document.title = route.title;
    markActiveNav();
    return;
  }

  const prevRoute = view.dataset.currentRoute;
  view.dataset.currentRoute = routeState.signature;
  document.documentElement.dataset.page = route.nav;
  document.documentElement.dataset.route = routeName;
  document.title = route.title;

  if (prevRoute && prevRoute !== routeState.signature && routeName !== 'game') {
    destroyGame();
  }

  await Promise.all([
    setFragment(header, route.header),
    setFragment(view, route.page)
  ]);
  await renderMobilePage(routeState, view);
  refreshIcons(view);

  markActiveNav();
  document.querySelector('.screen')?.scrollTo({ top: 0, behavior: 'auto' });
}

function initMobileRouter() {
  if (!document.querySelector('[data-route-view]')) return;
  window.addEventListener('hashchange', renderMobileRoute);
  return renderMobileRoute();
}

function playerDesktopRouteFromHash() {
  const parsed = parseMobileRouteHash(location.hash);
  const requested = parsed.name === 'home' ? 'quadras' : parsed.name;
  const name = PLAYER_DESKTOP_ROUTES[requested] ? requested : 'quadras';
  return {
    ...parsed,
    name,
    route: PLAYER_DESKTOP_ROUTES[name],
    signature: requested === name ? `${name}:${parsed.signature}` : 'quadras:quadras::'
  };
}

function updatePlayerDesktopMeta(routeName, route) {
  document.documentElement.dataset.page = route.nav;
  document.documentElement.dataset.route = routeName;
  document.title = route.title;

  const title = document.querySelector('[data-page-title]');
  const sub = document.querySelector('[data-page-sub]');
  if (title) title.textContent = route.heading;
  if (sub) sub.textContent = route.sub;
}

async function renderPlayerDesktopRoute() {
  const view = document.querySelector('[data-player-desktop-route-view]');
  if (!view) return;

  const routeState = playerDesktopRouteFromHash();
  const { name: routeName, route } = routeState;
  if (view.dataset.currentRoute === routeState.signature) {
    updatePlayerDesktopMeta(routeName, route);
    markActiveNav();
    return;
  }

  const prevRoute = view.dataset.currentRoute;
  view.dataset.currentRoute = routeState.signature;
  updatePlayerDesktopMeta(routeName, route);
  if (prevRoute && prevRoute !== routeState.signature && routeName !== 'game') {
    destroyGame();
  }
  await setFragment(view, route.page);
  await renderPlayerDesktopPage(routeState, view);
  refreshIcons(view);
  markActiveNav();
  document.querySelector('.main')?.scrollTo({ top: 0, behavior: 'auto' });
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function initPlayerDesktopRouter() {
  if (!document.querySelector('[data-player-desktop-route-view]')) return;
  window.addEventListener('hashchange', renderPlayerDesktopRoute);
  return renderPlayerDesktopRoute();
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

  if (view.dataset.currentRoute === routeName) {
    updateDesktopMeta(routeName, route);
    markActiveNav();
    return;
  }

  view.dataset.currentRoute = routeName;
  updateDesktopMeta(routeName, route);
  await setFragment(view, route.page);
  // As paginas do gerente ainda sao HTML fixo; quadras e a primeira ligada
  // a dados, e outras entram aqui do mesmo jeito.
  if (routeName === 'quadras') await renderManagerVenues(view);
  markActiveNav();
  document.querySelector('.main')?.scrollTo({ top: 0, behavior: 'auto' });
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function initDesktopRouter() {
  if (!document.querySelector('[data-desktop-route-view]')) return;
  initManagerVenues();
  window.addEventListener('hashchange', renderDesktopRoute);
  return renderDesktopRoute();
}

function initAppShell() {
  const app = document.getElementById('app');
  if (!app) return;

  const openNav = () => app.classList.add('nav-open');
  const closeNav = () => app.classList.remove('nav-open');

  qsa('[data-nav-open]').forEach((button) => button.addEventListener('click', openNav));
  qsa('[data-nav-close]').forEach((button) => button.addEventListener('click', closeNav));
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

function initLoginForms() {
  qsa('[data-login-form]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;

      if (!API_BASE_URL) {
        window.pqToast?.('API sera conectada na proxima etapa');
        return;
      }

      const submit = form.querySelector('[type="submit"]');
      submit?.setAttribute('disabled', 'disabled');

      try {
        await authService.login(Object.fromEntries(new FormData(form)));
        window.location.assign(ROUTES.dashboard);
      } catch (error) {
        window.pqToast?.(error.message || 'Não foi possível entrar');
      } finally {
        submit?.removeAttribute('disabled');
      }
    });
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  window.pqRefreshIcons = refreshIcons;
  await loadComponents();
  window.pqSyncAuthControls?.();
  applyRouteGuards();
  initMobileActions();
  initPlayerDesktopActions();
  await initMobileRouter();
  await initPlayerDesktopRouter();
  await initDesktopRouter();
  markActiveNav();
  initAppShell();
  initModals();
  initRedirectToast();
  initLoginForms();
});
