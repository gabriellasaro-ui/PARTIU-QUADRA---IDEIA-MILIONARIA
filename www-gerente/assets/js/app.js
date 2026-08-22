import { loadComponents, refreshIcons } from './component-loader.js';
import { requireAuth } from '../../middleware/auth.js';
import { qsa } from '../../utils/helpers.js';
import { ROUTES } from '../../config/routes.js';
import { renderManagerCourts, initManagerCourts } from './manager-courts.js';
import { renderManagerReservations, initManagerReservations } from './manager-reservations.js';
import { renderManagerMembers, initManagerMembers } from './manager-members.js';
import { renderManagerOverview } from './manager-overview.js';
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
  markActiveNav();
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
  initManagerReviews();
  initManagerMessages();
  initManagerBookingDetail();
  initManagerForms();
  initGaleriaQuadra();
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
  window.pqRefreshIcons = refreshIcons;
  await loadComponents();
  window.pqSyncAuthControls?.();
  applyRouteGuards();
  initAuthLifecycle();
  await initDesktopRouter();
  markActiveNav();
  initAppShell();
  initModals();
  initRedirectToast();
});

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
