import venueService, { localEscolhido, definirLocal } from '../../services/venues.js';
import { API_BASE_URL, SERVICE_FEE_RATE } from '../../config/constants.js';
import { submitPlayerReservation, payPlayerReservation, watchReservation } from '../../services/reservation-live.js';
import { calculateCheckoutAmounts, formatCurrency } from '../../utils/formatters.js';
import { imageFileToDataUrl } from '../../utils/helpers.js';
import { loadGame, destroyGame } from './game-mode.js';
import { rotaLiberada } from '../../services/platform.js';
import authService from '../../services/auth.js';
import { LEVELS } from '../../config/mock-data.js';
import { posicoesDe, MODALIDADES } from '../../config/esportes.js';
import { refreshIcons } from './component-loader.js';

let currentRoute = null;
let desktopMap = null;
let activeDesktopApprovalTimer = null;
/* Fallback, nao a verdade: e o centro de Belo Horizonte, usado so enquanto a pessoa
   nao escolheu local nenhum. Quem manda e localEscolhido(). */
const LOCAL_PADRAO = [-19.9300, -43.9400];

/* O mapa tem que seguir o mesmo local da lista. Antes lia a constante direto:
   trocar para "usar minha localizacao" reordenava os resultados mas o mapa
   continuava centrado em Goiania, com o "Voce esta aqui" no lugar errado. */
function coordenadaAtual() {
  const local = localEscolhido();
  return (local && local.lat != null) ? [local.lat, local.lng] : LOCAL_PADRAO;
}

/* Raio de busca escolhido em Ajustes. O mapa enquadra por ele: antes o zoom
   era fixo em 13, entao mudar "ate 25 km" nao mudava nada na tela. */
function raioKm() {
  return Number(lerPreferencias().distancia) || 5;
}

/* Zoom que faz o raio caber na tela. Cada nivel dobra a escala; 13 mostra
   ~5 km de raio num viewport tipico, e cada duplicacao do raio tira um. */
function zoomParaRaio(km) {
  return Math.max(9, Math.min(15, Math.round(13 - Math.log2(km / 5))));
}
const APPROVAL_WINDOW_MS = 15 * 60 * 1000;
const MOCK_APPROVAL_DELAY_MS = 5000;
const SPORT_ICON_SHAPES = {
  futebol: '<circle cx="12" cy="12" r="10"/><path d="M12 7.8 15.99 10.7 14.47 15.38H9.53L8.01 10.7Z"/><path d="M12 7.8V2.8"/><path d="m15.99 10.7 4.76-1.54"/><path d="m14.47 15.38 2.94 4.06"/><path d="M9.53 15.38 6.59 19.44"/><path d="M8.01 10.7 3.25 9.16"/>',
  basquete: '<circle cx="12" cy="12" r="10"/><path d="M12 2v20"/><path d="M2 12h20"/><path d="M5 4.2c3.6 3.4 3.6 12.2 0 15.6"/><path d="M19 4.2c-3.6 3.4-3.6 12.2 0 15.6"/>',
  volei: '<circle cx="12" cy="12" r="10"/><path d="M11 7a16 16 20 0 1 10.98 4.362"/><path d="M12 12a13 13 0 0 1-8.66 5"/><path d="M16.83 13.634a16 16 0 0 1-9.267 7.328"/><path d="M20.66 17A13 13 0 0 0 12 12a13 13 0 0 1 0-10"/><path d="M8.17 15.366a16 16 0 0 1-1.713-11.69"/>',
  tenis: '<circle cx="12" cy="12" r="10"/><path d="M3.6 6.2c5 2.7 11.8 2.7 16.8 0"/><path d="M3.6 17.8c5-2.7 11.8-2.7 16.8 0"/>',
  beach: '<circle cx="12" cy="9.5" r="6.4"/><path d="M6.1 7c3.7 1.7 8.1 1.7 11.8 0"/><path d="M6.1 12c3.7-1.7 8.1-1.7 11.8 0"/><path d="M2.5 19.5c2.2-1.5 4.4-1.5 6.5 0s4.3 1.5 6.5 0 4.4-1.5 6-.4"/>'
};

const SPORT_ICONS = {
  'Futebol Society': 'futebol',
  Futsal: 'futebol',
  Basquete: 'basquete',
  Volei: 'volei',
  Tenis: 'tenis',
  'Beach Tennis': 'beach'
};

/* Cada esporte com a sua bola. O Lucide empacotado no projeto nao tem bola
   nenhuma alem de volleyball — por isso o mapa antigo caia em target,
   circle-dot e trophy, que nao dizem nada. Estas sao desenhadas na mesma
   grade do Lucide (24x24, traco 2, pontas arredondadas) e entram como SVG
   inline; a classe .ic cuida do tamanho e da cor. Futsal e Society dividem a
   bola porque e a mesma bola. */
function sportIcon(sport, className = 'ic') {
  const chave = SPORT_ICONS[sport]
    || SPORT_ICONS[String(sport ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')];
  const corpo = chave && SPORT_ICON_SHAPES[chave];
  if (!corpo) return icon('trophy', className);
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true">${corpo}</svg>`;
}
const PAYMENT_METHOD_LABELS = {
  pix: 'Pix',
  card: 'Cartão de crédito'
};

function icon(name, className = 'ic') {
  return `<i class="${className}" data-lucide="${name}"></i>`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function money(value) {
  return formatCurrency(Number(value || 0));
}

function normalizeSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function displayText(value) {
  const replacements = {
    Volei: 'Vôlei',
    Tenis: 'Tênis',
    'Jardim Goiás': 'Jardim Goiás',
    'Alto da Glória': 'Alto da Glória',
    'Grama sintética': 'Grama sintética',
    Vestiário: 'Vestiário'
  };
  return replacements[value] || value;
}

function ratingStars(rating, className = 'ic sm') {
  return Array.from({ length: 5 }, (_, index) => (
    icon('star', `${className} ${index >= Math.round(Number(rating)) ? 'is-empty' : ''}`)
  )).join('');
}

function formatApprovalCountdown(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function approvalWaitingVisual() {
  return `
    <div class="approval-live-visual" aria-hidden="true">
      <span class="approval-live-visual__route"></span>
      <span class="approval-live-visual__endpoint approval-live-visual__user">${icon('user-round')}</span>
      <span class="approval-live-visual__endpoint approval-live-visual__arena">${icon('goal')}</span>
      <span class="approval-live-visual__pulse approval-live-visual__pulse--one"></span>
      <span class="approval-live-visual__pulse approval-live-visual__pulse--two"></span>
    </div>
    <div class="approval-live-caption">
      <span aria-hidden="true"><i></i><i></i><i></i></span>
      <strong>A arena está analisando</strong>
    </div>`;
}

function addHours(hour, duration) {
  const start = Number(String(hour).slice(0, 2));
  return `${String(start + Number(duration)).padStart(2, '0')}:00`;
}

function localDateValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseLocalDate(value) {
  const [year, month, day] = String(value).split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
}

function dateLabel(value) {
  const date = parseLocalDate(value);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  const short = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(date);
  if (localDateValue(date) === localDateValue(today)) return `Hoje, ${short}`;
  if (localDateValue(date) === localDateValue(tomorrow)) return `Amanhã, ${short}`;
  const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' }).format(date).replace('.', '');
  return `${weekday}, ${short}`;
}

function venueInitials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'PQ';
  return `${words[0][0]}${words.length > 1 ? words[words.length - 1][0] : ''}`.toUpperCase();
}

function amenityIcon(label) {
  const value = normalizeSearch(label);
  if (value.includes('ilumin')) return 'lightbulb';
  if (value.includes('vestiario')) return 'shirt';
  if (value.includes('estacion')) return 'car';
  if (value.includes('bar')) return 'coffee';
  if (value.includes('coberta')) return 'home';
  if (value.includes('arquibanc')) return 'users';
  if (value.includes('aula')) return 'book-open';
  if (value.includes('wi-fi') || value.includes('wifi')) return 'wifi';
  return 'circle-check';
}

function calendarMonthValue(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function calendarMonthDate(value) {
  const [year, month] = String(value).split('-').map(Number);
  return new Date(year, month - 1, 1, 12, 0, 0);
}

function renderDesktopBookingCalendar(root) {
  const booking = root.querySelector('[data-player-booking]');
  const calendar = root.querySelector('[data-player-booking-calendar]');
  if (!booking || !calendar) return;

  const today = parseLocalDate(localDateValue());
  const maxDate = new Date(today);
  maxDate.setDate(maxDate.getDate() + 60);
  const minMonth = new Date(today.getFullYear(), today.getMonth(), 1, 12, 0, 0);
  const maxMonth = new Date(maxDate.getFullYear(), maxDate.getMonth(), 1, 12, 0, 0);
  let month = calendarMonthDate(booking.dataset.calendarMonth || calendarMonthValue(parseLocalDate(booking.dataset.date)));
  if (month < minMonth) month = minMonth;
  if (month > maxMonth) month = maxMonth;
  booking.dataset.calendarMonth = calendarMonthValue(month);

  const label = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(month);
  calendar.querySelector('[data-player-calendar-label]').textContent = label.charAt(0).toUpperCase() + label.slice(1);
  calendar.querySelector('[data-player-calendar-nav="-1"]').disabled = month <= minMonth;
  calendar.querySelector('[data-player-calendar-nav="1"]').disabled = month >= maxMonth;

  const firstWeekday = month.getDay();
  const totalDays = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = [];
  for (let index = 0; index < 42; index += 1) {
    const day = index - firstWeekday + 1;
    if (day < 1 || day > totalDays) {
      cells.push('<span class="calendar-empty" aria-hidden="true"></span>');
      continue;
    }
    const date = new Date(month.getFullYear(), month.getMonth(), day, 12, 0, 0);
    const value = localDateValue(date);
    const disabled = date < today || date > maxDate;
    const selected = value === booking.dataset.date;
    const isToday = value === localDateValue(today);
    const spoken = new Intl.DateTimeFormat('pt-BR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    }).format(date);
    cells.push(`
      <button type="button" class="calendar-day ${selected ? 'on' : ''} ${isToday ? 'is-today' : ''}"
              data-player-calendar-date="${value}" aria-label="${escapeHtml(spoken)}"
              aria-pressed="${selected}" ${disabled ? 'disabled' : ''}>
        <span>${day}</span>
      </button>`);
  }
  calendar.querySelector('[data-player-calendar-grid]').innerHTML = cells.join('');
  window.pqRefreshIcons?.(calendar);
}

function setDesktopBookingStage(root, nextStage, focusPanel = false) {
  const booking = root?.querySelector('[data-player-booking]');
  if (!booking) return;
  const stages = ['date', 'duration', 'time'];
  const stage = stages.includes(nextStage) ? nextStage : 'date';
  const currentIndex = stages.indexOf(stage);
  booking.dataset.bookingStage = stage;

  booking.querySelectorAll('[data-booking-stage-panel]').forEach((panel) => {
    const active = panel.dataset.bookingStagePanel === stage;
    panel.hidden = !active;
    panel.classList.toggle('is-active', active);
    if (active && focusPanel) {
      panel.tabIndex = -1;
      window.setTimeout(() => panel.focus({ preventScroll: true }), 0);
    }
  });

  booking.querySelectorAll('.booking-wizard-nav [data-booking-stage-go]').forEach((button) => {
    const index = stages.indexOf(button.dataset.bookingStageGo);
    const active = index === currentIndex;
    button.classList.toggle('is-active', active);
    button.classList.toggle('is-complete', index < currentIndex);
    if (active) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  });
}

/* CORRECAO GRAVE. Aqui morava availabilityForDay(base, dayIndex), que nao
   consultava nada: pegava a agenda de um dia e ROTACIONAVA o vetor de status
   conforme o deslocamento do dia. O horario dizia "livre" porque OUTRO
   horario estava livre. Com 2h ou 3h de duracao dava para pedir um bloco por
   cima de uma reserva existente.

   O mobile ja tinha sido corrigido; este arquivo ficou para tras — por isso o
   problema continuou aparecendo no layout de desktop.

   Nao ha como derivar a agenda de um dia a partir de outro: so perguntando. */
async function carregarDisponibilidade(booking) {
  const venueId = booking.dataset.venueId;
  const date = booking.dataset.date;
  if (!venueId || !date) return;
  booking.dataset.carregando = '1';
  try {
    const slots = await venueService.availability(venueId, date);
    booking.dataset.availability = JSON.stringify(slots);
  } catch (error) {
    /* Melhor nao mostrar horario nenhum do que mostrar o de outro dia como se
       fosse deste. */
    booking.dataset.availability = '[]';
    window.pqToast?.('Não foi possível carregar os horários deste dia');
  } finally {
    delete booking.dataset.carregando;
  }
}

function routeQuery(route) {
  return route?.query instanceof URLSearchParams ? route.query : new URLSearchParams();
}

function venueCard(venue, favorite = false, options = {}) {
  /* Dentro do perfil da arena o titulo e o nome da QUADRA: o da arena esta no
     topo da tela e sairia repetido em todos os cards. Fora dele vale o
     contrario — a arena e o que identifica o lugar, e a quadra vira a linha de
     baixo, so quando ha mais de uma. */
  const naArena = Boolean(options.dentroDaArena);
  const favoriteButton = favorite
    ? `<button type="button" class="fav-heart on" data-player-favorite="${venue.arenaId}" aria-label="Remover dos favoritos">
        ${icon('heart', 'ic fill')}
      </button>`
    : '';
  const availability = venue.id % 3 === 0 ? 'Hoje a noite' : 'Livre agora';
  return `
    <article class="qcard ${favorite ? 'has-favorite' : ''}" data-venue-id="${venue.id}">
      <div class="ph">
        ${favoriteButton}
        <span class="pill tr">${icon('navigation')}${venue.distance.toLocaleString('pt-BR')} km</span>
        <span class="pill star tl">${icon('star')}${venue.rating}</span>
        <span class="desktop-availability">${icon('clock-3')}${availability}</span>
        <img src="${escapeHtml(venue.image)}" alt="${escapeHtml(venue.name)}" loading="lazy" decoding="async">
      </div>
      <div class="bd">
        <div class="qcard-kicker">${sportIcon(venue.sport)}${escapeHtml(venue.sport)}</div>
        <h3>${escapeHtml(naArena ? (venue.courtName || venue.name) : (venue.arenaName || venue.name))}</h3>
        ${!naArena && venue.arenaCourtCount > 1 && venue.courtName
          ? `<p class="qcard-quadra">${icon('layout-grid')}${escapeHtml(venue.courtName)}</p>`
          : ''}
        <p class="meta">${icon('map-pin')}${escapeHtml(venue.neighborhood)} - ${venue.distance.toLocaleString('pt-BR')} km</p>
        <div class="tags">${venue.tags.slice(0, 3).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>
        <div class="foot">
          <div class="price">${money(venue.price)}<small> /hora</small></div>
          <a href="#quadra/${venue.id}" class="btn btn-primary">Ver horários${icon('arrow-right', 'ic sm')}</a>
        </div>
      </div>
    </article>`;
}

function mapPopup(venue) {
  return `
    <a href="#quadra/${venue.id}" style="display:flex;gap:10px;align-items:center;min-width:220px">
      <img src="${escapeHtml(venue.image)}" alt="" style="width:64px;height:58px;object-fit:cover;border-radius:7px" decoding="async" loading="lazy">
      <span>
        <strong style="display:block">${escapeHtml(venue.name)}</strong>
        <small style="display:block;margin:3px 0">${escapeHtml(venue.neighborhood)}</small>
        <b>${money(venue.price)} /hora</b>
      </span>
    </a>`;
}

async function renderExplore(root, route) {
  const query = routeQuery(route);
  const sport = query.get('esporte') || '';
  const term = query.get('q') || '';
  const escolhido = localEscolhido();
  const cidades = await venueService.cidadesComQuadra();
  /* Padrao vem da propria lista, e nao de uma string escrita aqui: o banco
     grava "Goiania" sem acento e o rotulo fixo era "Goiânia, GO" — nenhuma
     opcao casava, o <select> caia na primeira (que e "Usar minha
     localizacao") e parecia ativo sem nunca ter obtido posicao alguma. */
  const local = escolhido?.label || query.get('local') || cidades[0]?.label || 'Belo Horizonte, MG';
  const radius = query.get('raio') || '5';
  const now = query.get('agora') === '1';
  const [sports, listedVenues, arenas] = await Promise.all([
    venueService.sports(),
    venueService.list({ sport }),
    venueService.arenasProximas()
  ]);
  const needle = normalizeSearch(term);
  const venues = listedVenues.filter((venue) => {
    const searchable = normalizeSearch([
      venue.name,
      venue.sport,
      venue.neighborhood,
      ...venue.tags
    ].join(' '));
    const matchesTerm = !needle || searchable.includes(needle);
    const insideRadius = venue.distance <= Number(radius);
    const availableSoon = !now || venue.id % 3 !== 0;
    return matchesTerm && insideRadius && availableSoon;
  });
  const pageSub = document.querySelector('[data-page-sub]');
  if (pageSub) {
    pageSub.textContent = now
      ? `${venues.length} quadras com horários próximos`
      : `${venues.length} quadras disponíveis perto de ${local}`;
  }
  root.innerHTML = `
    <section class="desktop-market-hero">
      <div class="desktop-market-hero__top">
        <div class="desktop-market-hero__copy">
          <!-- Trocar de cidade muda a coordenada da busca, e nao so o rotulo. -->
          <!-- <details> e nao <select>: o menu nativo nao aceita icone por
               opcao nem a contagem de arenas, e o realce azul do sistema
               destoava de tudo. Fecha com Esc e com clique fora, como o menu
               da conta. -->
          <details class="desktop-local" data-player-local>
            <summary aria-label="Trocar o local da busca">
              ${icon(escolhido?.auto ? 'locate-fixed' : 'map-pin', 'ic sm')}
              <span data-local-rotulo>${escapeHtml(escolhido?.auto ? 'Perto de você' : local)}</span>
              ${icon('chevron-down', 'ic sm')}
            </summary>
            <div class="desktop-local__menu" role="listbox">
              <!-- Primeira opcao e a localizacao real, como no iFood/Uber: o
                   padrao util e "onde eu estou", nao uma cidade fixa. -->
              <button type="button" role="option" aria-selected="${escolhido?.auto ? 'true' : 'false'}"
                      class="desktop-local__op ${escolhido?.auto ? 'on' : ''}" data-local-op="__auto__">
                ${icon('locate-fixed', 'ic sm')}
                <span><strong>Usar minha localização</strong><small>Ordena pelas quadras mais perto de onde você está</small></span>
              </button>
              ${(cidades.length ? cidades : [{ label: local }]).map((c) => `
              <button type="button" role="option" aria-selected="${!escolhido?.auto && c.label === local ? 'true' : 'false'}"
                      class="desktop-local__op ${!escolhido?.auto && c.label === local ? 'on' : ''}" data-local-op="${escapeHtml(c.label)}">
                ${icon('map-pin', 'ic sm')}
                <span><strong>${escapeHtml(c.label)}</strong>${c.arenas ? `<small>${c.arenas} ${c.arenas === 1 ? 'arena' : 'arenas'}</small>` : ''}</span>
              </button>`).join('')}
            </div>
          </details>
          <h2>${now ? 'Horários livres agora' : 'Quadras perto de você'}</h2>
          <p>Escolha o esporte e encontre o melhor horário.</p>
        </div>
      </div>
      <form class="toolbar desktop-market-search" data-player-explore-form>
        <div class="field grow">
          ${icon('search')}
          <input type="search" name="q" value="${escapeHtml(term)}" placeholder="Quadra, bairro ou esporte">
        </div>
        <input type="hidden" name="local" value="${escapeHtml(local)}">
        <div class="desktop-sport-picker" data-sport-select data-submit-on-select>
          <input type="hidden" name="esporte" value="${escapeHtml(sport)}">
          <button class="desktop-sport-trigger" type="button" data-sport-trigger
                  aria-haspopup="listbox" aria-expanded="false">
            ${sportIcon(sport)}
            <span data-sport-label>${escapeHtml(sport || 'Todos os esportes')}</span>
            ${icon('chevron-down', 'desktop-sport-chevron')}
          </button>
          <div class="desktop-sport-menu" data-sport-menu role="listbox" aria-label="Escolha um esporte" hidden>
            <button type="button" class="${sport ? '' : 'is-selected'}" data-sport-option="" role="option" aria-selected="${String(!sport)}">
              ${icon('sparkles')}<span>Todos os esportes</span>${icon('check', 'desktop-sport-check')}
            </button>
            ${sports.map((item) => `
              <button type="button" class="${item === sport ? 'is-selected' : ''}" data-sport-option="${escapeHtml(item)}" role="option" aria-selected="${String(item === sport)}">
                ${sportIcon(item)}<span>${escapeHtml(item)}</span>${icon('check', 'desktop-sport-check')}
              </button>`).join('')}
          </div>
        </div>
        <button class="btn btn-primary" type="submit">${icon('arrow-right')}Buscar</button>
      </form>
    </section>

    <!-- ARENAS — quem escolhe pelo LUGAR, e nao pelo horario.

         A lista abaixo e de quadras, que e como se procura horario. Esta faixa
         responde a outra pergunta ("onde eu jogo?") e leva ao perfil, com a
         logo, a descricao e todas as quadras daquele lugar. Some quando nao ha
         arena para mostrar: faixa vazia com titulo e pior que faixa nenhuma. -->
    ${arenas.length ? `
    <section class="desktop-arena-rail-wrap">
      <div class="desktop-arena-rail-head">
        <h2>Arenas perto de você</h2>
        <small>${arenas.length} ${arenas.length === 1 ? 'arena' : 'arenas'}</small>
      </div>
      <div class="desktop-arena-rail">
        ${arenas.map((arena) => `
          <a class="arena-chip" href="#arena/${encodeURIComponent(arena.id)}">
            <span class="arena-chip__logo${arena.logo ? ' tem-imagem' : ''}">
              ${arena.logo
                ? `<img src="${escapeHtml(arena.logo)}" alt="" loading="lazy">`
                : escapeHtml(venueInitials(arena.nome))}
            </span>
            <strong>${escapeHtml(arena.nome)}</strong>
            <small>${escapeHtml(arena.bairro || arena.cidade || '')}</small>
          </a>`).join('')}
      </div>
    </section>` : ''}

    <div class="res-bar">
      <div class="res-count"><b>${venues.length}</b> resultados${term ? ` para "${escapeHtml(term)}"` : sport ? ` para ${escapeHtml(sport)}` : ''} - ordenado por distância</div>
      <div class="view-seg">
        <button class="view-btn on" type="button" data-player-view="list">${icon('list', 'ic sm')}Lista</button>
        <button class="view-btn" type="button" data-player-view="map">${icon('map-pinned', 'ic sm')}Mapa</button>
      </div>
    </div>

    <div data-player-pane="map" class="map-pane hidden">
      <div class="pq-map" data-player-map style="height:540px"></div>
    </div>

    <div class="grid" data-player-pane="list">
      ${venues.length ? venues.map((venue) => venueCard(venue)).join('') : `
        <div class="empty">
          <div class="empty-ic">${icon('search-x', 'ic lg')}</div>
          <h3>Nenhuma quadra nesse filtro</h3>
          <p>Tente aumentar a distância ou trocar o esporte.</p>
          <a href="#quadras" class="btn btn-outline">Limpar filtros</a>
        </div>`}
    </div>`;

  root.dataset.mapVenues = JSON.stringify(venues);
}

/* Alfinete das quadras. Sem `icon` o Leaflet cai no marcador embutido dele,
   que e azul — o unico azul da tela, brigando com a marca em todo lugar.
   SVG inline em vez de PNG: escala sem borrar e a cor sai do mesmo verde
   do resto. */
const PIN_QUADRA = `
  <svg width="28" height="38" viewBox="0 0 28 38" xmlns="http://www.w3.org/2000/svg">
    <path d="M14 0C6.27 0 0 6.27 0 14c0 9.8 12.36 22.94 12.89 23.5a1.53 1.53 0 0 0 2.22 0C15.64 36.94 28 23.8 28 14 28 6.27 21.73 0 14 0Z" fill="#0c8b52"/>
    <path d="M14 1.6C7.15 1.6 1.6 7.15 1.6 14c0 8.7 11.1 20.9 12.4 22.3 1.3-1.4 12.4-13.6 12.4-22.3 0-6.85-5.55-12.4-12.4-12.4Z" fill="#16a765"/>
    <circle cx="14" cy="13.6" r="5.2" fill="#fff"/>
  </svg>`;

function iconeQuadra() {
  return window.L.divIcon({
    className: 'mapa-pin-quadra',
    html: PIN_QUADRA,
    iconSize: [28, 38],
    /* Ancora na ponta de baixo: o alfinete aponta o endereco, nao paira
       centrado sobre ele. */
    iconAnchor: [14, 38],
    popupAnchor: [0, -34]
  });
}

function initExploreMap(root) {
  const mapElement = root.querySelector('[data-player-map]');
  if (!mapElement || !window.L) return;
  desktopMap?.remove();
  const venues = JSON.parse(root.dataset.mapVenues || '[]');
  desktopMap = window.L.map(mapElement).setView(coordenadaAtual(), zoomParaRaio(raioKm()));
  /* Tiles do OpenStreetMap: a CARTO passou a pedir chave de API, e mapa preso
     a conta de terceiro apaga sozinho no dia em que a cota virar. Sem `{s}`
     (subdominios aposentados) e sem `{r}` (nao ha tile @2x). */
  window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap',
    maxZoom: 19
  }).addTo(desktopMap);
  const bounds = [coordenadaAtual()];
  venues.forEach((venue) => {
    const position = [venue.map.lat, venue.map.lng];
    window.L.marker(position, { icon: iconeQuadra() }).addTo(desktopMap).bindPopup(mapPopup(venue));
    bounds.push(position);
  });

  /* "Voce esta aqui". Antes o mapa CENTRAVA na posicao do usuario e a usava
     para enquadrar, mas nunca a desenhava — dava para ver as quadras e nao
     dava para saber de onde elas estavam perto. Circulo em vez de alfinete,
     para nao competir com os marcadores das quadras. */
  /* Um circulo de 7px verde some no meio de alfinetes azuis grandes: nao
     dava para saber que aquilo era voce. Agora sao tres camadas — halo,
     anel branco e nucleo — mais um rotulo fixo, para o ponto se declarar
     sem depender de clique. */
  const haloUsuario = window.L.circleMarker(coordenadaAtual(), {
    radius: 20,
    stroke: false,
    fillColor: '#16a765',
    fillOpacity: 0.18,
    interactive: false
  }).addTo(desktopMap);
  const marcadorUsuario = window.L.circleMarker(coordenadaAtual(), {
    radius: 10,
    color: '#ffffff',
    weight: 4,
    fillColor: '#0c8b52',
    fillOpacity: 1
  }).addTo(desktopMap);
  marcadorUsuario.bindTooltip('Você está aqui', {
    permanent: true,
    direction: 'top',
    offset: [0, -12],
    className: 'mapa-voce'
  });

  if (bounds.length > 1) desktopMap.fitBounds(bounds, { padding: [34, 34], maxZoom: 14 });
  setTimeout(() => desktopMap?.invalidateSize(), 50);

  /* Posicao real quando o usuario permitir. Recusa, falta de sinal ou http
     sem TLS nao podem quebrar o mapa: fica no ponto padrao de Goiania.
     Quando GEOLOCATION_READY (services/geo.js) for ligado para o app nativo,
     esta chamada deve passar a ir por la, que tem o plugin do Capacitor. */
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!desktopMap) return;
        const aqui = [pos.coords.latitude, pos.coords.longitude];
        marcadorUsuario.setLatLng(aqui);
        haloUsuario.setLatLng(aqui);
        desktopMap.panTo(aqui);
      },
      () => {},
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  }
}

async function renderVenue(root, route) {
  const venue = await venueService.get(route.params.id);
  if (!venue) {
    location.hash = 'quadras';
    return;
  }
  /* Com a data: sem ela, a primeira pintura usava a agenda de "hoje" mesmo
     quando a tela abria em outro dia. */
  const [availability, favoriteIds] = await Promise.all([
    venueService.availability(venue.id, localDateValue()),
    venueService.favoriteIds()
  ]);
  const gallery = Array.isArray(venue.gallery) && venue.gallery.length ? venue.gallery : [venue.image];
  const amenities = [...new Set([...venue.tags, 'Bola inclusa', 'Wi-Fi no local'])];
  const today = localDateValue();
  const pageTitle = document.querySelector('[data-page-title]');
  const pageSub = document.querySelector('[data-page-sub]');
  if (pageTitle) pageTitle.textContent = venue.name;
  if (pageSub) pageSub.textContent = `${displayText(venue.sport)} - ${displayText(venue.neighborhood)}`;
  document.title = `${venue.name} - Qadras`;

  root.innerHTML = `
    <a href="#quadras" class="back-link">${icon('arrow-left', 'ic sm')}Voltar para explorar</a>

    <section class="desktop-booking-hero">
      <div class="desktop-venue-gallery__grid">
        <img class="desktop-venue-gallery__main" data-player-gallery-hero src="${escapeHtml(gallery[0])}" alt="${escapeHtml(venue.name)}" decoding="async" fetchpriority="high">
        <div class="desktop-venue-gallery__side">
          ${gallery.slice(1, 3).map((photo, index) => `
            <button type="button" data-player-gallery-image="${escapeHtml(photo)}" aria-label="Abrir foto ${index + 2}">
              <img src="${escapeHtml(photo)}" alt="" loading="lazy" decoding="async">
            </button>`).join('')}
        </div>
      </div>
      <div class="desktop-booking-hero__badges">
        <span>${icon('images', 'ic sm')}${gallery.length} fotos</span>
        <span>${icon('navigation', 'ic sm')}${venue.distance.toLocaleString('pt-BR')} km</span>
      </div>
      <button type="button" class="fav-heart ${favoriteIds.includes(venue.id) ? 'on' : ''}" data-player-favorite="${venue.arenaId}" aria-label="Salvar nos favoritos">
        ${icon('heart', 'ic fill')}
      </button>
    </section>

    <section class="desktop-arena-identity">
      <span class="desktop-arena-logo${venue.arenaLogo ? ' tem-imagem' : ''}" aria-hidden="true">${
        venue.arenaLogo
          ? `<img src="${escapeHtml(venue.arenaLogo)}" alt="">`
          : escapeHtml(venueInitials(venue.arenaName || venue.name))
      }</span>
      <div class="desktop-arena-identity__copy">
        <!-- Selo "Arena verificada" removido: nao ha verificacao nenhuma
             por tras dele. -->
        <h1>${escapeHtml(venue.arenaName || venue.name)}</h1>
        <p>${icon('map-pin', 'ic sm')}${escapeHtml(displayText(venue.sport))} - ${escapeHtml(displayText(venue.neighborhood))}</p>
      </div>
      <div class="desktop-arena-facts">
        <span>${icon('star', 'ic sm')}<b>${venue.rating}</b><small>${venue.reviews} avaliações</small></span>
        <span>${icon('circle-dollar-sign', 'ic sm')}<b>${money(venue.price)}</b><small>por hora</small></span>
      </div>
      <!-- Este bloco ja mostrava a arena e parecia clicavel sem ser. Agora
           leva a vitrine, que e onde estao as outras quadras do mesmo lugar. -->
      <a class="desktop-arena-link" href="#arena/${escapeHtml(String(venue.arenaId))}">
        ${icon('store', 'ic sm')}Ver perfil da arena${icon('chevron-right', 'ic sm')}
      </a>
    </section>

    <section class="venue-information venue-information--overview">
      <div>
        <span>Sobre a arena</span>
        <h2>Estrutura para a sua partida</h2>
        <p>Quadra de ${escapeHtml(displayText(venue.sport).toLowerCase())} no ${escapeHtml(displayText(venue.neighborhood))}, com estrutura completa para jogos, treinos e campeonatos.</p>
      </div>
      <div class="amenities">
        ${amenities.map((item) => `<div class="amenity"><span>${icon(amenityIcon(item), 'ic sm')}</span>${escapeHtml(displayText(item))}</div>`).join('')}
      </div>
    </section>

    <section class="desktop-request-progress" aria-label="Etapa 1 de 4: escolha do horário">
      <div><span>Etapa 1 de 4</span><strong>Escolha quando jogar</strong></div>
      <div class="desktop-request-progress__track" aria-hidden="true"><span></span></div>
      <p>Depois você revisa o pagamento e a arena confirma a solicitação.</p>
    </section>

    <div class="desktop-booking-layout" data-player-booking
         data-venue-id="${venue.id}" data-price="${venue.price}"
         data-date="${today}" data-calendar-month="${calendarMonthValue(parseLocalDate(today))}" data-duration="1"
         data-hour="" data-booking-stage="date">
      <main class="desktop-booking-main">
        <section class="booking-selector">
          <header class="booking-selector__head">
            <div>
              <span>Agendamento</span>
              <h1>Uma escolha por vez</h1>
              <p>Defina o dia, a duração e, por último, o melhor horário.</p>
            </div>
          </header>

          <nav class="booking-wizard-nav" aria-label="Passos para escolher o horário">
            <button type="button" class="is-active" data-booking-stage-go="date" aria-current="step"><span>1</span><strong>Dia</strong></button>
            <button type="button" data-booking-stage-go="duration"><span>2</span><strong>Duração</strong></button>
            <button type="button" data-booking-stage-go="time"><span>3</span><strong>Horário</strong></button>
          </nav>

          <div class="desktop-booking-step is-active" data-booking-stage-panel="date">
            <div class="desktop-booking-step__head">
              <span>1</span>
              <div><small>Primeiro</small><h2>Em qual dia você quer jogar?</h2></div>
            </div>
            <div class="booking-calendar desktop-booking-calendar" data-player-booking-calendar>
              <div class="booking-calendar__head">
                <button type="button" class="calendar-nav" data-player-calendar-nav="-1" aria-label="Mês anterior">${icon('chevron-left')}</button>
                <strong data-player-calendar-label></strong>
                <button type="button" class="calendar-nav" data-player-calendar-nav="1" aria-label="Próximo mês">${icon('chevron-right')}</button>
              </div>
              <div class="booking-calendar__weekdays" aria-hidden="true">
                <span>Dom</span><span>Seg</span><span>Ter</span><span>Qua</span><span>Qui</span><span>Sex</span><span>Sáb</span>
              </div>
              <div class="booking-calendar__grid" data-player-calendar-grid></div>
            </div>
            <footer class="booking-wizard-actions">
              <p>Você pode reservar com até 60 dias de antecedência.</p>
              <button type="button" class="btn btn-primary" data-booking-stage-go="duration">Escolher duração${icon('arrow-right', 'ic sm')}</button>
            </footer>
          </div>

          <div class="desktop-booking-step" data-booking-stage-panel="duration" hidden>
            <div class="desktop-booking-step__head">
              <span>2</span>
              <div><small>Agora</small><h2>Quanto tempo de quadra?</h2></div>
            </div>
            <div class="dur-seg desktop-duration" data-player-durations>
              <button type="button" class="dur on" data-player-duration="1"><strong>1 hora</strong><span>Jogo rápido</span></button>
              <button type="button" class="dur" data-player-duration="2"><strong>2 horas</strong><span>Partida completa</span></button>
              <button type="button" class="dur" data-player-duration="3"><strong>3 horas</strong><span>Turma ou evento</span></button>
            </div>
            <p class="desktop-duration-help" data-player-duration-help>Mostraremos apenas os horários que comportam sua partida.</p>
            <footer class="booking-wizard-actions">
              <button type="button" class="btn btn-soft" data-booking-stage-go="date">${icon('arrow-left', 'ic sm')}Voltar</button>
              <button type="button" class="btn btn-primary" data-booking-stage-go="time">Ver horários${icon('arrow-right', 'ic sm')}</button>
            </footer>
          </div>

          <div class="desktop-booking-step" data-booking-stage-panel="time" hidden>
            <div class="desktop-booking-step__head">
              <span>3</span>
              <div><small>Por último</small><h2>Qual horário funciona melhor?</h2></div>
              <em data-player-availability-copy></em>
            </div>
            <div class="legend">
              <span><i class="dot free"></i> Disponível</span>
              <span><i class="dot busy"></i> Não comporta a duração</span>
            </div>
            <div class="avail" data-player-slots></div>
            <footer class="booking-wizard-actions booking-wizard-actions--time">
              <button type="button" class="btn btn-soft" data-booking-stage-go="duration">${icon('arrow-left', 'ic sm')}Voltar</button>
              <p>Escolha um horário para liberar a revisão da reserva.</p>
            </footer>
          </div>
        </section>

        <section class="desktop-venue-reviews">
          <div>
            <span>Experiências reais</span>
            <h2>Avaliações da arena</h2>
            <p>A nota é publicada apenas depois que o jogador conclui uma reserva.</p>
          </div>
          <div class="desktop-review-score">
            <strong>${venue.rating}</strong>
            <span>${ratingStars(venue.rating)}</span>
            <small>${venue.reviews} avaliações verificadas</small>
          </div>
          <div class="desktop-review-trust">${icon('badge-check', 'ic sm')}Opiniões de jogadores que estiveram nesta arena.</div>
          <div class="desktop-review-list">
            ${(venue.reviewItems || []).map((review) => `
              <article class="desktop-review-item">
                <header>
                  <span class="desktop-review-avatar">${escapeHtml(review.author.slice(0, 1))}</span>
                  <div><strong>${escapeHtml(review.author)}</strong><small>${escapeHtml(review.date)}</small></div>
                  <span class="desktop-review-stars" aria-label="${review.rating} de 5 estrelas">${ratingStars(review.rating)}</span>
                </header>
                <p>${escapeHtml(review.text)}</p>
              </article>`).join('')}
          </div>
        </section>
      </main>

      <aside class="desktop-booking-aside">
        <div class="booking-card">
          <span class="booking-card__eyebrow">Resumo da reserva</span>
          <h2>Sua partida</h2>
          <div class="bc-fields">
            <div class="bc-field"><span class="k">${icon('calendar-days', 'ic sm')}Data</span><span class="v" data-player-booking-date>${dateLabel(today)}</span></div>
            <div class="bc-field"><span class="k">${icon('clock-3', 'ic sm')}Horário</span><span class="v" data-player-booking-range>Escolha um horário</span></div>
          </div>
          <div class="bc-summary">
            <div class="line"><span class="muted">Aluguel da quadra <span data-player-booking-hours></span></span><span data-player-booking-sub>-</span></div>
            <div class="line"><span class="muted">Taxa de serviço (${Math.round(SERVICE_FEE_RATE * 100)}%)</span><span data-player-booking-fee>-</span></div>
            <div class="line total"><span>Total</span><span data-player-booking-total>-</span></div>
            <small>Pagamento, suporte e proteção da reserva.</small>
          </div>
          <a class="btn btn-primary btn-lg btn-block is-disabled" data-player-booking-cta>
            <span data-player-booking-label>Escolha um horário</span>${icon('arrow-right', 'ic sm')}
          </a>
          <div class="booking-chat-lock">
            ${icon('lock-keyhole')}
            <span><strong>Chat após o pagamento</strong><small>O contato com a arena é liberado quando a reserva for confirmada.</small></span>
          </div>
          <div class="bc-note">${icon('shield-check', 'ic sm')}<span><strong>Reserva protegida</strong><small>Você revisa todos os dados antes de enviar a solicitação.</small></span></div>
        </div>
      </aside>
    </div>`;
  root.querySelector('[data-player-booking]').dataset.availability = JSON.stringify(availability);
  renderDesktopBookingCalendar(root);
  renderBooking(root);
  setDesktopBookingStage(root, 'date');
}

function isPastSlot(hour, dateValue) {
  const date = dateValue || localDateValue();
  if (date !== localDateValue()) return false;
  const slotTotal = Number(String(hour).slice(0, 2)) * 60;
  const now = new Date();
  const nowTotal = now.getHours() * 60 + now.getMinutes();
  return slotTotal <= nowTotal;
}

function renderBooking(root) {
  const booking = root.querySelector('[data-player-booking]');
  if (!booking) return;
  const availability = JSON.parse(booking.dataset.availability || '[]');
  let selectedHour = booking.dataset.hour || '';
  const duration = Math.max(1, Math.min(3, Number(booking.dataset.duration || 1)));
  booking.dataset.duration = String(duration);

  const isFreeAt = (hour) => availability.some((slot) => (
    Number(slot.hour.slice(0, 2)) === hour && slot.status === 'free'
  ));
  const canStartAt = (hour) => {
    for (let index = 0; index < duration; index += 1) {
      if (!isFreeAt(hour + index)) return false;
    }
    return true;
  };
  const isPast = (hour) => isPastSlot(hour, booking.dataset.date);

  if (selectedHour && (!canStartAt(Number(selectedHour.slice(0, 2))) || isPast(selectedHour))) {
    selectedHour = '';
    booking.dataset.hour = selectedHour;
  }

  const start = selectedHour ? Number(selectedHour.slice(0, 2)) : -1;

  const groups = [
    ['Manhã', availability.filter((slot) => Number(slot.hour.slice(0, 2)) < 12)],
    ['Tarde', availability.filter((slot) => Number(slot.hour.slice(0, 2)) >= 12 && Number(slot.hour.slice(0, 2)) < 18)],
    ['Noite', availability.filter((slot) => Number(slot.hour.slice(0, 2)) >= 18)]
  ];
  root.querySelector('[data-player-slots]').innerHTML = groups.map(([label, slots]) => `
    <div class="avail-group">
      <div class="avail-lbl">${label}</div>
      <div class="avail-slots">${slots.map((slot) => {
        const hour = Number(slot.hour.slice(0, 2));
        const selected = Boolean(selectedHour) && hour === start;
        const ocupado = slot.status !== 'free';
        const passou = isPast(slot.hour);
        const cabe = canStartAt(hour);
        const availableStart = cabe && !passou;
        /* Dois estados, como no mobile: ou o horario serve de INICIO, ou nao
           serve. O motivo vai no title. Ver o comentario longo em mobile.js. */
        const reason = passou
          ? 'Horário já passou'
          : ocupado ? 'Reservado'
          : `Não cabem ${duration}h seguidas a partir daqui`;
        return `<button type="button" class="slot ${availableStart ? 'free' : 'busy'} ${selected ? 'sel' : ''}" data-player-slot="${slot.hour}" aria-pressed="${Boolean(selectedHour && hour === start)}" ${availableStart ? '' : `disabled title="${reason}"`}>${slot.hour}</button>`;
      }).join('')}</div>
    </div>`).join('');

  root.querySelectorAll('[data-player-duration]').forEach((button) => {
    const value = Number(button.dataset.playerDuration);
    button.disabled = false;
    button.classList.remove('off');
    button.classList.toggle('on', value === duration);
    button.setAttribute('aria-pressed', String(value === duration));
  });

  const { subtotal, serviceFee, total } = calculateCheckoutAmounts(booking.dataset.price, duration);
  const freeCount = availability.filter((slot) => canStartAt(Number(slot.hour.slice(0, 2))) && !isPast(slot.hour)).length;
  root.querySelector('[data-player-availability-copy]').textContent = freeCount === 1
    ? '1 início livre'
    : `${freeCount} inícios livres`;
  root.querySelector('[data-player-duration-help]').textContent = duration === 1
    ? 'Ideal para um treino rápido. Escolha abaixo o melhor início.'
    : `Os horários abaixo já garantem ${duration} horas consecutivas de quadra.`;
  root.querySelector('[data-player-booking-date]').textContent = dateLabel(booking.dataset.date);
  root.querySelector('[data-player-booking-range]').textContent = selectedHour ? `${selectedHour} - ${addHours(selectedHour, duration)}` : 'Escolha um horário';
  root.querySelector('[data-player-booking-hours]').textContent = selectedHour ? `(${duration}h)` : '';
  root.querySelector('[data-player-booking-sub]').textContent = selectedHour ? money(subtotal) : '-';
  root.querySelector('[data-player-booking-fee]').textContent = selectedHour ? money(serviceFee) : '-';
  root.querySelector('[data-player-booking-total]').textContent = selectedHour ? money(total) : '-';
  const cta = root.querySelector('[data-player-booking-cta]');
  cta.classList.toggle('is-disabled', !selectedHour);
  cta.querySelector('[data-player-booking-label]').textContent = selectedHour ? `Continuar - ${money(total)}` : 'Escolha um horário';
  if (selectedHour) {
    const query = new URLSearchParams({
      date: booking.dataset.date,
      hora: selectedHour,
      dur: String(duration)
    });
    cta.href = `#pagamento/${booking.dataset.venueId}?${query}`;
  } else {
    cta.removeAttribute('href');
  }
}

async function bookingContext(route) {
  const venue = await venueService.get(route.params.id);
  if (!venue) return null;
  const query = routeQuery(route);
  const date = query.get('date') || localDateValue();
  const hour = query.get('hora') || '19:00';
  const duration = Math.max(1, Math.min(3, Number(query.get('dur') || 1)));
  const amounts = calculateCheckoutAmounts(venue.price, duration);
  let quoteAmounts = null;
  if (API_BASE_URL) {
    try {
      quoteAmounts = await venueService.quote({
        quadraId: venue.id,
        data: date,
        hora: hour,
        dur: duration,
        plano: 'avulso'
      });
    } catch (error) {
      quoteAmounts = null;
    }
  }
  return {
    venue,
    date,
    dateText: dateLabel(date),
    hour,
    duration,
    endHour: addHours(hour, duration),
    ...(quoteAmounts || amounts),
    method: PAYMENT_METHOD_LABELS[query.get('metodo')] ? query.get('metodo') : 'pix'
  };
}

function syncDesktopPaymentChoice(root, requestedMethod = 'pix') {
  const methods = [...root.querySelectorAll('[data-player-payment-method]')];
  const selected = methods.find((method) => method.dataset.playerPaymentMethod === requestedMethod && !method.disabled)
    || methods.find((method) => !method.disabled);
  if (!selected) return;

  methods.forEach((method) => {
    const active = method === selected;
    method.classList.toggle('on', active);
    method.setAttribute('aria-pressed', String(active));
  });

  const cta = root.querySelector('[data-player-payment-cta]');
  const params = new URLSearchParams(cta.dataset.paymentQuery || '');
  params.set('metodo', selected.dataset.playerPaymentMethod);
  cta.href = `${cta.dataset.paymentRoute}?${params}`;
  cta.setAttribute('aria-label', `Enviar solicitação usando ${PAYMENT_METHOD_LABELS[selected.dataset.playerPaymentMethod]}`);
}

/* PERFIL DA ARENA no desktop — a mesma vitrine da versao mobile.

   O funil achar -> olhar -> reservar ja e liberado na web, e a arena e um
   degrau dele: e aqui que se compara "esta arena" com "aquela" antes de olhar
   horario. Deixar a tela so no app faria o link existir na web e cair na home.

   Como no mobile: nada de telefone, e-mail ou rua. O backend nao envia esses
   campos, entao nao ha o que a tela esqueca de esconder. */
async function renderArena(root, route) {
  const arena = await venueService.arena(route.params.id);
  if (!arena) {
    location.hash = 'quadras';
    return;
  }
  const favoriteIds = await venueService.favoriteIds();

  /* O CABECALHO DA ROTA FICA VAZIO NESTA TELA.

     Ele escrevia o nome da arena e o bairro no topo da pagina, e a propria
     tela abre com os dois em corpo grande poucos pixels abaixo — o nome
     aparecia duas vezes seguidas. Aqui o cabecalho some e a identidade fica
     so onde ela tem tamanho para ser lida. O <title> da aba continua com o
     nome, que e onde ele serve. */
  const pageTitle = document.querySelector('[data-page-title]');
  const pageSub = document.querySelector('[data-page-sub]');
  if (pageTitle) pageTitle.textContent = '';
  if (pageSub) pageSub.textContent = '';
  document.title = `${arena.nome} - Qadras`;

  const fotos = (arena.fotos || []).filter(Boolean);
  const favorita = arena.quadras.some((q) => favoriteIds.includes(q.id));

  root.innerHTML = `
    <a href="#quadras" class="back-link">${icon('arrow-left', 'ic sm')}Voltar para explorar</a>

    <!-- Topo: a LOGO e o NOME logo abaixo. A galeria de fotos saiu daqui —
         a arena nao tem album proprio (as fotos sao das quadras e se repetem
         nos cards abaixo) e bastava uma nao carregar para o perfil abrir com
         um retangulo vazio ocupando a tela. -->
    <section class="desktop-arena-identity desktop-arena-identity--perfil">
      <span class="desktop-arena-logo${arena.logo ? ' tem-imagem' : ''}" aria-hidden="true">${
        arena.logo
          ? `<img src="${escapeHtml(arena.logo)}" alt="">`
          : escapeHtml(venueInitials(arena.nome))
      }</span>
      <div class="desktop-arena-identity__copy">
        <h1>${escapeHtml(arena.nome)}</h1>
        <p>${icon('map-pin', 'ic sm')}${escapeHtml([arena.bairro, arena.cidade].filter(Boolean).join(' · '))}</p>
        <!-- O selo "Arena verificada" saiu: nao ha campo de verificacao no
             banco nem processo por tras dele. Era um sinal de confianca
             afirmando algo que o produto nao faz, bem onde a pessoa decide
             gastar dinheiro. Volta quando houver criterio de verdade. -->
      </div>
      <button type="button" class="fav-heart ${favorita ? 'on' : ''}" data-player-favorite="${arena.id}" aria-label="Salvar nos favoritos">
        ${icon('heart', 'ic fill')}
      </button>
    </section>

    <!-- Os numeros que decidem a escolha, em corpo grande e em cartao. Antes
         eram tres rotulos de 11px numa faixa fina. -->
    <div class="arena-numeros arena-numeros--tres">
      <div>
        <b>${arena.rating || '—'}</b>
        <span class="arena-numeros__estrelas">${'★'.repeat(Math.round(arena.rating || 0))}${'☆'.repeat(Math.max(0, 5 - Math.round(arena.rating || 0)))}</span>
        <small>${arena.reviews ? arena.reviews + ' avaliações' : 'sem avaliações'}</small>
      </div>
      <div><b>${arena.totalQuadras}</b><small>quadras</small></div>
      <div><b>${arena.precoMin != null ? money(arena.precoMin) : '—'}</b><small>a partir de, por hora</small></div>
    </div>

    ${String(arena.descricao || '').trim() ? `
    <section class="arena-bloco">
      <h2>Sobre a arena</h2>
      <p class="arena-sobre">${escapeHtml(arena.descricao)}</p>
    </section>` : ''}

    ${(arena.comodidades || []).length ? `
    <section class="arena-bloco">
      <h2>O que a arena tem</h2>
      <!-- Mesmo desenho de comodidade da ficha da quadra (.amenity): a lista
           e a mesma coisa, e um segundo estilo so para esta tela seria dois
           jeitos de mostrar o mesmo dado. -->
      <div class="arena-comodidades">
        ${arena.comodidades.map((item) => `
          <span class="arena-comodidade">${icon(amenityIcon(item), 'ic sm')}${escapeHtml(displayText(item))}</span>`).join('')}
      </div>
    </section>` : ''}

    <section class="arena-bloco">
      <h2>Quadras disponíveis <small>${arena.totalQuadras === 1 ? '1 quadra' : arena.totalQuadras + ' quadras'}</small></h2>
      ${arena.quadras.length
        ? `<div class="arena-bloco__quadras">${arena.quadras.map((q) => venueCard(q, false, { dentroDaArena: true })).join('')}</div>`
        : `<p class="arena-sobre">Esta arena não tem quadras abertas para reserva no momento.</p>`}
    </section>

    ${(arena.avaliacoes || []).length ? `
    <section class="arena-bloco">
      <h2>Avaliações</h2>
      <!-- Resumo antes da lista: a nota media e o que a pessoa procura, e os
           comentarios sao a explicacao dela. -->
      <div class="arena-nota">
        <div class="arena-nota__valor">
          <b>${arena.rating || '—'}</b>
          <span>${'★'.repeat(Math.round(arena.rating || 0))}${'☆'.repeat(Math.max(0, 5 - Math.round(arena.rating || 0)))}</span>
        </div>
        <p>${arena.reviews === 1 ? '1 avaliação' : arena.reviews + ' avaliações'}</p>
      </div>
      <!-- Empilhadas, e da maior nota para a menor.

           Em grade de quatro colunas cada avaliacao virava um retangulo de
           duas linhas e a leitura pulava de coluna em coluna. E a ordem por
           data punha a mais recente primeiro, que pode ser a pior — quem abre
           as avaliacoes quer saber se o lugar vale a pena, e quem desconfia
           inverte num clique. -->
      <div class="arena-ordem" role="group" aria-label="Ordenar avaliações">
        <button type="button" data-arena-ordem="nota" class="on">Maiores notas</button>
        <button type="button" data-arena-ordem="data">Mais recentes</button>
      </div>
      <div class="arena-review-list arena-review-list--empilhada" data-arena-review-list>
        ${arena.avaliacoes.slice().sort((a, b) => (b.rating || 0) - (a.rating || 0)).map((review) => `
          <article class="arena-review">
            <header>
              <span class="arena-review__avatar" aria-hidden="true">${escapeHtml(String(review.author || '?').slice(0, 1))}</span>
              <div>
                <strong>${escapeHtml(review.author)}</strong>
                <small>${escapeHtml(review.date)}</small>
              </div>
              <span class="arena-review__estrelas">${'★'.repeat(review.rating)}${'☆'.repeat(Math.max(0, 5 - review.rating))}</span>
            </header>
            <p>${escapeHtml(review.text)}</p>
          </article>`).join('')}
      </div>
    </section>` : ''}
  `;

  /* A ORDEM E DO CLIENTE: sao algumas dezenas de avaliacoes ja em memoria, e
     trocar sem ir na rede faz o clique responder na hora. `slice()` antes de
     ordenar porque `sort` mexe no proprio array — sem isso "mais recentes"
     nunca voltaria a ser a ordem original. */
  const listaReviews = root.querySelector('[data-arena-review-list]');
  if (listaReviews) {
    const cartaoReview = (review) => `
      <article class="arena-review">
        <header>
          <span class="arena-review__avatar" aria-hidden="true">${escapeHtml(String(review.author || '?').slice(0, 1))}</span>
          <div>
            <strong>${escapeHtml(review.author)}</strong>
            <small>${escapeHtml(review.date)}</small>
          </div>
          <span class="arena-review__estrelas">${'★'.repeat(review.rating)}${'☆'.repeat(Math.max(0, 5 - review.rating))}</span>
        </header>
        <p>${escapeHtml(review.text)}</p>
      </article>`;
    root.querySelectorAll('[data-arena-ordem]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const porNota = btn.dataset.arenaOrdem === 'nota';
        const itens = porNota
          ? arena.avaliacoes.slice().sort((a, b) => (b.rating || 0) - (a.rating || 0))
          : arena.avaliacoes.slice();
        listaReviews.innerHTML = itens.map(cartaoReview).join('');
        root.querySelectorAll('[data-arena-ordem]').forEach((o) => o.classList.toggle('on', o === btn));
      });
    });
  }

  /* FOTO MORTA NAO VIRA BURACO NA VITRINE.

     A galeria da arena junta as fotos de todas as quadras, entao basta um link
     que expirou para a imagem principal do perfil ser um vazio com o texto
     alternativo atravessado. `capture: true` porque o `error` de <img> nao
     borbulha. */
  root.addEventListener('error', (evento) => {
    const img = evento.target;
    if (img?.tagName !== 'IMG') return;
    img.classList.add('sem-foto');
    /* Pixel transparente em vez de tirar o src: sem src o navegador desenha o
       icone de imagem partida no canto, e tirar o elemento do DOM colapsaria a
       celula da galeria. Com o pixel a moldura mantem o tamanho e quem pinta e
       o fundo da classe. */
    img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    img.alt = '';
    img.closest('button')?.classList.add('sem-foto');
  }, { capture: true });

  window.pqRefreshIcons?.(root);
}

async function renderPayment(root, route) {
  const [context, profile, wallet] = await Promise.all([
    bookingContext(route),
    venueService.profile(),
    venueService.wallet()
  ]);
  if (!context) {
    location.hash = 'quadras';
    return;
  }
  const {
    venue,
    date,
    dateText,
    hour,
    duration,
    endHour,
    subtotal,
    serviceFee,
    total,
    method
  } = context;
  const pageSub = document.querySelector('[data-page-sub]');
  if (pageSub) pageSub.textContent = `${venue.name} - ${dateText} - ${hour}`;
  const confirmation = new URLSearchParams({
    date,
    hora: hour,
    dur: String(duration),
    deadline: String(Date.now() + APPROVAL_WINDOW_MS)
  });
  const requestedResult = routeQuery(route).get('resultado');
  if (requestedResult) confirmation.set('resultado', requestedResult);
  const avatar = profile.photo
    ? `<img src="${escapeHtml(profile.photo)}" alt="Foto de ${escapeHtml(profile.name)}" decoding="async" loading="lazy" referrerpolicy="no-referrer">`
    : escapeHtml(profile.name.slice(0, 1));
  root.innerHTML = `
    <div class="desktop-checkout-page" data-player-payment-page>
      <a href="#quadra/${venue.id}" class="back-link">${icon('arrow-left', 'ic sm')}Voltar para a quadra</a>

      <ol class="desktop-reservation-flow desktop-reservation-flow--checkout" aria-label="Etapas da reserva">
        <li class="is-done"><span>${icon('check', 'ic sm')}</span><div><strong>Horário</strong><small>${escapeHtml(dateText)} - ${hour}</small></div></li>
        <li class="is-current"><span>2</span><div><strong>Pagamento</strong><small>Escolha como pagar</small></div></li>
        <li><span>3</span><div><strong>Aprovação</strong><small>A arena responde</small></div></li>
        <li><span>4</span><div><strong>Confirmação</strong><small>Horário garantido</small></div></li>
      </ol>

      <div class="desktop-checkout-layout">
        <main class="desktop-checkout-main">
          <section class="card desktop-checkout-recap">
            <div class="desktop-checkout-section-head">
              <div><span>Sua partida</span><h2>Revise a reserva</h2></div>
              <a href="#quadra/${venue.id}">${icon('pencil', 'ic sm')}Alterar horário</a>
            </div>
            <div class="desktop-checkout-venue">
              <img src="${escapeHtml(venue.image)}" alt="${escapeHtml(venue.name)}" decoding="async" loading="lazy">
              <div><h3>${escapeHtml(venue.name)}</h3><p>${escapeHtml(displayText(venue.sport))} - ${escapeHtml(displayText(venue.neighborhood))}</p></div>
              <div class="desktop-checkout-facts">
                <span>${icon('calendar-days', 'ic sm')}<b>${escapeHtml(dateText)}</b></span>
                <span>${icon('clock-3', 'ic sm')}<b>${hour} - ${endHour}</b></span>
                <span>${icon('timer', 'ic sm')}<b>${duration === 1 ? '1 hora' : `${duration} horas`}</b></span>
              </div>
            </div>
          </section>

          <section class="card desktop-payment-card">
            <div class="desktop-checkout-section-head">
              <div><span>Pagamento seguro</span><h2>Como você quer pagar?</h2></div>
              ${icon('shield-check')}
            </div>
            <div class="desktop-payment-methods">
              <button type="button" class="method on" data-player-payment-method="pix">
                <span class="badge-ic"><i class="ic-pix" aria-hidden="true"></i></span>
                <span><strong>Pix</strong><small>Validação imediata</small></span>
                <span class="ck">${icon('check')}</span>
              </button>
              <button type="button" class="method" data-player-payment-method="card" disabled>
                <span class="badge-ic">${icon('credit-card')}</span>
                <span><strong>Cartão de crédito</strong><small data-player-card-note>Em breve</small></span>
                <span class="ck">${icon('check')}</span>
              </button>
            </div>
          </section>

          <section class="desktop-approval-policy">
            <span>${icon('timer')}</span>
            <div><strong>A arena responde em até 15 minutos</strong><p>A forma de pagamento é validada agora. A cobrança só é concluída após o aceite.</p></div>
          </section>

          <section class="card desktop-player-check">
            <div class="desktop-player-check__avatar">${avatar}</div>
            <div><span>Jogador da reserva</span><strong>${escapeHtml(profile.name)}</strong><small>${escapeHtml(profile.email)} - ${escapeHtml(profile.phone)}</small></div>
            <span class="desktop-player-check__verified">${icon('badge-check', 'ic sm')}Dados verificados</span>
            <a class="icon-btn" href="#perfil" aria-label="Editar dados do perfil" title="Editar dados do perfil">${icon('pencil')}</a>
          </section>
        </main>

        <aside>
        <div class="order-card">
          <div class="order-card__head">
            <span>Resumo do pagamento</span>
            <h2>Total da reserva</h2>
          </div>
          <div class="line"><span class="muted">Aluguel (${duration}h)</span><span>${money(subtotal)}</span></div>
          <div class="line"><span class="muted">Taxa de serviço (${Math.round(SERVICE_FEE_RATE * 100)}%)</span><span>${money(serviceFee)}</span></div>
          <div class="line total"><span>Total</span><span>${money(total)}</span></div>
          <div class="order-card__fee-note">${icon('info', 'ic sm')}A taxa mantém o pagamento, o suporte e a proteção da reserva.</div>
          <a class="btn btn-primary btn-lg btn-block" data-player-payment-cta>
            <span>Enviar solicitação - ${money(total)}</span>${icon('arrow-right', 'ic sm')}
          </a>
          <div class="bc-note">${icon('shield-check', 'ic sm')}<span>Nenhuma cobrança será concluída se a arena não aceitar.</span></div>
        </div>
      </aside>
      </div>
    </div>`;

  const cta = root.querySelector('[data-player-payment-cta]');
  cta.dataset.paymentRoute = `#confirmado/${venue.id}`;
  cta.dataset.paymentQuery = confirmation.toString();
  // Cartao so vale com adquirente. syncDesktopPaymentChoice ja ignora botao
  // desabilitado, entao ?metodo=card cai no Pix em vez de gerar uma reserva
  // sem forma de cobranca.
  const botaoCartao = root.querySelector('[data-player-payment-method="card"]');
  if (botaoCartao) {
    const { liberado, salvos, motivo } = await estadoDoCartao();
    botaoCartao.disabled = !liberado;
    botaoCartao.title = liberado ? '' : motivo;
    const nota = botaoCartao.querySelector('[data-player-card-note]');
    if (nota) {
      nota.textContent = !liberado
        ? 'Em breve'
        : (salvos.length ? rotuloDoCartao(salvos[0]) : 'Cadastre um cartão');
    }
  }

  syncDesktopPaymentChoice(root, method === 'wallet' ? 'pix' : method);
}

async function renderConfirmation(root, route) {
  const context = await bookingContext(route);
  if (!context) {
    location.hash = 'quadras';
    return;
  }
  const {
    venue,
    date,
    dateText,
    hour,
    duration,
    endHour,
    method
  } = context;
  let subtotal = context.subtotal;
  let serviceFee = context.serviceFee;
  let total = context.total;
  let code = `PQ-${venue.id}${date.slice(5).replace('-', '')}${hour.replace(':', '')}`;
  const query = routeQuery(route);
  const requestedDeadline = Number(query.get('deadline'));
  const deadline = Number.isFinite(requestedDeadline) && requestedDeadline > 0
    ? requestedDeadline
    : Date.now() + APPROVAL_WINDOW_MS;
  const forcedResult = query.get('resultado') || 'aceito';
  let settled = false;
  let apiReserva = null;

  const reservationData = {
    code,
    venueId: venue.id,
    date: dateText,
    dateValue: date,
    hour,
    endHour,
    duration,
    subtotal,
    serviceFee,
    price: total,
    paymentMethod: method
  };

  function setApprovalMeta(title, subtitle) {
    const pageTitle = document.querySelector('[data-page-title]');
    const pageSub = document.querySelector('[data-page-sub]');
    if (pageTitle) pageTitle.textContent = title;
    if (pageSub) pageSub.textContent = subtitle;
    document.title = `${title} - Qadras`;
  }

  function approvalFlow(state) {
    const rejected = state === 'declined' || state === 'expired';
    const approvalClass = state === 'accepted' ? 'is-done' : rejected ? 'is-error' : 'is-current';
    const approvalMarker = state === 'accepted'
      ? icon('check', 'ic sm')
      : rejected
        ? icon('x', 'ic sm')
        : '3';
    return `
      <ol class="desktop-reservation-flow desktop-reservation-flow--confirmation" aria-label="Etapas da reserva">
        <li class="is-done"><span>${icon('check', 'ic sm')}</span><div><strong>Horário</strong><small>${escapeHtml(dateText)} - ${hour}</small></div></li>
        <li class="is-done"><span>${icon('check', 'ic sm')}</span><div><strong>Pagamento</strong><small>${PAYMENT_METHOD_LABELS[method]}</small></div></li>
        <li class="${approvalClass}"><span>${approvalMarker}</span><div><strong>Aprovação</strong><small>${state === 'accepted' ? 'Arena aceitou' : rejected ? 'Não aprovada' : 'Aguardando arena'}</small></div></li>
        <li class="${state === 'accepted' ? 'is-current' : ''}"><span>4</span><div><strong>Confirmação</strong><small>Horário garantido</small></div></li>
      </ol>`;
  }

  function refreshApprovalIcons() {
    window.pqRefreshIcons?.(root);
  }

  function renderPending(remaining) {
    const progress = Math.max(0, Math.min(100, (remaining / APPROVAL_WINDOW_MS) * 100));
    setApprovalMeta('Aguardando aprovação', `${venue.name} está analisando a solicitação`);
    root.innerHTML = `
      <div class="desktop-confirmation-page">
        ${approvalFlow('pending')}
        <section class="desktop-approval-view desktop-approval-view--pending">
          ${approvalWaitingVisual()}
          <span class="confirm__eyebrow">Solicitação enviada</span>
          <h1>Aguardando a arena</h1>
          <p><strong>${escapeHtml(venue.name)}</strong> tem até 15 minutos para aceitar o horário solicitado.</p>

          <div class="desktop-approval-timer">
            <div><span>Tempo restante</span><strong data-player-approval-countdown>${formatApprovalCountdown(remaining)}</strong></div>
            <div class="desktop-approval-progress"><span data-player-approval-progress style="width:${progress}%"></span></div>
          </div>

          <div class="desktop-approval-reservation">
            <img src="${escapeHtml(venue.image)}" alt="${escapeHtml(venue.name)}" decoding="async" loading="lazy">
            <div><span>Sua partida</span><strong>${escapeHtml(dateText)} · ${hour} a ${endHour}</strong><small>${duration}h · ${escapeHtml(displayText(venue.sport))}</small></div>
            <b>${money(total)}</b>
          </div>

          <div class="desktop-approval-note">
            ${icon('shield-check')}
            <span><strong>Pagamento protegido</strong><small>A cobrança só será concluída depois que a arena aceitar.</small></span>
          </div>
          <a href="#reservas" class="btn btn-outline btn-lg">Acompanhar em minhas reservas</a>
        </section>
      </div>`;
    refreshApprovalIcons();
  }

  async function renderAccepted() {
    if (settled) return;
    settled = true;
    clearInterval(activeDesktopApprovalTimer);
    await venueService.saveReservation({
      ...reservationData,
      status: 'Confirmada',
      statusClass: 'pago',
      group: 'proxima'
    });
    const conversation = await venueService.ensureConversationForVenue(venue);
    setApprovalMeta('Reserva confirmada', `Código ${code}`);
    root.innerHTML = `
      <div class="desktop-confirmation-page">
        ${approvalFlow('accepted')}
        <div class="confirm">
          <div class="ring">${icon('check')}</div>
          <span class="confirm__eyebrow">Arena aprovou sua solicitação</span>
          <h1>Tudo certo, está marcado!</h1>
          <p class="sub">Seu horário está garantido. Agora é só reunir a turma e jogar.</p>
          <div class="ticket">
            <div class="tk-top">
              <img src="${escapeHtml(venue.image)}" alt="${escapeHtml(venue.name)}" decoding="async" loading="lazy">
              <div><span>Partida confirmada</span><h3>${escapeHtml(venue.name)}</h3><div class="m">${escapeHtml(displayText(venue.sport))} - ${escapeHtml(displayText(venue.neighborhood))}</div></div>
            </div>
            <div class="tk-body">
              <div class="row"><span class="k">Data</span><span class="v">${escapeHtml(dateText)}</span></div>
              <div class="row"><span class="k">Horário</span><span class="v">${hour} - ${endHour} (${duration}h)</span></div>
              <div class="row"><span class="k">Endereço</span><span class="v">${escapeHtml(displayText(venue.neighborhood))}, Goiânia</span></div>
              <div class="row"><span class="k">Pagamento</span><span class="v">${PAYMENT_METHOD_LABELS[method]} - aprovado</span></div>
              <div class="row"><span class="k">Aluguel</span><span class="v">${money(subtotal)}</span></div>
              <div class="row"><span class="k">Taxa de serviço</span><span class="v">${money(serviceFee)}</span></div>
              <div class="row"><span class="k">Total pago</span><span class="v">${money(total)}</span></div>
            </div>
            <button class="desktop-booking-code" type="button" data-copy="${code}" data-copy-msg="Código da reserva copiado">
              <span><small>Código da reserva</small><strong>${code}</strong></span>${icon('copy')}
            </button>
          </div>
          <div class="confirm-actions">
            <a href="#reservas" class="btn btn-primary btn-lg">Ver minhas reservas</a>
            ${conversation ? `<a href="#mensagens/${conversation.id}" class="btn btn-soft btn-lg">${icon('message-circle', 'ic sm')}Falar com a arena</a>` : ''}
            <a href="#quadras" class="btn btn-outline btn-lg">Reservar outra quadra</a>
          </div>
        </div>
      </div>`;
    refreshApprovalIcons();
  }

  async function renderRejected(reason = 'declined') {
    if (settled) return;
    settled = true;
    clearInterval(activeDesktopApprovalTimer);
    await venueService.saveReservation({
      ...reservationData,
      status: reason === 'expired' ? 'Tempo expirado' : 'Não aceita pela arena',
      statusClass: 'cancelado',
      group: 'historico'
    });
    const expired = reason === 'expired';
    setApprovalMeta('Reserva não confirmada', expired ? 'O tempo de resposta terminou' : 'A arena não aceitou o horário');
    root.innerHTML = `
      <div class="desktop-confirmation-page">
        ${approvalFlow(expired ? 'expired' : 'declined')}
        <section class="desktop-approval-view desktop-approval-view--rejected">
          <div class="desktop-approval-symbol">${icon(expired ? 'clock-alert' : 'calendar-x-2')}</div>
          <span class="confirm__eyebrow">${expired ? 'Tempo de resposta encerrado' : 'Arena não aceitou'}</span>
          <h1>${expired ? 'A solicitação expirou' : 'O horário não foi confirmado'}</h1>
          <p>${expired
            ? 'A arena não respondeu dentro de 15 minutos.'
            : 'A arena não conseguiu atender esse horário.'} Nenhuma cobrança foi realizada.</p>
          <div class="desktop-approval-note">
            ${icon('badge-check')}
            <span><strong>Seu pagamento está seguro</strong><small>O valor foi liberado automaticamente para você.</small></span>
          </div>
          <div class="desktop-approval-actions">
            <a href="#quadra/${venue.id}" class="btn btn-primary btn-lg">Escolher outro horário</a>
            <a href="#quadras" class="btn btn-outline btn-lg">Procurar outra quadra</a>
          </div>
        </section>
      </div>`;
    refreshApprovalIcons();
  }

  if (API_BASE_URL) {
    try {
      const submit = await submitPlayerReservation(context);
      apiReserva = submit.reserva;
      if (apiReserva) {
        code = apiReserva.code || code;
        subtotal = Number.isFinite(apiReserva.subtotal) ? apiReserva.subtotal : subtotal;
        serviceFee = Number.isFinite(apiReserva.serviceFee) ? apiReserva.serviceFee : serviceFee;
        total = Number.isFinite(apiReserva.price) ? apiReserva.price : total;
        reservationData.id = apiReserva.id;
        reservationData.code = code;
        reservationData.subtotal = subtotal;
        reservationData.serviceFee = serviceFee;
        reservationData.price = total;
        await payPlayerReservation(apiReserva.id);
      }
    } catch (error) {
      apiReserva = null;
    }
  }

  await venueService.saveReservation({
    ...reservationData,
    status: 'Aguardando aprovação',
    statusClass: 'pendente',
    group: 'proxima'
  });
  renderPending(Math.max(0, deadline - Date.now()));

  if (API_BASE_URL && apiReserva) {
    watchReservation(apiReserva.id, {
      onDone: async (status) => {
        if (status === 'confirmed' || status === 'completed') {
          await renderAccepted();
        } else if (status === 'expired') {
          await renderRejected('expired');
        } else {
          await renderRejected('declined');
        }
      }
    });
  }

  async function tickApproval() {
    if (!document.contains(root)) {
      clearInterval(activeDesktopApprovalTimer);
      return;
    }
    const remaining = deadline - Date.now();
    const elapsed = APPROVAL_WINDOW_MS - remaining;
    const countdown = root.querySelector('[data-player-approval-countdown]');
    const progress = root.querySelector('[data-player-approval-progress]');
    if (countdown) countdown.textContent = formatApprovalCountdown(remaining);
    if (progress) progress.style.width = `${Math.max(0, Math.min(100, (remaining / APPROVAL_WINDOW_MS) * 100))}%`;

    // Na API o desfecho chega pelo polling de /events (ou WS depois); o
    // cronometro so cuida do limite de 15 minutos.
    if (API_BASE_URL) {
      if (!apiReserva) {
        await renderRejected('declined');
      } else if (remaining <= 0 || forcedResult === 'expirado') {
        await renderRejected('expired');
      }
      return;
    }

    if (remaining <= 0 || forcedResult === 'expirado') {
      await renderRejected('expired');
    } else if (forcedResult === 'recusado' && elapsed >= 2500) {
      await renderRejected('declined');
    } else if (forcedResult !== 'pendente' && forcedResult !== 'recusado' && elapsed >= MOCK_APPROVAL_DELAY_MS) {
      await renderAccepted();
    }
  }

  activeDesktopApprovalTimer = window.setInterval(tickApproval, 1000);
  await tickApproval();
}

async function renderReservations(root) {
  const [reservations, venues, conversations] = await Promise.all([
    venueService.reservations(),
    venueService.list(),
    venueService.conversations()
  ]);
  const cards = reservations.map((reservation) => {
    const venue = venues.find((item) => item.id === reservation.venueId);
    if (!venue) return '';
    const conversation = conversations.find((item) => String(item.venueId) === String(venue.id));
    return `
      <article class="ritem" data-status="${escapeHtml(reservation.group)}" ${reservation.group === 'proxima' ? '' : 'style="display:none"'}>
        <img src="${escapeHtml(venue.image)}" alt="${escapeHtml(venue.name)}" decoding="async" loading="lazy">
        <div class="info">
          <h3>${escapeHtml(venue.name)}</h3>
          <div class="meta">
            <span>${sportIcon(venue.sport)}${escapeHtml(venue.sport)}</span>
            <span>${icon('map-pin')}${escapeHtml(venue.neighborhood)}</span>
            <span>${icon('calendar-days')}${escapeHtml(reservation.date)}</span>
            <span>${icon('clock-3')}${reservation.hour}</span>
          </div>
          <span class="status ${escapeHtml(reservation.statusClass)}" style="margin-top:10px;">${escapeHtml(reservation.status)}</span>
        </div>
        <div class="col-r">
          <div class="amt">${money(reservation.price)}</div>
          <div class="acts">
            <a href="#quadra/${venue.id}" class="btn btn-soft">Detalhes</a>
            ${conversation ? `<a href="#mensagens/${conversation.id}" class="btn btn-outline">${icon('message-circle', 'ic sm')}Chat</a>` : ''}
            <a href="#quadra/${venue.id}" class="btn btn-outline">Reagendar</a>
          </div>
        </div>
      </article>`;
  }).join('');
  root.innerHTML = `
    <section class="desktop-reservations-view">
    <div class="tabs" data-seg data-target="#player-reservations">
      <a class="on" data-filter="proxima">Próximas</a>
      <a data-filter="historico">Histórico</a>
      <a data-filter="cancelada">Canceladas</a>
    </div>
    <div class="rlist" id="player-reservations">
      ${cards}
      <div data-empty hidden class="empty">
        <div class="empty-ic">${icon('calendar-x', 'ic lg')}</div>
        <h3>Nada por aqui ainda</h3>
        <p>Suas reservas nesta aba vao aparecer aqui.</p>
      </div>
    </div>
    </section>`;
}

async function renderFavorites(root) {
  const venues = await venueService.favorites();
  root.innerHTML = venues.length
    ? `<div class="grid">${venues.map((venue) => venueCard(venue, true)).join('')}</div>`
    : `<div class="empty">
        <div class="empty-ic"><svg class="ic lg"><use href="#i-heart"/></svg></div>
        <h3>Nenhum favorito ainda</h3>
        <p>Salve uma quadra para encontra-la rapidamente aqui.</p>
        <a href="#quadras" class="btn btn-primary">Explorar quadras</a>
      </div>`;
}

/* Estado real do cartao, direto de /api/carteira. Uma unica fonte para o
   checkout e para a tela de Pagamento — quando o adquirente entrar, so o
   backend muda. */
async function estadoDoCartao() {
  const carteira = await venueService.wallet().catch(() => null);
  const salvos = carteira?.cartoes || carteira?.cards || [];
  return {
    liberado: Boolean(carteira?.cartaoDisponivel),
    salvos,
    motivo: carteira?.cartaoMotivo || 'Por enquanto, só Pix.'
  };
}

function rotuloDoCartao(cartao) {
  const bandeira = cartao.bandeira || cartao.brand || 'Cartão';
  const fim = cartao.ultimos || cartao.last4 || '';
  return fim ? `${bandeira} final ${fim}` : bandeira;
}

/* Pagamento no desktop. Saldo, extrato e cupom sairam: guardar dinheiro de
   usuario e atividade de instituicao de pagamento.

   O "Visa final 4321" listado aqui era markup fixo — nao vinha de dado
   nenhum. Agora a lista mostra o que /api/carteira devolver, e o botao de
   adicionar so aparece quando ha onde guardar o cartao. */
async function renderWallet(root) {
  const { liberado, salvos, motivo } = await estadoDoCartao();

  const linhasCartao = salvos.map((cartao) => `
    <div class="payment-row"><span class="badge-ic">${icon('credit-card')}</span><span><strong>${escapeHtml(rotuloDoCartao(cartao))}</strong><small>Cartão salvo</small></span></div>`).join('');

  const rodape = liberado
    ? `<a href="#carteira/cartão" class="btn btn-outline" style="margin-top:14px;">${icon('plus', 'ic sm')} Adicionar cartão</a>`
    : `<p class="muted" style="margin-top:14px;">${icon('credit-card', 'ic sm')} ${escapeHtml(motivo)}</p>`;

  root.innerHTML = `
    <div class="split-2">
      <div>
        <div class="card">
          <h2>Formas de pagamento</h2>
          <div class="rlist">
            <div class="payment-row"><span class="badge-ic"><i class="ic-pix" aria-hidden="true"></i></span><span><strong>Pix</strong><small>Aprovação na hora</small></span></div>
            ${linhasCartao}
          </div>
          ${rodape}
        </div>
      </div>
      <aside class="card">
        <h2>Como funciona</h2>
        <p class="muted">Você paga a cada reserva, direto no checkout. A Qadras não guarda saldo.</p>
      </aside>
    </div>`;
}

/* O formulario que morava aqui pedia numero, validade e CVV, prometia que
   "seus dados sao protegidos e criptografados", jogava tudo fora e respondia
   "Cartao salvo com sucesso". Nao ha adquirente: pedir cartao de verdade sem
   ter onde guardar nao e demonstracao, e coleta de dado que nao devia sair
   do bolso da pessoa. */
async function renderWalletAction(root, route) {
  const { liberado, motivo } = await estadoDoCartao();
  const action = route.params.action || 'adicionar';
  const pageTitle = document.querySelector('[data-page-title]');
  const pageSub = document.querySelector('[data-page-sub]');

  if (action === 'cartão' && !liberado) {
    if (pageTitle) pageTitle.textContent = 'Cartão de crédito';
    if (pageSub) pageSub.textContent = 'Ainda não disponível';
    root.innerHTML = `
      <a href="#carteira" class="back-link"><svg class="ic sm"><use href="#i-left"/></svg> Voltar para Pagamento</a>
      <div class="card" style="margin-top:16px;">
        <h2>Ainda não dá para salvar cartão</h2>
        <p class="muted" style="margin:12px 0;line-height:1.6;">${escapeHtml(motivo)}</p>
        <a href="#carteira" class="btn btn-primary">Entendi</a>
      </div>`;
    return;
  }
  // Sem tela de captura enquanto nao houver adquirente.
  location.hash = 'carteira';
}

/* O backend manda o icone como 'i-flame'; o front desenha com lucide. */
const ICONE_CONQUISTA = { 'i-check': 'circle-check', 'i-flame': 'flame', 'i-map': 'map', 'i-star': 'star' };

/* Campo em branco nao diz se falta preencher ou se o dado sumiu. O vazio
   vira convite, e nao um espaco morto ao lado do rotulo. */
function campoPerfil(rotulo, valor) {
  const preenchido = String(valor || '').trim();
  return `<div><span>${escapeHtml(rotulo)}</span>${preenchido
    ? `<strong>${escapeHtml(preenchido)}</strong>`
    : '<em class="desktop-profile-vazio">Não informado</em>'}</div>`;
}

async function renderProfile(root) {
  const [profile, reservations, venues, estados] = await Promise.all([
    venueService.profile(),
    venueService.reservations(),
    venueService.list(),
    carregarEstados()
  ]);
  const next = reservations.find((item) => item.group === 'proxima');
  const nextVenue = next ? venues.find((venue) => venue.id === next.venueId) : null;
  const avatar = profile.photo
    ? `<img src="${escapeHtml(profile.photo)}" alt="Foto de ${escapeHtml(profile.name)}" decoding="async" loading="lazy" referrerpolicy="no-referrer">`
    : escapeHtml(profile.name.slice(0, 1));
  root.innerHTML = `
    <div class="desktop-profile-page">
      <section class="desktop-profile-header">
        <div class="desktop-profile-identity">
          <div class="desktop-profile-avatar-wrap">
            <span class="prof-av ${profile.photo ? 'has-photo' : ''}" data-player-profile-avatar>${avatar}</span>
            <label class="desktop-profile-photo" for="desktop-profile-photo" aria-label="Alterar foto do perfil">
              ${icon('camera')}
              <input id="desktop-profile-photo" type="file" accept="image/*" data-player-profile-photo hidden>
            </label>
          </div>
          <div class="desktop-profile-copy">
            <h2>${escapeHtml(profile.name)}</h2>
            <p>Jogador desde ${escapeHtml(profile.memberSince)}</p>
            <div class="desktop-profile-meta">
              ${profile.city ? `<span>${icon('map-pin', 'ic sm')}${escapeHtml(profile.city)}</span>` : ''}
              <span>${icon('mail', 'ic sm')}${escapeHtml(profile.email)}</span>
            </div>
          </div>
        </div>
        <div class="desktop-profile-side">
          <button class="btn btn-outline desktop-profile-edit" type="button" data-player-profile-edit>
            ${icon('pencil', 'ic sm')}Editar perfil
          </button>
          <div class="prof-stats desktop-profile-stats">
            <div><b class="num">${profile.stats.games}</b><span>jogos</span></div>
            <div><b class="num">${profile.stats.reservations}</b><span>reservas</span></div>
            <div><b class="num">${profile.stats.favorites}</b><span>favoritas</span></div>
          </div>
        </div>
      </section>

      <div class="desktop-profile-grid">
        <section class="card desktop-profile-activity">
          <div class="desktop-profile-section-head">
            <div><h2>Sua atividade</h2><p>Acompanhe sua próxima partida e seu progresso.</p></div>
            ${rotaLiberada('reservas') ? `<a class="desktop-profile-link" href="#reservas">Ver reservas${icon('chevron-right', 'ic sm')}</a>` : ''}
          </div>
          ${next && nextVenue ? `
          <div class="desktop-profile-next">
            <span class="desktop-profile-eyebrow">Próximo jogo</span>
            <a href="#quadra/${nextVenue.id}" class="next-game">
              <img src="${escapeHtml(nextVenue.image)}" alt="${escapeHtml(nextVenue.name)}">
              <div class="ng-info"><strong>${escapeHtml(nextVenue.name)}</strong><div class="ng-meta"><span>${icon('calendar-days', 'ic sm')}${escapeHtml(next.date)}</span><span>${icon('clock-3', 'ic sm')}${next.hour}</span></div><span class="status ${escapeHtml(next.statusClass)}">${escapeHtml(next.status)}</span></div>
              ${icon('chevron-right', 'desktop-profile-next__arrow')}
            </a>
          </div>` : `
          <p class="desktop-profile-empty">Nenhum jogo marcado ainda. <a href="#quadras">Encontre uma quadra</a> e faça a primeira reserva.</p>`}
          <div class="desktop-profile-achievements">
            <h3>Conquistas</h3>
            <div class="achv-grid">
              ${(profile.conquistas || []).map((c) => `
              <div class="achv ${c.on ? '' : 'locked'}"><span class="ic-wrap">${icon(ICONE_CONQUISTA[c.icon] || 'star')}</span><div><strong>${escapeHtml(c.title)}</strong><small>${escapeHtml(c.desc)}</small></div></div>`).join('')}
            </div>
          </div>
        </section>

        <section class="card desktop-profile-about">
          <div class="desktop-profile-section-head">
            <div><h2>Sobre você</h2><p>Informações usadas nas suas reservas.</p></div>
          </div>
          <div class="desktop-profile-details">
            <div><span>E-mail</span><strong>${escapeHtml(profile.email)}</strong></div>
            ${campoPerfil('Celular', profile.phone)}
            ${campoPerfil('Cidade', profile.city)}
            ${campoPerfil('Esporte favorito', profile.favoriteSport)}
          </div>
        </section>
      </div>

      <form id="player-profile-form" class="card desktop-profile-editor" data-player-profile-form data-cidade-atual="${escapeHtml(profile.city || '')}" hidden>
        <div class="desktop-profile-section-head">
          <div><h2>Editar perfil</h2><p>Atualize como suas informações aparecem no aplicativo.</p></div>
          <button class="icon-btn" type="button" data-player-profile-cancel aria-label="Fechar edição">${icon('x')}</button>
        </div>
        <!-- Só identidade aqui. Esporte e distância moram em Ajustes: tê-los
             nos dois lugares deixava duas telas fazendo a mesma coisa. -->
        <div class="input-row">
          <div class="inp"><label for="pf-name">Nome completo</label>
            <input id="pf-name" type="text" name="name" value="${escapeHtml(profile.name)}" autocomplete="name" required></div>
          <div class="inp"><label for="pf-phone">Celular</label>
            <input id="pf-phone" type="tel" name="phone" inputmode="numeric" autocomplete="tel" maxlength="16"
                   placeholder="(62) 99999-0000" value="${escapeHtml(mascaraTelefone(profile.phone || ''))}" data-mascara="telefone"></div>
        </div>
        <div class="input-row">
          <div class="inp"><label for="pf-uf">Estado</label>
            <select id="pf-uf" name="state" data-cfg-uf>
              <option value="">Selecione</option>
              ${estados.map((e) => `<option value="${escapeHtml(e.sigla)}" ${e.sigla === (profile.state || '') ? 'selected' : ''}>${escapeHtml(e.nome)}</option>`).join('')}
            </select></div>
          <div class="inp"><label for="pf-city">Cidade</label>
            <select id="pf-city" name="city" data-cfg-cidade ${profile.state ? '' : 'disabled'}>
              <option value="">${profile.state ? 'Carregando…' : 'Escolha o estado primeiro'}</option>
            </select></div>
        </div>
        <div class="inp"><label for="pf-email">E-mail</label>
          <input id="pf-email" type="email" value="${escapeHtml(profile.email)}" readonly>
          <small class="set-nota">${profile.provider === 'google'
            ? 'Sua conta entra pelo Google, então o e-mail vem de lá.'
            : 'O e-mail identifica seu login e não pode ser alterado.'}</small>
        </div>
        <div class="desktop-profile-editor__actions">
          <button class="btn btn-outline" type="button" data-player-profile-cancel>Cancelar</button>
          <button class="btn btn-primary" type="submit">${icon('check', 'ic sm')}Salvar alterações</button>
        </div>
      </form>
    </div>`;
}

async function renderConfig(root) {
  const profile = await venueService.profile();
  const prefs = lerPreferencias();

  /* Notificacoes ficaram de fora na web por decisao de produto: aviso de
     reserva e lembrete de jogo sao push, e push so existe no app instalado.
     Mostrar os interruptores aqui prometia um canal que o navegador nao tem.

     Privacidade tambem saiu: os interruptores nao tinham backend nenhum por
     tras — mexer neles nao mudava nada, em nenhum lugar. */
  root.innerHTML = `
    <div class="settings-topo">
      <a class="btn btn-soft desktop-voltar" href="#quadras">${icon('arrow-left', 'ic sm')}Voltar</a>
    </div>
    <form id="player-config-form" class="settings" data-player-config-form novalidate>
      <section class="set-card">
        <div class="set-aside"><h2>Preferências de jogo</h2><p>Deixamos a busca do seu jeito.</p></div>
        <div class="set-fields">
          <div class="input-row">
            <div class="inp"><label for="cfg-sport">Esporte padrão</label>
              <select id="cfg-sport" name="favoriteSport">
                <option value="">Sem preferência</option>
                ${MODALIDADES.map((e) => `<option ${e === profile.favoriteSport ? 'selected' : ''}>${escapeHtml(e)}</option>`).join('')}
              </select>
            </div>
            <div class="inp"><label for="cfg-dist">Distância padrão</label>
              <select id="cfg-dist" name="distancia">
                ${[2, 5, 10, 25].map((km) => `<option value="${km}" ${String(prefs.distancia) === String(km) ? 'selected' : ''}>Até ${km} km</option>`).join('')}
              </select>
            </div>
          </div>
        </div>
      </section>

      <section class="set-card">
        <div class="set-aside"><h2>Sessão</h2><p>Encerrar o acesso neste navegador.</p></div>
        <div class="set-fields">
          <a href="./login-web.html" class="btn btn-soft" data-auth-logout>Sair da conta</a>
        </div>
      </section>

      <div class="settings-acoes">
        <button class="btn btn-primary" type="submit">Salvar alterações</button>
      </div>
    </form>

    <!-- Nome, celular, estado e cidade vivem em Perfil > Editar perfil. Tê-los
         aqui também deixava duas telas com o mesmo formulário. -->
    <p class="settings-atalho">Nome, telefone e cidade ficam em <a href="#perfil">Editar perfil</a>.</p>

    <section class="set-card danger" data-cfg-perigo>
      <div class="set-aside">
        <h2>Excluir conta</h2>
        <p>Não dá para desfazer.</p>
      </div>
      <div class="set-fields">
        <ul class="set-lista">
          <li>${icon('x', 'ic sm')}Seu perfil, favoritos e preferências somem.</li>
          <li>${icon('x', 'ic sm')}Seu nome e sua foto são apagados.</li>
          <li>${icon('check', 'ic sm')}Reservas já feitas continuam registradas na arena, por obrigação fiscal dela.</li>
        </ul>
        <button type="button" class="btn btn-danger" data-cfg-excluir>${icon('trash-2', 'ic sm')}Excluir minha conta</button>
      </div>
    </section>`;
}

/* Estados e cidades vem do nosso backend (dados do IBGE embarcados), e nao do
   IBGE em tempo real: o navegador nao faz request para fora e a lista nao
   depende de servico de terceiro estar de pe. */
let _estadosCache = null;

async function carregarEstados() {
  /* `_estadosCache && length` e nao so `_estadosCache`: array vazio e truthy,
     entao a versao anterior gravava a FALHA no cache e nunca mais tentava —
     bastava um tropeco de rede no primeiro carregamento para o campo Estado
     ficar vazio pelo resto da sessao. */
  if (_estadosCache && _estadosCache.length) return _estadosCache;
  try {
    _estadosCache = await venueService.estados();
  } catch (error) {
    _estadosCache = null;
    return [];
  }
  return _estadosCache;
}

async function pintarCidades(root, uf, selecionada) {
  const select = root.querySelector('[data-cfg-cidade]');
  if (!select) return;
  select.disabled = true;
  select.innerHTML = '<option value="">Carregando…</option>';
  try {
    const cidades = await venueService.cidadesDe(uf);
    /* Cidade gravada antes dos dropdowns era texto livre e pode nao bater com
       a grafia do IBGE ("Goiania" x "Goiânia"). Sem isto o select cairia em
       "Selecione" e o proximo salvar apagaria a cidade da pessoa em silencio.
       Entra como opcao propria, marcada, ate ela escolher outra. */
    const foraDaLista = selecionada && !cidades.includes(selecionada);
    select.innerHTML = '<option value="">Selecione</option>' +
      (foraDaLista ? `<option selected>${escapeHtml(selecionada)}</option>` : '') +
      cidades.map((c) => `<option ${c === selecionada ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
    select.disabled = false;
  } catch (error) {
    select.innerHTML = '<option value="">Não foi possível carregar</option>';
  }
}

/* (62) 99999-0000 — aceita 10 e 11 digitos. Formata so o que existe, para o
   campo nao brigar com quem esta digitando o comeco do numero. */
function mascaraTelefone(valor) {
  const d = String(valor || '').replace(/\D/g, '').slice(0, 11);
  if (!d) return '';
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/* Distancia e preferencia de busca, nao dado de conta: vive no aparelho.
   Guardar no servidor obrigaria migration e endpoint para algo que muda
   conforme onde a pessoa esta. */
function lerPreferencias() {
  try {
    return { distancia: 5, ...(JSON.parse(localStorage.getItem('pq:player_prefs') || '{}')) };
  } catch (error) {
    return { distancia: 5 };
  }
}

function gravarPreferencias(patch) {
  try {
    localStorage.setItem('pq:player_prefs', JSON.stringify({ ...lerPreferencias(), ...patch }));
  } catch (error) { /* modo privado sem storage: a busca so perde o padrao */ }
}

/* Onboarding da web.

   A ordem importa: modalidade primeiro, posicao depois. "Pivo" existe no
   futsal e no basquete e quer dizer coisas diferentes; "Zagueiro" nao existe
   em nenhum dos dois. Perguntar a posicao antes produzia lista de futebol de
   campo para quem so joga volei.

   Nao ha "pular": o passo e obrigatorio, e um atalho so devolveria a pessoa
   para ca no proximo clique, via guard de rota. */
/* Localizacao do aparelho.

   O navegador so entrega a posicao a partir de um gesto da pessoa e em
   HTTPS (localhost conta como origem segura). Recusa e resposta valida, nao
   erro do app: cada motivo vira uma frase que diz o que fazer. */
/* Aviso fixo ao lado do seletor de local. Mensagem vazia remove. */
function avisoLocal(selectLocal, texto) {
  const caixa = selectLocal.closest('[data-player-local]');
  if (!caixa) return;
  let aviso = caixa.parentElement.querySelector('[data-local-aviso]');
  if (!texto) {
    aviso?.remove();
    return;
  }
  if (!aviso) {
    aviso = document.createElement('p');
    aviso.className = 'desktop-local-aviso';
    aviso.setAttribute('data-local-aviso', '');
    aviso.setAttribute('role', 'alert');
    caixa.insertAdjacentElement('afterend', aviso);
  }
  aviso.textContent = texto;
}

function posicaoAtual() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Seu navegador não oferece localização'));
      return;
    }
    /* Origem insegura nao pede permissao nenhuma: o navegador recusa antes.
       Acontece ao abrir pelo IP da rede local (http://192.168.x.x) em vez de
       localhost — e a falha e silenciosa se ninguem avisar. */
    if (!window.isSecureContext) {
      reject(new Error('A localização exige HTTPS. Abra por localhost ou por um endereço https.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (erro) => {
        const frases = {
          1: 'Permissão negada. Libere a localização nas configurações do site.',
          2: 'Não foi possível obter sua localização agora.',
          3: 'A localização demorou demais para responder.'
        };
        reject(new Error(frases[erro.code] || 'Não foi possível obter sua localização'));
      },
      /* 10s e cache de 5min: pedir precisao alta aqui gastaria bateria para
         ordenar uma lista por quilometro. */
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  });
}

async function renderOnboarding(root, route) {
  const sports = MODALIDADES;
  const user = authService.currentUser() || {};
  const escolha = {
    favoriteSport: user.favoriteSport || '',
    position: user.position || '',
    level: user.level || ''
  };

  root.innerHTML = `
    <form class="card desktop-onb" data-player-onb-form novalidate>
      <p class="desktop-onb__intro">Isso fica no seu perfil, ajuda a montar times equilibrados e vai separar o ranking por modalidade. Dá pra mudar depois em Ajustes.</p>

      <fieldset class="desktop-onb__grupo">
        <legend>Qual esporte você mais vai jogar?</legend>
        <div class="desktop-onb__opcoes">
          ${sports.map((esporte) => `<label class="desktop-onb__op">
            <input type="radio" name="favoriteSport" value="${escapeHtml(esporte)}"${esporte === escolha.favoriteSport ? ' checked' : ''}>
            <span>${escapeHtml(esporte)}</span>
          </label>`).join('')}
        </div>
      </fieldset>

      <!-- Preenchido por pintarPosicoes() conforme a modalidade escolhida. -->
      <fieldset class="desktop-onb__grupo" data-onb-posicoes hidden></fieldset>

      <fieldset class="desktop-onb__grupo">
        <legend>Como você se descreve?</legend>
        <div class="desktop-onb__opcoes desktop-onb__opcoes--largo">
          ${LEVELS.map((l) => `<label class="desktop-onb__op">
            <input type="radio" name="level" value="${escapeHtml(l.id)}"${l.id === escolha.level ? ' checked' : ''}>
            <span><strong>${escapeHtml(l.label)}</strong><small>${escapeHtml(l.hint)}</small></span>
          </label>`).join('')}
        </div>
      </fieldset>

      <p class="desktop-onb__erro" data-onb-erro hidden role="alert"></p>
      <button class="btn btn-primary btn-lg" type="submit">Concluir e explorar quadras</button>
    </form>`;

  pintarPosicoes(root, escolha.favoriteSport, escolha.position);
}

/* Desenha as posicoes da modalidade escolhida. Tenis nao entra: e individual
   e nao tem posicao — nesse caso o bloco some em vez de mostrar lista vazia. */
function pintarPosicoes(root, esporte, selecionada) {
  const bloco = root.querySelector('[data-onb-posicoes]');
  if (!bloco) return;
  const posicoes = posicoesDe(esporte);
  if (!posicoes.length) {
    bloco.hidden = true;
    bloco.innerHTML = '';
    return;
  }
  bloco.hidden = false;
  bloco.innerHTML = `
    <legend>Onde você joga no ${escapeHtml(esporte)}?</legend>
    <div class="desktop-onb__opcoes">
      ${posicoes.map((p) => `<label class="desktop-onb__op">
        <input type="radio" name="position" value="${escapeHtml(p.id)}"${p.id === selecionada ? ' checked' : ''}>
        <span>${icon(p.icon, 'ic')}${escapeHtml(p.id)}</span>
      </label>`).join('')}
    </div>`;
  refreshIcons(bloco);
}

async function renderMessages(root, route) {
  const conversations = await venueService.conversations();
  const selectedId = route.params.id || 0;
  const active = conversations.find((item) => String(item.id) === String(selectedId));
  root.innerHTML = `
    <div class="chat ${active ? 'has-active' : ''}">
      <aside class="chat-list">
        <div class="chat-list-head">Conversas</div>
        ${conversations.map((conversation) => {
          const last = conversation.messages.at(-1);
          return `
            <a class="conv ${conversation.id === active?.id ? 'on' : ''}" href="#mensagens/${conversation.id}">
              <span class="conv-av">${escapeHtml(conversation.venue[0])}</span>
              <div class="conv-main">
                <div class="conv-top"><strong>${escapeHtml(conversation.venue)}</strong><span class="conv-time">${escapeHtml(last?.time || '')}</span></div>
                <div class="conv-prev">${escapeHtml(last?.text || 'Sem mensagens')}</div>
              </div>
            </a>`;
        }).join('')}
      </aside>
      <section class="chat-thread">
        ${active ? `
          <header class="thread-head"><span class="conv-av">${escapeHtml(active.venue[0])}</span><div><strong>${escapeHtml(active.venue)}</strong><div class="thread-sub">${escapeHtml(active.subject)}</div></div></header>
          <div class="bubbles" data-player-bubbles>
            ${active.messages.map((message) => `<div class="bubble ${message.from === 'player' ? 'me' : 'them'}"><div class="bub-txt">${escapeHtml(message.text)}</div><div class="bub-time">${escapeHtml(message.time)}</div></div>`).join('')}
          </div>
          <form class="composer" data-player-message-form data-conversation-id="${active.id}">
            <input type="text" name="message" placeholder="Escreva uma mensagem..." autocomplete="off" required>
            <button type="submit" class="btn btn-primary" aria-label="Enviar"><svg class="ic"><use href="#i-send"/></svg></button>
          </form>` : `
          <div class="chat-empty"><div><div class="empty-ic"><svg class="ic lg"><use href="#i-chat"/></svg></div><h3>Suas mensagens</h3><p>Selecione uma conversa ao lado.</p></div></div>`}
      </section>
    </div>`;
  const bubbles = root.querySelector('[data-player-bubbles]');
  if (bubbles) bubbles.scrollTop = bubbles.scrollHeight;
}

function updateTopbar(route) {
  const actions = document.querySelector('[data-player-topbar-actions]');
  if (!actions) return;
  if (route.name === 'config') {
    actions.innerHTML = '<button type="submit" form="player-config-form" class="btn btn-primary">Salvar alterações</button>';
  } else {
    actions.replaceChildren();
  }
  window.pqRefreshIcons?.(actions);
}

async function renderGame(root) {
  const status = await loadGame();
  if (status === 'ok') return;
  // 'empty' = nao ha partida. 'error' = a tela nao montou — nao mentir dizendo
  // que nao ha jogo; o motivo real fica no console.
  root.innerHTML = status === 'empty'
    ? '<div class="empty"><h3>Nenhuma partida ativa</h3><p>Quando você tiver um jogo marcado ele aparece aqui.</p><a class="btn" href="#quadras">Encontrar uma quadra</a></div>'
    : '<div class="empty"><h3>Não foi possível abrir a partida</h3><p>Recarregue a tela. Se continuar, feche e abra o app.</p><button class="btn" type="button" data-game-reload>Recarregar</button></div>';
}

export async function renderPlayerDesktopPage(route, root) {
  if (activeDesktopApprovalTimer) {
    clearInterval(activeDesktopApprovalTimer);
    activeDesktopApprovalTimer = null;
  }
  if (desktopMap) {
    desktopMap.remove();
    desktopMap = null;
  }
  currentRoute = route;
  const renderers = {
    quadras: renderExplore,
    quadra: renderVenue,
    arena: renderArena,
    pagamento: renderPayment,
    confirmado: renderConfirmation,
    reservas: renderReservations,
    favoritos: renderFavorites,
    carteira: renderWallet,
    carteiraAcao: renderWalletAction,
    perfil: renderProfile,
    config: renderConfig,
    onboarding: renderOnboarding,
    mensagens: renderMessages,
    game: renderGame
  };
  const page = root.querySelector('[data-player-desktop-page]');
  if (!page || !renderers[route.name]) return;
  await renderers[route.name](page, route);
  updateTopbar(route);
  window.pqRefreshIcons?.(page);
}

export function initPlayerDesktopActions() {
  if (!document.querySelector('[data-player-desktop-route-view]')) return;

  document.addEventListener('submit', async (event) => {
    const explore = event.target.closest('[data-player-explore-form]');
    if (explore) {
      event.preventDefault();
      const query = new URLSearchParams(new FormData(explore));
      for (const [key, value] of [...query]) {
        if (!String(value).trim()) query.delete(key);
      }
      location.hash = `quadras${query.toString() ? `?${query}` : ''}`;
      return;
    }

    const profileForm = event.target.closest('[data-player-profile-form]');
    if (profileForm) {
      event.preventDefault();
      if (!profileForm.reportValidity()) return;
      const data = new FormData(profileForm);
      const botao = profileForm.querySelector('[type="submit"]');
      botao?.setAttribute('disabled', 'disabled');
      try {
        await venueService.saveProfile({
          name: String(data.get('name') || '').trim(),
          // So digitos: a mascara e enfeite de tela, e gravar "(62) 9..."
          // impediria busca ou discagem depois.
          phone: String(data.get('phone') || '').replace(/\D/g, ''),
          state: String(data.get('state') || '').trim(),
          city: String(data.get('city') || '').trim()
        });
        const view = document.querySelector('[data-player-desktop-route-view]');
        await renderPlayerDesktopPage(currentRoute, view);
        window.pqToast?.('Perfil atualizado');
      } catch (error) {
        window.pqToast?.(error.message || 'Não foi possível salvar');
      } finally {
        botao?.removeAttribute('disabled');
      }
      return;
    }

    const onbForm = event.target.closest('[data-player-onb-form]');
    if (onbForm) {
      event.preventDefault();
      const erro = onbForm.querySelector('[data-onb-erro]');
      const botao = onbForm.querySelector('[type="submit"]');
      const dados = new FormData(onbForm);
      const esporte = String(dados.get('favoriteSport') || '');
      const posicao = String(dados.get('position') || '');
      const nivel = String(dados.get('level') || '');

      /* Validacao na mao, e nao reportValidity(): os radios sao invisiveis
         (opacity 0) para o cartao desenhar a selecao, e o Chrome nao
         consegue ancorar o balao nativo num campo que nao da foco — ele
         desiste em silencio. Era isso o "clico em Concluir e nao acontece
         nada". */
      const faltando = !esporte ? 'Escolha o esporte que você mais joga.'
        : (posicoesDe(esporte).length && !posicao) ? 'Escolha em que posição você joga.'
        : !nivel ? 'Escolha como você se descreve.'
        : '';
      if (faltando) {
        erro.textContent = faltando;
        erro.hidden = false;
        erro.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        return;
      }

      erro.hidden = true;
      botao?.setAttribute('disabled', 'disabled');
      try {
        await authService.completeOnboarding({
          favoriteSport: esporte,
          position: posicao,
          level: nivel
        });
        window.pqSyncAuthControls?.();
        const destino = new URLSearchParams(location.hash.split('?')[1] || '').get('next') || 'quadras';
        location.hash = `#${destino}`;
      } catch (falha) {
        erro.textContent = falha.message || 'Não foi possível salvar. Tente de novo.';
        erro.hidden = false;
      } finally {
        botao?.removeAttribute('disabled');
      }
      return;
    }

    const configForm = event.target.closest('[data-player-config-form]');
    if (configForm) {
      event.preventDefault();
      if (!configForm.reportValidity()) return;
      const botao = configForm.querySelector('[type="submit"]');
      botao?.setAttribute('disabled', 'disabled');
      try {
        const dados = new FormData(configForm);
        /* Distancia e local, o resto e do perfil: uma chamada so para o que
           o servidor guarda. */
        gravarPreferencias({ distancia: Number(dados.get('distancia')) || 5 });
        await venueService.saveProfile({
          favoriteSport: String(dados.get('favoriteSport') || '').trim()
        });
        window.pqToast?.('Configurações salvas');
      } catch (error) {
        window.pqToast?.(error.message || 'Não foi possível salvar');
      } finally {
        botao?.removeAttribute('disabled');
      }
      return;
    }

    const demo = event.target.closest('[data-player-demo-form]');
    if (demo) {
      event.preventDefault();
      if (!demo.reportValidity()) return;
      window.pqToast?.(demo.dataset.success || 'Alterações salvas');
      return;
    }

    const composer = event.target.closest('[data-player-message-form]');
    if (composer) {
      event.preventDefault();
      const input = composer.elements.message;
      const message = input.value.trim();
      if (!message) return;
      await venueService.sendMessage(composer.dataset.conversationId, message);
      const view = document.querySelector('[data-player-desktop-route-view]');
      await renderPlayerDesktopPage(currentRoute, view);
      window.pqRefreshIcons?.(view);
    }
  });

  /* Escolher o local: click, e nao change — as opcoes agora sao <button>
     dentro do menu proprio, nao <option> de um <select>. */
  document.addEventListener('click', async (event) => {
    const opLocal = event.target.closest('[data-local-op]');
    if (opLocal) {
      const selectLocal = opLocal;
      const valor = opLocal.dataset.localOp;
      opLocal.closest('[data-player-local]')?.removeAttribute('open');
      const redesenhar = async () => {
        const view = document.querySelector('[data-player-desktop-route-view]');
        await renderPlayerDesktopPage(currentRoute, view);
      };

      if (valor === '__auto__') {
        selectLocal.disabled = true;
        try {
          /* Se a permissao ja foi negada, o Chrome NAO pergunta de novo — a
             chamada falha na hora e, sem este aviso, parece que o botao nao
             faz nada. E o caso mais comum de "nao aparece a permissao". */
          const estado = await navigator.permissions?.query({ name: 'geolocation' })
            .then((p) => p.state).catch(() => null);
          if (estado === 'denied') {
            throw new Error('Você bloqueou a localização para este site. Clique no cadeado da barra de endereço, permita a localização e tente de novo.');
          }
          const pos = await posicaoAtual();
          /* Nomeia o lugar em vez de exibir "Perto de você": saber o bairro
             confirma para a pessoa que o app achou onde ela esta. Se o lugar
             conhecido mais proximo estiver a mais de 60 km, o nome so
             confundiria — ai fica o rotulo generico. */
          let rotulo = 'Perto de você';
          try {
            const lugar = await venueService.localDeCoordenada(pos.lat, pos.lng);
            if (lugar && lugar.distanceKm <= 60 && lugar.label) rotulo = lugar.label;
          } catch (erro) { /* nome e enfeite: a busca funciona sem ele */ }
          definirLocal({ label: rotulo, lat: pos.lat, lng: pos.lng, auto: true });
          avisoLocal(selectLocal, '');
          window.pqToast?.('Usando sua localização');
        } catch (erro) {
          /* Negar a permissao nao pode deixar o seletor mentindo que esta em
             "minha localizacao": volta para o que estava e diz o porque.

             O aviso fica FIXO ao lado do seletor, e nao so no toast: o toast
             some em 2,6s e esta e justamente a mensagem que a pessoa precisa
             ler com calma para destravar a permissao. */
          avisoLocal(selectLocal, erro.message);
          window.pqToast?.(erro.message);
          selectLocal.disabled = false;
          await redesenhar();
          return;
        } finally {
          selectLocal.disabled = false;
        }
        await redesenhar();
        return;
      }
      avisoLocal(selectLocal, '');

      const cidades = await venueService.cidadesComQuadra();
      definirLocal(cidades.find((c) => c.label === valor) || null);
      await redesenhar();
      window.pqToast?.(`Buscando em ${valor}`);
    }
  });

  document.addEventListener('change', (event) => {
    const selectUf = event.target.closest('[data-cfg-uf]');
    if (selectUf) {
      const form = selectUf.closest('form');
      if (selectUf.value) {
        pintarCidades(form, selectUf.value, '');
      } else {
        const cidade = form.querySelector('[data-cfg-cidade]');
        cidade.innerHTML = '<option value="">Escolha o estado primeiro</option>';
        cidade.disabled = true;
      }
    }
  });

  /* Mascara enquanto digita. `input` e nao `keyup`: pega colar e autofill. */
  document.addEventListener('input', (event) => {
    const campo = event.target.closest('[data-mascara="telefone"]');
    if (!campo) return;
    const antes = campo.value;
    const formatado = mascaraTelefone(antes);
    if (formatado !== antes) {
      campo.value = formatado;
      /* Cursor no fim: reescrever o value joga o caret para o inicio e a
         pessoa digita de tras para frente. */
      campo.setSelectionRange(formatado.length, formatado.length);
    }
  });

  /* Excluir conta. Duas confirmacoes de proposito: e irreversivel, e um
     clique acidental num botao vermelho nao pode custar a conta de alguem. */
  document.addEventListener('click', async (event) => {
    const botao = event.target.closest('[data-cfg-excluir]');
    if (!botao) return;
    event.preventDefault();
    if (!window.confirm('Excluir sua conta? Perfil, favoritos e preferências somem e não dá para desfazer.')) return;
    if (!window.confirm('Confirma? Esta é a última pergunta.')) return;
    botao.setAttribute('disabled', 'disabled');
    try {
      await venueService.deleteAccount();
      await authService.logout();
      window.pqSyncAuthControls?.();
      location.replace('./login-web.html');
    } catch (error) {
      window.pqToast?.(error.message || 'Não foi possível excluir a conta');
      botao.removeAttribute('disabled');
    }
  });

  document.addEventListener('change', (event) => {
    const esporteRadio = event.target.closest('[data-player-onb-form] [name="favoriteSport"]');
    if (esporteRadio) {
      const form = esporteRadio.closest('[data-player-onb-form]');
      pintarPosicoes(form, esporteRadio.value, '');
    }
  });

  document.addEventListener('change', async (event) => {
    const photoInput = event.target.closest('[data-player-profile-photo]');
    if (!photoInput) return;
    const file = photoInput.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      window.pqToast?.('Escolha uma imagem de até 10 MB');
      photoInput.value = '';
      return;
    }

    photoInput.disabled = true;
    try {
      const photo = await imageFileToDataUrl(file);
      await venueService.saveProfile({ photo });
      const view = document.querySelector('[data-player-desktop-route-view]');
      await renderPlayerDesktopPage(currentRoute, view);
      window.pqToast?.('Foto do perfil atualizada');
    } catch (error) {
      window.pqToast?.(error.message || 'Não foi possível atualizar a foto');
    } finally {
      photoInput.disabled = false;
      photoInput.value = '';
    }
  });

  document.addEventListener('click', async (event) => {
    const profileEdit = event.target.closest('[data-player-profile-edit]');
    if (profileEdit) {
      /* O <select> de cidade nasce vazio porque a lista depende da UF; ao
         abrir o editor, preenche com o estado que ja esta salvo. */
      const form = document.querySelector('[data-player-profile-form]');
      const uf = form?.querySelector('[data-cfg-uf]')?.value;
      if (uf) pintarCidades(form, uf, form.dataset.cidadeAtual || '');
    }
    if (profileEdit) {
      const form = document.querySelector('[data-player-profile-form]');
      if (!form) return;
      form.hidden = false;
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      window.setTimeout(() => form.elements.name?.focus(), 250);
      return;
    }

    const profileCancel = event.target.closest('[data-player-profile-cancel]');
    if (profileCancel) {
      const form = profileCancel.closest('[data-player-profile-form]');
      if (!form) return;
      form.hidden = true;
      document.querySelector('[data-player-profile-edit]')?.focus();
      return;
    }

    const viewButton = event.target.closest('[data-player-view]');
    if (viewButton) {
      const root = viewButton.closest('[data-player-desktop-page]');
      const mode = viewButton.dataset.playerView;
      root.querySelectorAll('[data-player-view]').forEach((button) => button.classList.toggle('on', button === viewButton));
      root.querySelectorAll('[data-player-pane]').forEach((pane) => pane.classList.toggle('hidden', pane.dataset.playerPane !== mode));
      if (mode === 'map') initExploreMap(root);
      return;
    }

    const bookingStage = event.target.closest('[data-booking-stage-go]');
    if (bookingStage) {
      const root = bookingStage.closest('[data-player-desktop-page]');
      setDesktopBookingStage(root, bookingStage.dataset.bookingStageGo, true);
      return;
    }

    const calendarNav = event.target.closest('[data-player-calendar-nav]');
    if (calendarNav) {
      const root = calendarNav.closest('[data-player-desktop-page]');
      const booking = root.querySelector('[data-player-booking]');
      const month = calendarMonthDate(booking.dataset.calendarMonth);
      month.setMonth(month.getMonth() + Number(calendarNav.dataset.playerCalendarNav));
      booking.dataset.calendarMonth = calendarMonthValue(month);
      renderDesktopBookingCalendar(root);
      return;
    }

    const calendarDate = event.target.closest('[data-player-calendar-date]');
    if (calendarDate && !calendarDate.disabled) {
      const root = calendarDate.closest('[data-player-desktop-page]');
      const booking = root.querySelector('[data-player-booking]');
      booking.dataset.date = calendarDate.dataset.playerCalendarDate;
      booking.dataset.hour = '';
      renderDesktopBookingCalendar(root);
      renderBooking(root);
      // Busca a agenda REAL da data escolhida e redesenha com ela.
      await carregarDisponibilidade(booking);
      renderBooking(root);
      return;
    }

    const slot = event.target.closest('[data-player-slot]');
    if (slot && !slot.disabled) {
      const root = slot.closest('[data-player-desktop-page]');
      root.querySelector('[data-player-booking]').dataset.hour = slot.dataset.playerSlot;
      renderBooking(root);
      return;
    }

    const duration = event.target.closest('[data-player-duration]');
    if (duration && !duration.disabled) {
      const root = duration.closest('[data-player-desktop-page]');
      root.querySelector('[data-player-booking]').dataset.duration = duration.dataset.playerDuration;
      renderBooking(root);
      return;
    }

    const paymentRequest = event.target.closest('[data-player-payment-cta]');
    if (paymentRequest?.dataset.paymentRoute) {
      event.preventDefault();
      const paymentRoot = paymentRequest.closest('[data-player-payment-page]');
      const selectedMethod = paymentRoot?.querySelector('[data-player-payment-method].on')?.dataset.playerPaymentMethod || 'pix';
      const params = new URLSearchParams(paymentRequest.dataset.paymentQuery || '');
      params.set('metodo', selectedMethod);
      params.set('deadline', String(Date.now() + APPROVAL_WINDOW_MS));
      location.hash = `${paymentRequest.dataset.paymentRoute}?${params}`;
      return;
    }

    const galleryImage = event.target.closest('[data-player-gallery-image]');
    if (galleryImage) {
      const root = galleryImage.closest('[data-player-desktop-page]');
      const hero = root?.querySelector('[data-player-gallery-hero]');
      if (!hero) return;
      const previous = hero.src;
      hero.src = galleryImage.dataset.playerGalleryImage;
      galleryImage.dataset.playerGalleryImage = previous;
      galleryImage.querySelector('img').src = previous;
      return;
    }

    const method = event.target.closest('[data-player-payment-method]');
    if (method && !method.disabled) {
      const root = method.closest('[data-player-payment-page]');
      syncDesktopPaymentChoice(root, method.dataset.playerPaymentMethod);
      return;
    }

    const favorite = event.target.closest('[data-player-favorite]');
    if (favorite) {
      event.preventDefault();
      const active = await venueService.toggleFavorite(favorite.dataset.playerFavorite);
      favorite.classList.toggle('on', active);
      if (currentRoute?.name === 'favoritos' && !active) {
        const grid = favorite.closest('.grid');
        favorite.closest('.qcard')?.remove();
        if (grid && !grid.querySelector('.qcard')) {
          await renderPlayerDesktopPage(currentRoute, document.querySelector('[data-player-desktop-route-view]'));
        }
      }
      window.pqToast?.(active ? 'Adicionado aos favoritos' : 'Removido dos favoritos');
    }
  });
}
