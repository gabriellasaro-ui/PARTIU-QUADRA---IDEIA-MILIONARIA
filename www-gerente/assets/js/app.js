import { loadComponents, refreshIcons } from './component-loader.js';
import { requireAuth } from '../../middleware/auth.js';
import { qsa } from '../../utils/helpers.js';
import { ROUTES } from '../../config/routes.js';
import { renderManagerCourts, initManagerCourts } from './manager-courts.js';
import { renderManagerReservations, initManagerReservations } from './manager-reservations.js';
import { renderManagerMembers, initManagerMembers } from './manager-members.js';
import { renderManagerOverview } from './manager-overview.js';

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
    sub: 'Estrutura, preços e disponibilidade'
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

  if (view.dataset.currentRoute === routeName) {
    updateDesktopMeta(routeName, route);
    markActiveNav();
    return;
  }

  view.dataset.currentRoute = routeName;
  // O manager-app.css tem regras por tela penduradas neste atributo.
  document.documentElement.dataset.managerView = routeName;
  updateDesktopMeta(routeName, route);
  await setFragment(view, route.page);
  if (routeName === 'dashboard') renderManagerOverview(view);
  if (routeName === 'quadras') renderManagerCourts(view);
  if (routeName === 'reservas') renderManagerReservations(view);
  if (routeName === 'mensalistas') await renderManagerMembers(view);
  markActiveNav();
  document.querySelector('.main')?.scrollTo({ top: 0, behavior: 'auto' });
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function initDesktopRouter() {
  if (!document.querySelector('[data-desktop-route-view]')) return;
  initManagerCourts();
  initManagerReservations();
  initManagerMembers();
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

document.addEventListener('DOMContentLoaded', async () => {
  window.pqRefreshIcons = refreshIcons;
  await loadComponents();
  window.pqSyncAuthControls?.();
  applyRouteGuards();
  await initDesktopRouter();
  markActiveNav();
  initAppShell();
  initModals();
  initRedirectToast();
});
