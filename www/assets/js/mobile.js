import venueService, { definirLocal } from '../../services/venues.js';
import { registrarFecharSobreposicao } from '../../services/navegacao.js';
import storage from '../../storage/storage.js';
import { calculateCheckoutAmounts, formatCurrency, mesAno } from '../../utils/formatters.js';
import { SERVICE_FEE_RATE } from '../../config/constants.js';
import { API_BASE_URL } from '../../config/constants.js';
import { SPORTS, POSITIONS, LEVELS, FEET } from '../../config/mock-data.js';
import { MODALIDADES, posicoesDe } from '../../config/esportes.js';
import { APP_PUBLIC_URL } from '../../config/constants.js';
import authService from '../../services/auth.js';
import { submitPlayerReservation, payPlayerReservation, watchReservation } from '../../services/reservation-live.js';
import { authHashFor, safeNext, requiresLogin } from '../../middleware/auth.js';
import { imageFileToDataUrl } from '../../utils/helpers.js';
import { loadGame, destroyGame, getActiveMatch } from './game-mode.js';
import geoService from '../../services/geo.js';

let currentRoute = null;
let activeMobileMap = null;
let activeUserMarker = null;
let activeMobileApprovalTimer = null;
let gameCardTicker = null;
let clubSection = 'peladas';
const DEFAULT_LOCATION = [-16.6950, -49.2550];
const APPROVAL_WINDOW_MS = 15 * 60 * 1000;
const MOCK_APPROVAL_DELAY_MS = 5000;
const LOCATION_COORDINATES = {
  'Goiania, GO': DEFAULT_LOCATION,
  'Goiânia, GO': DEFAULT_LOCATION,
  'Aparecida de Goiania, GO': [-16.8233, -49.2434],
  'Aparecida de Goiânia, GO': [-16.8233, -49.2434]
};
const SPORT_ICONS = {
  'Futebol Society': 'goal',
  'Beach Tennis': 'circle-dot',
  Volei: 'volleyball',
  Basquete: 'target',
  Tenis: 'activity',
  Futsal: 'trophy'
};
const PAYMENT_METHOD_LABELS = {
  pix: 'Pix',
  card: 'Cartão de crédito',
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

function formatDistance(value) {
  return Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
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

function currentLocation() {
  return storage.get('current_location', 'Goiânia, GO');
}

function currentCoordinates() {
  const saved = storage.get('current_coordinates');
  /* Isto comparava o rotulo com a string "Localização atual". No momento em
     que o rotulo passou a ser o NOME do lugar ("Setor Marista, Goiania"), a
     comparacao falhava e a coordenada real do aparelho era descartada em
     favor do centro de Goiania. Quem decide agora e uma marca explicita, e
     nao o texto que aparece na tela. */
  if (storage.get('current_location_auto') && Array.isArray(saved) && saved.length === 2) {
    return saved.map(Number);
  }
  return LOCATION_COORDINATES[currentLocation()] || DEFAULT_LOCATION;
}

function syncMarketplaceState(root = document) {
  const location = currentLocation();
  root.querySelectorAll('[data-current-location]').forEach((element) => {
    element.textContent = location;
  });
  root.querySelectorAll('[data-search-location]').forEach((input) => {
    input.value = location;
  });

  const notificationsRead = storage.get('notifications_read', false);
  root.querySelectorAll('[data-notification-dot]').forEach((dot) => {
    dot.hidden = notificationsRead;
  });
}

function closeMarketSheet(sheet = document.querySelector('[data-market-sheet]:not([hidden])')) {
  if (!sheet) return;
  sheet.hidden = true;
  document.body.classList.remove('market-sheet-open');
  document.querySelectorAll(`[data-sheet-open="${sheet.id}"]`).forEach((trigger) => {
    trigger.setAttribute('aria-expanded', 'false');
  });
}

/* O voltar (botao da tela e botao fisico) precisa fechar o sheet antes de
   navegar: com o formulario de clube aberto, "voltar" quer dizer fechar o
   formulario, nao sair da tela. Registrado por injecao porque navegacao.js
   nao pode importar daqui — este arquivo ja importa de la. */
registrarFecharSobreposicao(() => {
  const aberto = document.querySelector('[data-market-sheet]:not([hidden])');
  if (!aberto) return false;
  closeMarketSheet(aberto);
  return true;
});

function openMarketSheet(sheetId) {
  const sheet = document.getElementById(sheetId);
  if (!sheet) return;

  document.querySelectorAll('[data-market-sheet]:not([hidden])').forEach((active) => {
    if (active !== sheet) active.hidden = true;
  });
  sheet.hidden = false;
  document.body.classList.add('market-sheet-open');
  document.querySelectorAll(`[data-sheet-open="${sheetId}"]`).forEach((trigger) => {
    trigger.setAttribute('aria-expanded', 'true');
  });

  if (sheetId === 'filter-sheet') {
    const query = routeQuery(currentRoute);
    const form = sheet.querySelector('[data-filter-form]');
    const sport = query.get('esporte') || '';
    const radius = query.get('raio') || '5';
    const now = query.get('agora') === '1';
    fillFilterSports(sport);
    /* Raio fora dos presets e "Personalizado": sem isto, escolher 7 km na
       barra deixava os quatro radios desmarcados ao reabrir, e o proximo
       envio devolvia o padrão de 5 km. */
    const presets = ['2', '5', '10'];
    const custom = !presets.includes(String(radius));
    form?.querySelectorAll('[name="raio"]').forEach((input) => {
      input.checked = custom ? input.value === 'custom' : input.value === radius;
    });
    const range = form?.querySelector('[data-raio-range]');
    const rangeInput = form?.querySelector('[name="raioKm"]');
    if (range) range.hidden = !custom;
    if (custom && rangeInput) {
      rangeInput.value = radius;
      const saida = form?.querySelector('[data-raio-output]');
      if (saida) saida.textContent = `${radius} km`;
    }
    const nowInput = form?.querySelector('[name="agora"]');
    if (nowInput) nowInput.checked = now;
  }
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

function bookingDateLabel(value) {
  const date = parseLocalDate(value);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  const short = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit'
  }).format(date);

  if (localDateValue(date) === localDateValue(today)) return `Hoje, ${short}`;
  if (localDateValue(date) === localDateValue(tomorrow)) return `Amanh\u00e3, ${short}`;
  const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' })
    .format(date)
    .replace('.', '');
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

function ratingStars(rating, className = 'ic') {
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

function calendarMonthValue(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function calendarMonthDate(value) {
  const [year, month] = String(value).split('-').map(Number);
  return new Date(year, month - 1, 1, 12, 0, 0);
}

function bookingDayOffset(value) {
  const today = parseLocalDate(localDateValue());
  return Math.round((parseLocalDate(value) - today) / 86400000);
}

function renderBookingCalendar(root) {
  const booking = root.querySelector('[data-booking]');
  const calendar = root.querySelector('[data-booking-calendar]');
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
  calendar.querySelector('[data-calendar-label]').textContent = label.charAt(0).toUpperCase() + label.slice(1);

  const previous = calendar.querySelector('[data-calendar-nav="-1"]');
  const next = calendar.querySelector('[data-calendar-nav="1"]');
  previous.disabled = month <= minMonth;
  next.disabled = month >= maxMonth;

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
    // No mensalista a data escolhida e a PRIMEIRA sessao, entao so os dias
    // que caem no dia da semana do plano ficam clicaveis.
    const foraDoPlano = booking.dataset.planKind === 'mensalista'
      && date.getDay() !== Number(booking.dataset.planWeekday || 3);
    const disabled = date < today || date > maxDate || foraDoPlano;
    // O inverso de foraDoPlano ja estava calculado; so faltava virar classe.
    const noPlano = booking.dataset.planKind === 'mensalista' && !foraDoPlano && !disabled;
    const selected = value === booking.dataset.date;
    const isToday = value === localDateValue(today);
    const spoken = new Intl.DateTimeFormat('pt-BR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    }).format(date);
    cells.push(`
      <button type="button" class="calendar-day ${selected ? 'on' : ''} ${isToday ? 'is-today' : ''} ${noPlano ? 'is-plan' : ''}"
              data-calendar-date="${value}" aria-label="${escapeHtml(spoken)}"
              aria-pressed="${selected}" ${disabled ? 'disabled' : ''}>
        <span>${day}</span>
      </button>`);
  }
  calendar.querySelector('[data-calendar-grid]').innerHTML = cells.join('');
  window.pqRefreshIcons?.(calendar);
}

function venueCard(venue, options = {}) {
  const action = options.action || 'Ver horários';
  const removable = options.removable
    ? `<button class="favorite-float on" type="button" data-favorite-toggle="${venue.arenaId}" aria-label="Remover dos favoritos">${icon('heart', 'ic fill')}</button>`
    : '';
  const availability = venue.id % 3 === 0 ? 'Hoje a noite' : 'Livre agora';
  return `
    <article class="card venue-card" data-venue-id="${venue.id}">
      ${removable}
      <a class="venue-card-link" href="#quadra/${venue.id}">
        <div class="photo">
          <span class="venue-distance-pill">${icon('navigation')}${formatDistance(venue.distance)} km</span>
          <span class="venue-availability">${icon('clock-3')}${availability}</span>
          <img src="${escapeHtml(venue.image)}" alt="${escapeHtml(venue.name)}" loading="lazy">
        </div>
        <div class="body">
          <div class="venue-card-kicker">
            <span>${escapeHtml(venue.sport)}</span>
            <b>${icon('star')}${venue.rating}</b>
          </div>
          <h3>${escapeHtml(venue.name)}</h3>
          <p class="meta">${icon('map-pin')}${escapeHtml(venue.neighborhood)} - ${formatDistance(venue.distance)} km</p>
          <div class="tags">${venue.tags.slice(0, 2).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>
          <div class="foot">
            <div class="price">${formatCurrency(venue.price)}<small> /hora</small></div>
            <span class="btn-mini">${action}${icon('arrow-right')}</span>
          </div>
        </div>
      </a>
    </article>`;
}

function reservationCard(reservation, venue) {
  return `
    <a href="#quadra/${venue.id}" data-status="${reservation.group}">
      <article class="res-card">
        <img src="${escapeHtml(venue.image)}" alt="${escapeHtml(venue.name)}" loading="lazy">
        <div class="res-info">
          <strong>${escapeHtml(venue.name)}</strong>
          <span class="res-meta">${icon('map-pin')}${escapeHtml(venue.sport)} - ${escapeHtml(venue.neighborhood)}</span>
          <span class="res-meta">${icon('calendar-days')}${escapeHtml(reservation.date)} - ${escapeHtml(reservation.hour)} a ${escapeHtml(reservation.endHour)}</span>
          <div class="res-foot">
            <span class="status ${escapeHtml(reservation.statusClass)}">${escapeHtml(reservation.status)}</span>
            <span class="res-val">${formatCurrency(reservation.price)}</span>
          </div>
        </div>
      </article>
    </a>`;
}

/* A disponibilidade de cada dia vem da API, uma chamada por data.

   Havia aqui uma funcao que ROTACIONAVA os status de hoje para simular os
   outros dias — heranca do mock. Com a API ligada isso virava mentira: o
   horario exibido como livre podia estar reservado, e dava para pedir 3h
   por cima de uma reserva existente. Nao ha como derivar a agenda de um dia
   a partir de outro; so perguntando. */
async function carregarDisponibilidade(booking) {
  const venueId = booking.dataset.venueId;
  const date = booking.dataset.date;
  if (!venueId || !date) return;
  booking.dataset.carregando = '1';
  try {
    const slots = await venueService.availability(venueId, date);
    booking.dataset.availability = JSON.stringify(slots);
  } catch (error) {
    /* Falhou a consulta: melhor nao mostrar horario nenhum do que mostrar o
       do dia anterior como se fosse deste. */
    booking.dataset.availability = '[]';
    window.pqToast?.('Não foi possível carregar os horários deste dia');
  } finally {
    delete booking.dataset.carregando;
  }
}

function routeQuery(route) {
  return route?.query instanceof URLSearchParams ? route.query : new URLSearchParams();
}

/* Rotulo curto da modalidade, sem apagar a diferenca entre elas.

   Antes era sport.replace(' Society', ''), o que fazia "Futebol Society"
   virar "Futebol" na tela — amplo demais, porque society, salao e campo sao
   quadras, precos e times diferentes. Encurtar o prefixo repetido mantem o
   chip legivel E distinto. */
const ROTULO_MODALIDADE = {
  'Futebol Society': 'Society',
  'Futebol de Campo': 'Campo',
  'Futsal': 'Futsal',
  'Futvolei': 'Futevôlei'
};

function rotuloModalidade(nome) {
  return ROTULO_MODALIDADE[nome] || nome;
}

async function renderHome(root) {
  const [sports, venues] = await Promise.all([venueService.featuredSports(), venueService.featured()]);
  const greeting = root.querySelector('[data-home-greeting]');
  const chips = root.querySelector('[data-sport-chips]');
  const featured = root.querySelector('[data-featured-list]');

  if (greeting) {
    const hour = new Date().getHours();
    greeting.textContent = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  }
  /* O nome vinha escrito no HTML ("Olá, Gabriel"), entao qualquer conta era
     cumprimentada como o usuario de demonstracao. Vem da sessao, e so o
     primeiro nome: "Boa noite, Gabriel Henrique Lisboa" nao cabe na linha. */
  const nomeEl = root.querySelector('[data-home-name]');
  if (nomeEl) {
    // currentUser() e sincrono (le do storage) — um .catch() aqui daria
    // TypeError, porque nao ha promessa nenhuma para encadear.
    const usuario = authService.currentUser();
    const primeiro = String(usuario?.name || '').trim().split(/\s+/)[0] || '';
    nomeEl.textContent = primeiro ? `, ${primeiro}` : '';
  }
  if (chips) {
    chips.innerHTML = sports
      .map((sport) => `
        <a class="sport-item" href="#quadras?esporte=${encodeURIComponent(sport)}">
          <span>${icon(SPORT_ICONS[sport] || 'trophy')}</span>
          <strong>${escapeHtml(rotuloModalidade(sport))}</strong>
        </a>`)
      .concat(`
        <a class="sport-item" href="#quadras?esporte=outros">
          <span>${icon('circle-ellipsis')}</span>
          <strong>Outros</strong>
        </a>`)
      .join('');
  }
  if (featured) featured.innerHTML = venues.map((venue) => venueCard(venue, { action: 'Reservar' })).join('');
  syncMarketplaceState(root);

  await renderHomeGameCard(root);
}

/** O card da partida fica sempre na home: proxima / em andamento / encerrada. */
async function renderHomeGameCard(root) {
  const container = root.querySelector('#gameCardContainer') || document.getElementById('gameCardContainer');
  if (!container) return;

  let match = null;
  try {
    match = await venueService.getActiveMatch();
  } catch {
    match = null;
  }

  container.innerHTML = buildGameCard(match);
  container.style.display = '';
  window.pqRefreshIcons?.(container);

  if (match) startGameCardTicker(container, match);
  else stopGameCardTicker();
}

async function renderExplore(root, route) {
  const query = routeQuery(route);
  const sport = query.get('esporte') || '';
  const term = query.get('q') || '';
  const local = query.get('local') || currentLocation();
  const radius = query.get('raio') || '5';
  const now = query.get('agora') === '1';
  const [sports, listedVenues] = await Promise.all([
    venueService.sports(),
    venueService.list({ sport })
  ]);
  const needle = normalizeSearch(term);
  const venuesInRadius = listedVenues.filter((venue) => {
    const insideRadius = venue.distance <= Number(radius);
    const availableSoon = !now || venue.id % 3 !== 0;
    return insideRadius && availableSoon;
  });
  const venues = needle
    ? venuesInRadius.filter((venue) => normalizeSearch([
        venue.name,
        venue.sport,
        venue.neighborhood,
        ...venue.tags
      ].join(' ')).includes(needle))
    : venuesInRadius;

  root.querySelector('[data-results-title]').textContent = term
    ? `Resultados para "${term}"`
    : now
      ? 'Partiu agora'
      : 'Explore quadras';
  root.querySelector('[data-results-sub]').textContent = now
    ? `${venues.length} quadras com horários próximos`
    : `${venues.length} opções em até ${radius} km`;
  const searchInput = root.querySelector('[data-search-form] [name="q"]');
  if (searchInput) searchInput.value = term;
  const radiusInput = root.querySelector('[data-search-form] [name="raio"]');
  if (radiusInput) radiusInput.value = radius;
  const locationInput = root.querySelector('[data-search-form] [name="local"]');
  if (locationInput) locationInput.value = local;
  const sportInput = root.querySelector('[data-search-sport]');
  if (sportInput) {
    sportInput.value = sport;
    // Nao desabilitar: valor vazio ja e descartado no envio, e disabled
    // fazia o campo sumir do FormData na janela entre montar e renderizar.

  }
  const nowInput = root.querySelector('[data-search-now]');
  if (nowInput) nowInput.disabled = !now;
  root.querySelectorAll('[data-current-location]').forEach((element) => {
    element.textContent = local;
  });

  const persistentQuery = `${term ? `&q=${encodeURIComponent(term)}` : ''}${now ? '&agora=1' : ''}`;
  root.querySelector('[data-sport-filters]').innerHTML = [
    `<a class="sport-filter-chip ${sport ? '' : 'on'}" href="#quadras?local=${encodeURIComponent(local)}&raio=${radius}${persistentQuery}">${icon('sparkles')}Todos</a>`,
    ...sports.map((item) => {
      const on = item === sport ? 'on' : '';
      return `<a class="sport-filter-chip ${on}" href="#quadras?local=${encodeURIComponent(local)}&raio=${radius}&esporte=${encodeURIComponent(item)}${persistentQuery}">${icon(SPORT_ICONS[item] || 'trophy')}${escapeHtml(item)}</a>`;
    })
  ].join('');

  const list = root.querySelector('[data-venue-list]');
  if (venues.length) {
    list.innerHTML = venues.map((venue) => venueCard(venue)).join('');
  } else {
    list.innerHTML = `
      <div class="empty">
        <div class="empty-ic">${icon('search-x', 'ic lg')}</div>
        <h3>Nenhuma quadra nesse filtro</h3>
        <p>Tente aumentar a distância ou trocar o esporte.</p>
        <a href="#quadras" class="btn block">Limpar filtros</a>
      </div>`;
  }
}

function mapPopup(venue) {
  return `
    <a class="map-venue-popup" href="#quadra/${venue.id}">
      <img src="${escapeHtml(venue.image)}" alt="">
      <span>
        <strong>${escapeHtml(venue.name)}</strong>
        <small>${escapeHtml(venue.sport)} - ${escapeHtml(venue.neighborhood)}</small>
        <b>${formatCurrency(venue.price)} <em>/hora</em></b>
      </span>
    </a>`;
}

async function renderMap(root, route) {
  const query = routeQuery(route);
  const sport = query.get('esporte') || '';
  const [sports, venues] = await Promise.all([
    venueService.sports(),
    venueService.list({ sport })
  ]);
  const filters = root.querySelector('[data-map-filters]');
  const summary = root.querySelector('[data-map-summary]');
  const mapElement = root.querySelector('[data-live-map]');
  const userLocation = currentCoordinates();

  summary.textContent = sport
    ? `${venues.length} opções de ${displayText(sport)}`
    : `${venues.length} quadras perto de você`;
  filters.innerHTML = [
    `<a class="chip ${sport ? '' : 'on'}" href="#mapa">Todos</a>`,
    ...sports.map((item) => `<a class="chip ${item === sport ? 'on' : ''}" href="#mapa?esporte=${encodeURIComponent(item)}">${escapeHtml(item)}</a>`)
  ].join('');

  if (!window.L) {
    mapElement.innerHTML = `
      <div class="map-unavailable">
        ${icon('map-pin-off', 'ic lg')}
        <strong>Mapa indisponível</strong>
        <span>Confira sua conexão e tente novamente.</span>
      </div>`;
    return;
  }

  activeMobileMap = window.L.map(mapElement, {
    zoomControl: false,
    attributionControl: true
  }).setView(userLocation, 13);

  window.L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(activeMobileMap);
  window.L.control.zoom({ position: 'topright' }).addTo(activeMobileMap);

  activeUserMarker = window.L.marker(userLocation, {
    icon: window.L.divIcon({
      className: 'map-user-marker',
      html: '<span></span>',
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    })
  }).addTo(activeMobileMap).bindPopup('Você está aqui');

  const bounds = [userLocation];
  venues.forEach((venue) => {
    const position = [venue.map.lat, venue.map.lng];
    const marker = window.L.marker(position, {
      icon: window.L.divIcon({
        className: 'map-price-marker',
        html: `<span>${formatCurrency(venue.price).replace(',00', '')}</span>`,
        iconSize: [66, 34],
        iconAnchor: [33, 34]
      })
    }).addTo(activeMobileMap);
    marker.bindPopup(mapPopup(venue), {
      closeButton: false,
      offset: [0, -26],
      minWidth: 228
    });
    bounds.push(position);
  });

  if (bounds.length > 1) {
    activeMobileMap.fitBounds(bounds, {
      paddingTopLeft: [28, 60],
      paddingBottomRight: [28, 80],
      maxZoom: 14
    });
  }
  setTimeout(() => activeMobileMap?.invalidateSize(), 50);
}

/* O indice sai da posicao da rolagem — assim arrastar, clicar num ponto e
   navegar por teclado convergem para o mesmo estado, sem variavel a parte. */
function bindHeroTrack(root, track, total) {
  const dots = () => [...root.querySelectorAll('[data-gallery-index]')];
  const counter = root.querySelector('[data-venue-photo-current]');
  let last = -1;
  const sync = () => {
    const index = Math.min(total - 1, Math.max(0, Math.round(track.scrollLeft / (track.clientWidth || 1))));
    if (index === last) return;
    last = index;
    if (counter) counter.textContent = String(index + 1);
    dots().forEach((dot, i) => dot.classList.toggle('on', i === index));
  };
  // sync() ja sai cedo quando o indice nao mudou, entao nao precisa de rAF.
  track.addEventListener('scroll', sync, { passive: true });
  sync();
}

async function renderVenue(root, route) {
  const venue = await venueService.get(route.params.id);
  if (!venue) {
    location.hash = 'quadras';
    return;
  }
  /* localDateValue() e a mesma data que o dataset recebe logo abaixo: sem
     passar a data aqui, a primeira pintura usava a agenda de "hoje" mesmo
     quando a tela abria em outro dia. */
  const [availability, favoriteIds] = await Promise.all([
    venueService.availability(venue.id, localDateValue()),
    venueService.favoriteIds()
  ]);

  const gallery = Array.isArray(venue.gallery) && venue.gallery.length ? venue.gallery : [venue.image];
  const amenities = [...new Set([...venue.tags, 'Bola inclusa', 'Wi-Fi no local'])];
  const track = root.querySelector('[data-venue-track]');
  track.innerHTML = gallery.map((photo, index) => `
    <img src="${escapeHtml(photo)}" alt="${escapeHtml(venue.name)} — foto ${index + 1}" loading="${index ? 'lazy' : 'eager'}">`).join('');
  bindHeroTrack(root, track, gallery.length);
  root.querySelector('[data-venue-distance]').textContent = `${formatDistance(venue.distance)} km`;
  root.querySelector('[data-venue-name]').textContent = venue.name;
  root.querySelector('[data-venue-meta]').textContent = `${displayText(venue.sport)} - ${displayText(venue.neighborhood)}`;
  root.querySelector('[data-venue-rating]').textContent = venue.rating;
  root.querySelector('[data-venue-reviews]').textContent = `${venue.reviews} avaliações`;
  root.querySelector('[data-venue-price]').textContent = formatCurrency(venue.price);
  root.querySelector('[data-venue-logo]').textContent = venueInitials(venue.name);
  root.querySelector('[data-venue-photo-count]').textContent = gallery.length;
  root.querySelector('[data-venue-photo-current]').textContent = '1';
  root.querySelector('[data-venue-review-rating]').textContent = venue.rating;
  root.querySelector('[data-venue-review-count]').textContent = `${venue.reviews} avaliações verificadas`;
  root.querySelectorAll('.venue-review-stars .ic').forEach((star, index) => {
    star.classList.toggle('is-empty', index >= Math.round(venue.rating));
  });
  root.querySelector('[data-venue-gallery]').innerHTML = gallery.map((photo, index) => `
    <button type="button" class="venue-hero-dot ${index === 0 ? 'on' : ''}"
            data-gallery-index="${index}" aria-label="Ver foto ${index + 1} de ${gallery.length}"></button>`).join('');
  root.querySelector('[data-venue-amenities]').innerHTML = amenities.map((item) => `
    <div class="venue-amenity">
      <span>${icon(amenityIcon(item))}</span>
      <strong>${escapeHtml(displayText(item))}</strong>
    </div>`).join('');
  root.querySelector('[data-venue-review-list]').innerHTML = (venue.reviewItems || []).map((review) => `
    <article class="venue-review">
      <header>
        <span class="venue-review__avatar" aria-hidden="true">${escapeHtml(review.author.slice(0, 1))}</span>
        <div><strong>${escapeHtml(review.author)}</strong><small>${escapeHtml(review.date)}</small></div>
        <span class="venue-review__stars" aria-label="${review.rating} de 5 estrelas">${ratingStars(review.rating)}</span>
      </header>
      <p>${escapeHtml(review.text)}</p>
    </article>`).join('');

  const favoriteButton = root.querySelector('[data-favorite-toggle]');
  /* arenaId no atributo, venue.id na marcacao: o toggle e da arena (e assim
     que o banco guarda), mas o coracao aceso e desta quadra. */
  favoriteButton.dataset.favoriteToggle = venue.arenaId;
  favoriteButton.classList.toggle('on', favoriteIds.includes(venue.id));

  const booking = root.querySelector('[data-booking]');
  booking.dataset.venueId = venue.id;
  booking.dataset.price = venue.price;
  booking.dataset.priceMonthly = venue.priceMonthly || venue.price * 4;
  booking.dataset.planKind = 'avulso';
  booking.dataset.planWeekday = '3';
  booking.dataset.availability = JSON.stringify(availability);
  booking.dataset.duration = '1';
  booking.dataset.hour = '';
  booking.dataset.date = localDateValue();
  booking.dataset.calendarMonth = calendarMonthValue(parseLocalDate(booking.dataset.date));
  renderBookingCalendar(root);
  renderBooking(root);
}

/* Proxima ocorrencia do dia da semana (hoje conta, se ainda nao passou). */
function nextWeekdayDate(weekday) {
  const base = parseLocalDate(localDateValue());
  const delta = (Number(weekday) - base.getDay() + 7) % 7;
  base.setDate(base.getDate() + delta);
  return localDateValue(base);
}

/* Primeira ocorrencia do dia da semana dentro do mes visivel — nunca no
   passado. Mantem a pessoa no mes que ela navegou. */
function firstWeekdayInMonth(weekday, monthValue) {
  const month = calendarMonthDate(monthValue);
  const hoje = parseLocalDate(localDateValue());
  const cursor = new Date(month.getFullYear(), month.getMonth(), 1, 12, 0, 0);
  cursor.setDate(cursor.getDate() + ((Number(weekday) - cursor.getDay() + 7) % 7));
  while (cursor < hoje) cursor.setDate(cursor.getDate() + 7);
  // Se o mes visivel nao tem mais aquele dia, cai na proxima ocorrencia real.
  if (cursor.getMonth() !== month.getMonth()) return nextWeekdayDate(weekday);
  return localDateValue(cursor);
}

const WEEKDAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/* O mensalista cobra por mes (4 sessoes no mesmo dia e horário); o avulso,
   por hora. A duracao multiplica os dois igual, entao o unico que muda e a
   base — o resto do checkout segue identico. */
function planPriceBase(venue, plan) {
  return plan === 'mensalista'
    ? Number(venue.priceMonthly || venue.price * 4)
    : Number(venue.price);
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
  const booking = root.querySelector('[data-booking]');
  if (!booking) return;

  const availability = JSON.parse(booking.dataset.availability || '[]');
  let selectedHour = booking.dataset.hour;
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
  // No mensalista o compromisso e semanal: "ja passou hoje" nao faz sentido —
  // a primeira sessao cai no proximo dia da semana escolhido.
  const isPast = (hour) => booking.dataset.planKind === 'mensalista'
    ? false
    : isPastSlot(hour, booking.dataset.date);

  if (selectedHour && (!canStartAt(Number(selectedHour.slice(0, 2))) || isPast(selectedHour))) {
    selectedHour = '';
    booking.dataset.hour = selectedHour;
  }

  const start = selectedHour ? Number(selectedHour.slice(0, 2)) : -1;

  const groups = [
    ['Manhã', availability.filter((slot) => Number(slot.hour.slice(0, 2)) < 12)],
    ['Tarde', availability.filter((slot) => {
      const hour = Number(slot.hour.slice(0, 2));
      return hour >= 12 && hour < 18;
    })],
    ['Noite', availability.filter((slot) => Number(slot.hour.slice(0, 2)) >= 18)]
  ];
  root.querySelector('[data-slots]').innerHTML = groups.map(([label, slots]) => `
    <div class="avail-group">
      <div class="avail-lbl">${label}</div>
      <div class="avail-slots">${slots.map((slot) => {
        const hour = Number(slot.hour.slice(0, 2));
        const inBlock = selectedHour && hour >= start && hour < start + duration;
        const selected = inBlock && isFreeAt(hour);
        const ocupado = slot.status !== 'free';
        const passou = isPast(slot.hour);
        const cabe = canStartAt(hour);
        const availableStart = cabe && !passou;
        /* Tres estados, e nao dois. Antes, "livre mas nao cabem 3h a partir
           daqui" era pintado igual a "reservado" — num dia inteiramente vazio,
           escolher 3h fazia 21h e 22h parecerem ocupadas so porque a quadra
           fecha as 23h. Ai o bloco 20-22 parecia estar passando por cima de
           reserva. A regra sempre esteve certa; quem mentia era a cor. */
        const estado = ocupado ? 'busy' : passou ? 'past' : cabe ? 'free' : 'nofit';
        const reason = passou
          ? 'Horário já passou'
          : ocupado ? 'Horário ocupado'
          : `Livre, mas não cabem ${duration}h seguidas a partir daqui`;
        return `<button type="button" class="slot ${estado} ${selected ? 'sel' : ''}" data-slot-hour="${slot.hour}" aria-pressed="${Boolean(selectedHour && hour === start)}" ${availableStart ? '' : `disabled title="${reason}"`}>${slot.hour}</button>`;
      }).join('')}</div>
    </div>`).join('');

  root.querySelectorAll('[data-duration]').forEach((button) => {
    const value = Number(button.dataset.duration);
    button.disabled = false;
    button.classList.remove('off');
    button.classList.toggle('on', value === duration);
    button.setAttribute('aria-pressed', String(value === duration));
  });

  const plan = booking.dataset.planKind === 'mensalista' ? 'mensalista' : 'avulso';
  const isMensalista = plan === 'mensalista';
  const weekday = Number(booking.dataset.planWeekday || 3);
  const priceHour = Number(booking.dataset.price || 0);
  const priceMonth = Number(booking.dataset.priceMonthly || priceHour * 4);
  const { subtotal, serviceFee, total } = calculateCheckoutAmounts(
    isMensalista ? priceMonth : priceHour, duration);

  root.querySelectorAll('[data-plan]').forEach((button) => {
    const on = button.dataset.plan === plan;
    button.classList.toggle('on', on);
    button.setAttribute('aria-pressed', String(on));
  });
  root.querySelectorAll('[data-weekday]').forEach((button) => {
    button.classList.toggle('on', Number(button.dataset.weekday) === weekday);
  });

  // O calendario fica nos dois planos: no mensalista ele escolhe a data da
  // PRIMEIRA sessao, com so os dias do plano clicaveis.
  const weekdayBox = root.querySelector('[data-weekday-choice]');
  if (weekdayBox) weekdayBox.hidden = !isMensalista;
  const dayTitle = root.querySelector('[data-step-day-title]');
  if (dayTitle) dayTitle.textContent = isMensalista ? 'Escolha o dia da semana' : 'Escolha o dia';
  const dayHint = root.querySelector('[data-step-day-hint]');
  if (dayHint) {
    dayHint.hidden = !isMensalista;
    dayHint.textContent = `Sua primeira pelada: ${bookingDateLabel(booking.dataset.date)}`;
  }

  const avulsoLabel = root.querySelector('[data-plan-price-avulso]');
  if (avulsoLabel) avulsoLabel.textContent = `${formatCurrency(priceHour)} /hora`;
  const mensalLabel = root.querySelector('[data-plan-price-mensalista]');
  if (mensalLabel) mensalLabel.textContent = `${formatCurrency(priceMonth)} /mês`;
  const saving = root.querySelector('[data-plan-saving]');
  if (saving) {
    const economia = priceHour * 4 - priceMonth;
    saving.textContent = economia > 0 ? `Economize ${formatCurrency(economia)}` : '';
    saving.hidden = economia <= 0;
  }
  const planHelp = root.querySelector('[data-plan-help]');
  if (planHelp) {
    planHelp.textContent = isMensalista
      ? 'A quadra fica reservada toda semana no mesmo horário, e você paga uma vez por mês.'
      : 'Você reserva apenas esta partida. Pode virar mensalista depois.';
  }
  const freeCount = availability.filter((slot) => canStartAt(Number(slot.hour.slice(0, 2))) && !isPast(slot.hour)).length;
  root.querySelector('[data-availability-copy]').textContent = freeCount === 1 ? '1 início livre' : `${freeCount} inícios livres`;
  root.querySelector('[data-duration-help]').textContent = duration === 1
    ? 'Ideal para um treino rápido. Escolha abaixo o melhor início.'
    : `Os horários abaixo já garantem ${duration} horas consecutivas de quadra.`;
  root.querySelector('[data-bk-date]').textContent = isMensalista
    ? `Toda ${WEEKDAY_NAMES[weekday]}`
    : bookingDateLabel(booking.dataset.date);
  root.querySelector('[data-bk-range]').textContent = selectedHour ? `${selectedHour} a ${addHours(selectedHour, duration)}` : 'Escolha um horário';
  root.querySelector('[data-bk-hours]').textContent = selectedHour
    ? (isMensalista ? `(${duration}h por semana)` : `(${duration}h)`)
    : '';
  root.querySelector('[data-bk-sub]').textContent = selectedHour ? formatCurrency(subtotal) : '-';
  const fee = root.querySelector('[data-bk-fee]');
  if (fee) fee.textContent = selectedHour ? formatCurrency(serviceFee) : '-';
  root.querySelector('[data-bk-total]').textContent = selectedHour ? formatCurrency(total) : '-';

  const cta = root.querySelector('[data-bk-cta]');
  cta.classList.toggle('is-disabled', !selectedHour);
  cta.querySelector('[data-bk-cta-label]').textContent = selectedHour ? `Continuar - ${formatCurrency(total)}` : 'Escolha um horário';
  if (selectedHour) {
    const query = new URLSearchParams({
      date: booking.dataset.date || localDateValue(),
      hora: selectedHour,
      dur: String(duration),
      plano: plan
    });
    if (isMensalista) query.set('dia', String(weekday));
    cta.href = `#pagamento/${booking.dataset.venueId}?${query}`;
  } else {
    cta.removeAttribute('href');
  }
}

async function bookingContext(route) {
  const venue = await venueService.get(route.params.id);
  if (!venue) return null;
  const query = routeQuery(route);
  const hour = query.get('hora') || '19:00';
  const duration = Math.max(1, Math.min(3, Number(query.get('dur') || 1)));
  const date = query.get('date') || localDateValue();
  const plan = query.get('plano') === 'mensalista' ? 'mensalista' : 'avulso';
  const weekday = Number(query.get('dia') || 3);
  const amounts = calculateCheckoutAmounts(planPriceBase(venue, plan), duration);
  let quoteAmounts = null;
  if (API_BASE_URL) {
    try {
      quoteAmounts = await venueService.quote({
        quadraId: venue.id,
        data: date,
        hora: hour,
        dur: duration,
        plano: plan
      });
    } catch (error) {
      quoteAmounts = null;
    }
  }
  return {
    venue,
    date,
    plan,
    weekday,
    dateLabel: plan === 'mensalista'
      ? `Toda ${WEEKDAY_NAMES[weekday]}`
      : bookingDateLabel(date),
    hour,
    duration,
    endHour: addHours(hour, duration),
    ...(quoteAmounts || amounts),
    method: PAYMENT_METHOD_LABELS[query.get('metodo')] ? query.get('metodo') : 'pix'
  };
}

function syncMobilePaymentChoice(root, requestedMethod = 'pix') {
  const methods = [...root.querySelectorAll('[data-payment-method]')];
  const selected = methods.find((method) => method.dataset.paymentMethod === requestedMethod && !method.disabled)
    || methods.find((method) => !method.disabled);
  if (!selected) return;

  methods.forEach((method) => {
    const active = method === selected;
    method.classList.toggle('on', active);
    method.setAttribute('aria-pressed', String(active));
  });

  const cta = root.querySelector('[data-payment-cta]');
  const params = new URLSearchParams(cta.dataset.paymentQuery || '');
  params.set('metodo', selected.dataset.paymentMethod);
  cta.href = `${cta.dataset.paymentRoute}?${params}`;
  cta.setAttribute('aria-label', `Enviar solicitação usando ${PAYMENT_METHOD_LABELS[selected.dataset.paymentMethod]}`);
}

async function renderPayment(root, route) {
  const context = await bookingContext(route);
  if (!context) {
    location.hash = 'quadras';
    return;
  }
  const {
    venue,
    date,
    dateLabel,
    hour,
    duration,
    endHour,
    subtotal,
    serviceFee,
    total,
    method
  } = context;
  root.querySelector('[data-back-venue]').href = `#quadra/${venue.id}`;
  root.querySelector('[data-payment-image]').src = venue.image;
  root.querySelector('[data-payment-image]').alt = venue.name;
  root.querySelector('[data-payment-name]').textContent = venue.name;
  root.querySelector('[data-payment-meta]').textContent = `${displayText(venue.sport)} - ${displayText(venue.neighborhood)}`;
  root.querySelector('[data-payment-date]').textContent = dateLabel;
  root.querySelector('[data-payment-hour]').textContent = `${hour} a ${endHour}`;
  const isMensal = context.plan === 'mensalista';
  root.querySelector('[data-payment-duration]').textContent = isMensal
    ? `${duration === 1 ? '1 hora' : duration + ' horas'} por semana`
    : (duration === 1 ? '1 hora' : `${duration} horas`);
  root.querySelector('[data-payment-rent-label]').textContent = isMensal
    ? `Mensalidade da quadra (${duration}h/semana)`
    : `Aluguel da quadra (${duration}h)`;
  root.querySelector('[data-payment-rent]').textContent = formatCurrency(subtotal);
  root.querySelector('[data-payment-fee]').textContent = formatCurrency(serviceFee);
  root.querySelector('[data-payment-total]').textContent = formatCurrency(total);
  const cta = root.querySelector('[data-payment-cta]');
  const confirmationQuery = new URLSearchParams({
    date,
    hora: hour,
    dur: String(duration),
    plano: context.plan,
    deadline: String(Date.now() + APPROVAL_WINDOW_MS)
  });
  const requestedResult = routeQuery(route).get('resultado');
  if (requestedResult) confirmationQuery.set('resultado', requestedResult);
  cta.dataset.paymentRoute = `#confirmado/${venue.id}`;
  cta.dataset.paymentQuery = confirmationQuery.toString();
  cta.querySelector('[data-payment-cta-label]').textContent = `Enviar solicitação - ${formatCurrency(total)}`;

  // Antes de escolher a forma: o cartao so vale se houver adquirente. Como
  // syncMobilePaymentChoice ja pula botao desabilitado, quem chegar aqui com
  // ?metodo=card cai no Pix sozinho, em vez de mandar uma reserva que
  // ninguem consegue cobrar.
  const botaoCartao = root.querySelector('[data-payment-method="card"]');
  if (botaoCartao) {
    const { liberado, salvos, motivo } = await estadoDoCartao();
    botaoCartao.disabled = !liberado;
    botaoCartao.title = liberado ? '' : motivo;
    const nota = botaoCartao.querySelector('[data-payment-method-note]');
    if (nota) {
      nota.textContent = !liberado
        ? 'Em breve'
        : (salvos.length ? rotuloDoCartao(salvos[0]) : 'Cadastre um cartão');
    }
  }

  syncMobilePaymentChoice(root, method === 'wallet' ? 'pix' : method);
}

/* Toda pelada nasce de uma reserva — nunca de um formulario solto.

   Deixar marcar pelada sem reservar transformaria o app numa agenda de
   grupo e a arena nao faturaria nada, que e justamente o oposto do negocio.

   No mensalista a quadra e do clube por um mes inteiro, entao as quatro
   sessoes ja nascem juntas em vez de serem digitadas uma a uma. */
async function criarPeladasDaReserva(context, code) {
  const club = await venueService.myClub();
  const user = await venueService.profile();
  const { venue, plan, hour, duration, date, weekday } = context;

  const sessoes = plan === 'mensalista'
    ? Array.from({ length: 4 }, (_, i) => {
        const d = parseLocalDate(date);
        d.setDate(d.getDate() + i * 7);
        return localDateValue(d);
      })
    : [date];

  const titulo = plan === 'mensalista'
    ? `Pelada de ${WEEKDAY_NAMES[weekday]}`
    : `Jogo na ${venue.name}`;

  for (const dateISO of sessoes) {
    await venueService.savePelada({
      clubId: club ? club.id : null,
      kind: club ? 'clube' : 'avulsa',
      title: titulo,
      venueId: venue.id,
      venueName: venue.name,
      sport: venue.sport,
      dateISO,
      startTime: hour,
      duration: duration * 60,
      maxPlayers: 14,
      organizerId: user.id,
      reservationCode: code,
      plan,
      status: 'agendada',
      attendance: { [user.id]: 'sim' }
    });
  }
  return sessoes.length;
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
    dateLabel,
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
  const content = root.querySelector('[data-approval-content]');
  let settled = false;
  let apiReserva = null;

  const reservationData = {
    code,
    venueId: venue.id,
    date: dateLabel,
    dateValue: date,
    hour,
    endHour,
    duration,
    subtotal,
    serviceFee,
    price: total,
    paymentMethod: method,
    plan: context.plan,
    weekday: context.weekday
  };

  function approvalFlow(state) {
    const rejected = state === 'declined' || state === 'expired';
    const approvalClass = state === 'accepted' ? 'is-done' : rejected ? 'is-error' : 'is-current';
    const confirmationClass = state === 'accepted' ? 'is-current' : '';
    const approvalMarker = state === 'accepted'
      ? icon('check')
      : rejected
        ? icon('x')
        : '3';
    return `
      <ol class="booking-flow booking-flow--confirmation" aria-label="Etapas da reserva">
        <li class="is-done"><span>${icon('check')}</span><small>Horário</small></li>
        <li class="is-done"><span>${icon('check')}</span><small>Pagamento</small></li>
        <li class="${approvalClass}"><span>${approvalMarker}</span><small>Aprovação</small></li>
        <li class="${confirmationClass}"><span>${state === 'accepted' ? '4' : '4'}</span><small>Confirmação</small></li>
      </ol>`;
  }

  function refreshApprovalIcons() {
    window.pqRefreshIcons?.(content);
  }

  function renderPending(remaining) {
    const progress = Math.max(0, Math.min(100, (remaining / APPROVAL_WINDOW_MS) * 100));
    content.innerHTML = `
      ${approvalFlow('pending')}
      <section class="approval-view approval-view--pending">
        ${approvalWaitingVisual()}
        <span class="approval-eyebrow">Solicitação enviada</span>
        <h1>Aguardando a arena</h1>
        <p><strong>${escapeHtml(venue.name)}</strong> tem até 15 minutos para aceitar o seu horário.</p>

        <div class="approval-timer">
          <div><span>Tempo restante</span><strong data-approval-countdown>${formatApprovalCountdown(remaining)}</strong></div>
          <div class="approval-progress" aria-hidden="true"><span data-approval-progress style="width:${progress}%"></span></div>
        </div>

        <div class="approval-reservation">
          <img src="${escapeHtml(venue.image)}" alt="${escapeHtml(venue.name)}">
          <div><strong>${escapeHtml(dateLabel)}</strong><span>${hour} a ${endHour} · ${duration}h</span></div>
          <b>${formatCurrency(total)}</b>
        </div>

        <div class="approval-payment-note">
          ${icon('shield-check')}
          <span><strong>Pagamento protegido</strong><small>A cobrança só será concluída depois que a arena aceitar.</small></span>
        </div>
        <a href="#reservas" class="btn outline block">Acompanhar em minhas reservas</a>
      </section>`;
    refreshApprovalIcons();
  }

  async function renderAccepted() {
    if (settled) return;
    settled = true;
    clearInterval(activeMobileApprovalTimer);
    await venueService.saveReservation({
      ...reservationData,
      status: 'Confirmada',
      statusClass: 'pago',
      group: 'proxima'
    });
    // So aqui, e nao ao enviar o pedido: reserva recusada nao pode deixar
    // pelada fantasma no clube.
    await criarPeladasDaReserva(context, code);
    const conversation = await venueService.ensureConversationForVenue(venue);
    document.title = 'Reserva confirmada - Qadras';
    content.innerHTML = `
      ${approvalFlow('accepted')}
      <div class="success approval-view approval-view--accepted">
        <div class="ring">${icon('check')}</div>
        <span class="success-eyebrow">Arena aprovou sua solicitação</span>
        <h2>Reserva confirmada</h2>
        <p>Seu horário está garantido. Agora é só reunir a turma e jogar.</p>

        <div class="ticket">
          <div class="ticket-venue">
            <img src="${escapeHtml(venue.image)}" alt="${escapeHtml(venue.name)}">
            <div><span>Partida confirmada</span><h3>${escapeHtml(venue.name)}</h3><p>${escapeHtml(displayText(venue.sport))} - ${escapeHtml(displayText(venue.neighborhood))}</p></div>
          </div>
          <div class="ticket-details">
            <div class="row"><span class="k">Data</span><span class="v">${escapeHtml(dateLabel)}</span></div>
            <div class="row"><span class="k">Horário</span><span class="v">${hour} a ${endHour} (${duration}h)</span></div>
            <div class="row"><span class="k">Pagamento</span><span class="v">${PAYMENT_METHOD_LABELS[method]}</span></div>
            <div class="row"><span class="k">Aluguel</span><span class="v">${formatCurrency(subtotal)}</span></div>
            <div class="row"><span class="k">Taxa de serviço</span><span class="v">${formatCurrency(serviceFee)}</span></div>
            <div class="row"><span class="k">Total pago</span><span class="v">${formatCurrency(total)}</span></div>
          </div>
          <button class="booking-code" type="button" data-copy="${code}" data-copy-msg="Código da reserva copiado">
            <span><small>Código da reserva</small><strong>${code}</strong></span>
            ${icon('copy')}
          </button>
        </div>

        <div class="confirmation-actions">
          <a href="#reservas" class="btn block">Ver minhas reservas</a>
          ${conversation ? `<a href="#mensagens/${conversation.id}" class="btn outline block">${icon('message-circle')}Falar com a arena</a>` : ''}
          <a href="#quadras" class="btn outline block">Reservar outra quadra</a>
        </div>
      </div>`;
    refreshApprovalIcons();
  }

  async function renderRejected(reason = 'declined') {
    if (settled) return;
    settled = true;
    clearInterval(activeMobileApprovalTimer);
    await venueService.saveReservation({
      ...reservationData,
      status: reason === 'expired' ? 'Tempo expirado' : 'Não aceita pela arena',
      statusClass: 'cancelado',
      group: 'historico'
    });
    const expired = reason === 'expired';
    document.title = 'Reserva não confirmada - Qadras';
    content.innerHTML = `
      ${approvalFlow(expired ? 'expired' : 'declined')}
      <section class="approval-view approval-view--rejected">
        <div class="approval-symbol">${icon(expired ? 'clock-alert' : 'calendar-x-2')}</div>
        <span class="approval-eyebrow">${expired ? 'Tempo de resposta encerrado' : 'Arena não aceitou'}</span>
        <h1>${expired ? 'A solicitação expirou' : 'O horário não foi confirmado'}</h1>
        <p>${expired
          ? 'A arena não respondeu dentro de 15 minutos.'
          : 'A arena não conseguiu atender esse horário.'} Nenhuma cobrança foi realizada.</p>

        <div class="approval-payment-note">
          ${icon('badge-check')}
          <span><strong>Seu pagamento está seguro</strong><small>O valor foi liberado automaticamente para você.</small></span>
        </div>

        <div class="approval-recovery-actions">
          <a href="#quadra/${venue.id}" class="btn block">Escolher outro horário</a>
          <a href="#quadras" class="btn outline block">Procurar outra quadra</a>
        </div>
      </section>`;
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
  document.title = 'Aguardando aprovação - Qadras';
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
      clearInterval(activeMobileApprovalTimer);
      return;
    }
    const remaining = deadline - Date.now();
    const elapsed = APPROVAL_WINDOW_MS - remaining;
    const countdown = content.querySelector('[data-approval-countdown]');
    const progress = content.querySelector('[data-approval-progress]');
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

  activeMobileApprovalTimer = window.setInterval(tickApproval, 1000);
  await tickApproval();
}

/* Um plano mensalista sao 4 sessoes, mas UMA assinatura. Listar as quatro
   soltas junto das avulsas escondia justamente o que a pessoa quer saber:
   qual e o compromisso e quando e a proxima. */
function planoCard(plano) {
  const proxima = plano.sessoes.find((sessao) => sessao.dateISO >= localDateValue());
  const restantes = plano.sessoes.filter((sessao) => sessao.dateISO >= localDateValue()).length;
  return `<article class="plan-card">
    <div class="plan-card__head">
      <span class="plan-card__tag">Mensalista</span>
      <strong>${escapeHtml(plano.venueName)}</strong>
    </div>
    <div class="plan-card__when">
      ${icon('repeat')}
      <span>Toda ${WEEKDAY_NAMES[plano.weekday]} às ${escapeHtml(plano.startTime)}</span>
    </div>
    <div class="plan-card__next">
      <div>
        <small>Próxima pelada</small>
        <strong>${proxima ? peladaDateLabel(proxima) : 'Nenhuma agendada'}</strong>
      </div>
      <div>
        <small>Restam no mês</small>
        <strong>${restantes} de ${plano.sessoes.length}</strong>
      </div>
    </div>
    <ol class="plan-card__sessions">
      ${plano.sessoes.map((sessao) => {
        const passou = sessao.dateISO < localDateValue();
        return `<li class="${passou ? 'is-done' : ''}">
          <span>${peladaDateLabel(sessao)}</span>
          <em>${escapeHtml(sessao.startTime)}</em>
        </li>`;
      }).join('')}
    </ol>
  </article>`;
}

async function renderReservations(root) {
  const [reservations, venues, peladas] = await Promise.all([
    venueService.reservations(),
    venueService.list(),
    venueService.peladas()
  ]);

  // Agrupa as sessoes de mensalista pela reserva que as gerou.
  const planos = new Map();
  peladas.filter((p) => p.plan === 'mensalista' && p.reservationCode).forEach((p) => {
    const atual = planos.get(p.reservationCode) || {
      venueName: p.venueName,
      startTime: p.startTime,
      weekday: parseLocalDate(p.dateISO).getDay(),
      sessoes: []
    };
    atual.sessoes.push(p);
    planos.set(p.reservationCode, atual);
  });
  planos.forEach((plano) => plano.sessoes.sort((a, b) => a.dateISO.localeCompare(b.dateISO)));

  const planosBox = root.querySelector('[data-plan-list]');
  const planosHead = root.querySelector('[data-plan-head]');
  if (planosBox) {
    planosBox.innerHTML = [...planos.values()].map(planoCard).join('');
    if (planosHead) planosHead.hidden = planos.size === 0;
  }

  const list = root.querySelector('[data-reservation-list]');
  // A reserva que virou plano ja aparece no card do plano.
  list.innerHTML = reservations
    .filter((reservation) => !planos.has(reservation.code))
    .map((reservation) => {
      const venue = venues.find((item) => item.id === reservation.venueId);
      return venue ? reservationCard(reservation, venue) : '';
    }).join('');
}

async function renderFavorites(root) {
  const venues = await venueService.favorites();
  const list = root.querySelector('[data-favorites-list]');
  list.innerHTML = venues.length
    ? venues.map((venue) => venueCard(venue, { removable: true })).join('')
    : `<div class="empty">
        <div class="empty-ic">${icon('heart', 'ic lg')}</div>
        <h3>Nenhum favorito ainda</h3>
        <p>Toque no coração de uma quadra para salvá-la aqui.</p>
        <a href="#quadras" class="btn block">Explorar quadras</a>
      </div>`;
}

/* Formas de pagamento — o que existe de verdade, e nada alem disso.

   Antes esta funcao era vazia e a tela era markup fixo com um "Visa final
   4321". Agora a lista vem de /api/carteira: enquanto nao houver adquirente,
   o servidor responde cartaoDisponivel:false e a tela explica isso em vez de
   fingir um cartao salvo. */
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

async function renderWallet(root) {
  const lista = root.querySelector('[data-payment-list]');
  const aviso = root.querySelector('[data-card-status]');
  if (!lista) return;

  const { liberado, salvos, motivo } = await estadoDoCartao();

  lista.querySelectorAll('[data-card-row]').forEach((linha) => linha.remove());
  salvos.forEach((cartao) => {
    lista.insertAdjacentHTML('beforeend', `
      <div class="payment-row" data-card-row>
        <span class="badge-ic"><i class="ic" data-lucide="credit-card"></i></span>
        <span><strong>${escapeHtml(rotuloDoCartao(cartao))}</strong><small>Cartão salvo</small></span>
      </div>`);
  });

  if (aviso) {
    aviso.hidden = liberado && salvos.length > 0;
    aviso.innerHTML = `<i class="ic" data-lucide="credit-card"></i><span>${escapeHtml(
      liberado ? 'Nenhum cartão cadastrado ainda.' : motivo
    )}</span>`;
  }
  window.lucide?.createIcons?.({ nameAttr: 'data-lucide' });
}

/* Sobrou so como destino honesto de um link antigo. O formulario que existia
   aqui pedia numero e CVV, descartava e respondia "Cartao adicionado com
   sucesso" — pedir cartao de verdade sem ter onde guardar e o tipo de coisa
   que nao volta atras depois que alguem digita. */
async function renderWalletAction(root, route) {
  const title = root.querySelector('[data-wallet-action-title]');
  const content = root.querySelector('[data-wallet-action-content]');
  const { motivo } = await estadoDoCartao();

  if (title) title.textContent = 'Cartão de crédito';
  if (content) {
    content.innerHTML = `
      <div class="empty-state">
        <i class="ic" data-lucide="credit-card"></i>
        <h3>Ainda não dá para salvar cartão</h3>
        <p>${escapeHtml(motivo)}</p>
        <a class="btn block" href="#carteira">Voltar</a>
      </div>`;
    window.lucide?.createIcons?.({ nameAttr: 'data-lucide' });
  }
  void route;
}

function syncMobileProfile(root, user) {
  if (!root?.querySelector('[data-profile-name]')) return;
  const avatar = root.querySelector('[data-profile-avatar]');
  if (avatar) {
    avatar.classList.toggle('has-photo', Boolean(user.photo));
    avatar.innerHTML = user.photo
      ? `<img src="${escapeHtml(user.photo)}" alt="Foto de ${escapeHtml(user.name)}" referrerpolicy="no-referrer">`
      : escapeHtml(user.name.slice(0, 1));
  }
  root.querySelector('[data-profile-name]').textContent = user.name;
  root.querySelector('[data-profile-since]').textContent = `Jogador desde ${user.memberSince}`;
  root.querySelector('[data-profile-city]').textContent = user.city;
  root.querySelector('[data-profile-games]').textContent = user.stats.games;
  root.querySelector('[data-profile-reservations]').textContent = user.stats.reservations;
  root.querySelector('[data-profile-favorites]').textContent = user.stats.favorites;
  root.querySelector('[data-profile-sport]').textContent = user.favoriteSport || '';
  // Conta nova ainda nao tem esporte favorito; o rotulo sozinho parece bug.
  const linhaEsporte = root.querySelector('.favorite-sport');
  if (linhaEsporte) linhaEsporte.hidden = !user.favoriteSport;

  // Ficha de jogador. O cracha do topo mostra a posicao; antes era a palavra
  // "Jogador" escrita na mao no HTML.
  const nivel = LEVELS.find((l) => l.id === user.level);
  const set = (sel, valor) => {
    const el = root.querySelector(sel);
    if (el) el.textContent = valor;
  };
  set('[data-profile-position]', user.position || 'Jogador');
  set('[data-profile-position-value]', user.position || '—');
  set('[data-profile-level]', nivel ? nivel.label : '—');
  set('[data-profile-birth]', formatBirthDate(user.birthDate));
  set('[data-profile-foot]', user.foot || '—');

  // O empurrao so aparece enquanto falta alguma coisa: aviso permanente vira
  // decoração e para de ser lido.
  const faltando = !user.position || !user.level || !user.birthDate || !user.foot;
  const dica = root.querySelector('[data-profile-card-hint]');
  if (dica) dica.hidden = !faltando;

  // Folha da CONTA: quem a pessoa e no cadastro.
  const form = root.querySelector('[data-profile-edit-form]');
  if (form) {
    form.elements.name.value = user.name;
    form.elements.email.value = user.email;
    form.elements.phone.value = user.phone;
    form.elements.city.value = user.city;
  }

  /* Folha da FICHA: como a pessoa joga. Os selects sao montados aqui porque
     as folhas vivem fora do fragmento da rota — mesmo motivo de
     fillSportOptions. Fora do bloco acima de proposito: sao formularios
     diferentes e um nao pode depender do outro existir. */
  const opcoes = (sel, itens, atual, vazio) => {
    const campo = root.querySelector(sel);
    if (!campo) return;
    campo.innerHTML = `<option value="">${vazio}</option>` + itens.map((i) => {
      const valor = typeof i === 'string' ? i : i.id;
      const rotulo = typeof i === 'string' ? i : (i.label || i.id);
      return `<option value="${escapeHtml(valor)}"${valor === atual ? ' selected' : ''}>${escapeHtml(rotulo)}</option>`;
    }).join('');
  };
  opcoes('[data-profile-positions]', POSITIONS, user.position || '', 'Não informado');
  opcoes('[data-profile-levels]', LEVELS, user.level || '', 'Não informado');
  opcoes('[data-profile-feet]', FEET, user.foot || '', 'Não informado');

  const cardForm = root.querySelector('[data-player-card-form]');
  if (cardForm?.elements.birthDate) {
    const campo = cardForm.elements.birthDate;
    campo.value = user.birthDate || '';
    /* Teto no dia de hoje: ninguem nasceu amanha, e sem isso o seletor
       nativo deixava rolar para o futuro. */
    if (campo.dataset.maxHoje !== undefined) campo.max = localDateValue();
  }
}

/* '1994-03-27' -> '27/03/1994'. Guardamos ISO porque <input type="date">
   fala ISO; quem le prefere o formato daqui. */
function formatBirthDate(iso) {
  if (!iso) return '—';
  const [a, m, d] = String(iso).split('-');
  return d ? `${d}/${m}/${a}` : iso;
}

async function renderProfile(root) {
  const user = await venueService.profile();
  syncMobileProfile(root, user);
}

async function renderMessages(root, route) {
  const conversations = await venueService.conversations();
  const conversationId = String(route.params.id || '');
  const active = conversations.find((item) => String(item.id) === String(conversationId));
  const list = root.querySelector('[data-conversation-list]');
  const thread = root.querySelector('[data-conversation-thread]');
  const navbar = root.querySelector('.messages-navbar');
  if (navbar) navbar.hidden = Boolean(active);

  if (!active) {
    list.hidden = false;
    thread.hidden = true;
    list.innerHTML = conversations.map((conversation) => {
      const last = conversation.messages.at(-1);
      return `
        <a class="mobile-conversation" href="#mensagens/${conversation.id}">
          <span class="conversation-avatar">${escapeHtml(conversation.venue.slice(0, 1))}</span>
          <span class="conversation-main">
            <span class="conversation-top"><strong>${escapeHtml(conversation.venue)}</strong><small>${escapeHtml(last?.time || '')}</small></span>
            <span class="conversation-preview">${escapeHtml(last?.text || 'Sem mensagens')}</span>
          </span>
          ${icon('chevron-right')}
        </a>`;
    }).join('');
    return;
  }

  list.hidden = true;
  thread.hidden = false;
  thread.innerHTML = `
    <div class="thread-head mobile-thread-head">
      <a class="icon-btn" href="#mensagens" aria-label="Voltar">${icon('chevron-left')}</a>
      <span class="conversation-avatar">${escapeHtml(active.venue.slice(0, 1))}</span>
      <div><strong>${escapeHtml(active.venue)}</strong><small>${escapeHtml(active.subject)}</small></div>
    </div>
    <div class="mobile-bubbles" data-mobile-bubbles>
      ${active.messages.map((message) => `
        <div class="bubble ${message.from === 'player' ? 'me' : 'them'}">
          <div class="bub-txt">${escapeHtml(message.text)}</div>
          <div class="bub-time">${escapeHtml(message.time)}</div>
        </div>`).join('')}
    </div>
    <form class="mobile-composer" data-message-form data-conversation-id="${active.id}">
      <input type="text" name="message" placeholder="Escreva uma mensagem..." autocomplete="off" required>
      <button type="submit" aria-label="Enviar">${icon('send')}</button>
    </form>`;
  const bubbles = thread.querySelector('[data-mobile-bubbles]');
  bubbles.scrollTop = bubbles.scrollHeight;
}

/* ══════════════════ Entrar / criar conta ══════════════════ */

/* Guarda o passo do onboarding entre renders, pelo mesmo motivo de
   clubSection: o render roda de novo e nao pode arrancar a pessoa do meio. */
let onbStep = 1;
let onbEscolha = { position: '', level: '' };

function renderAuth(root, route) {
  // A barra de baixo pertence a tela. "none" porque nao ha barra nenhuma
  // aqui — a regra html[data-bottombar] .tabbar {display:none} ja casa com
  // qualquer valor, e contextbar--none nao existe.
  document.documentElement.dataset.bottombar = 'none';

  if (authService.hasSession()) {
    location.replace(`#${safeNext(route)}`);
    return;
  }

  // O next precisa sobreviver a troca entre entrar e cadastro, senao quem
  // errou a tela volta para a home em vez do checkout que estava montando.
  const next = route?.query?.get('next');
  if (next) {
    root.querySelectorAll('[data-auth-swap]').forEach((link) => {
      const destino = link.getAttribute('href').replace(/^#/, '').split('?')[0];
      link.setAttribute('href', `#${destino}?next=${encodeURIComponent(next)}`);
    });
  }

  window.pqRefreshIcons?.(root);
}

/* Depois de entrar: quem acabou de criar conta passa pelo onboarding, quem
   ja tinha volta direto para onde estava indo. */
function goAfterAuth(route, isNew) {
  const destino = safeNext(route);
  location.replace(isNew || authService.needsOnboarding()
    ? `#onboarding?next=${encodeURIComponent(destino)}`
    : `#${destino}`);
}

/* ══════════════════ Onboarding ══════════════════ */

function onbPaint(root) {
  root.querySelectorAll('[data-onb-step]').forEach((secao) => {
    secao.hidden = Number(secao.dataset.onbStep) !== onbStep;
  });

  const barra = root.querySelector('[data-onb-bar]');
  if (barra) barra.style.width = `${(onbStep / 4) * 100}%`;
  root.querySelector('.onb-progress')?.setAttribute('aria-valuenow', String(onbStep));

  const voltar = root.querySelector('[data-onb-back]');
  if (voltar) voltar.hidden = onbStep === 1;

  // O botao de cada passo so libera com a escolha feita.
  const passo1 = root.querySelector('[data-onb-step="1"] [data-onb-next]');
  if (passo1) passo1.disabled = !onbEscolha.favoriteSport;
  const passo2 = root.querySelector('[data-onb-step="2"] [data-onb-next]');
  /* Tenis e individual: nao tem posicao, entao o passo libera sem escolha.
     Exigir aqui prenderia a pessoa num passo sem opcao nenhuma. */
  if (passo2) passo2.disabled = posicoesDe(onbEscolha.favoriteSport).length > 0 && !onbEscolha.position;
  const passo3 = root.querySelector('[data-onb-step="3"] [data-onb-next]');
  if (passo3) passo3.disabled = !onbEscolha.level;

  const resumo = root.querySelector('[data-onb-summary]');
  if (resumo && onbStep === 4) {
    const nivel = LEVELS.find((l) => l.id === onbEscolha.level);
    resumo.textContent = [onbEscolha.favoriteSport, onbEscolha.position, nivel && nivel.label]
      .filter(Boolean).join(' · ');
  }
}

/* As posicoes dependem da modalidade escolhida no passo anterior. Tenis nao
   tem posicao (individual): nesse caso o passo mostra um aviso curto em vez
   de uma lista vazia. */
function pintarPosicoesOnb(root) {
  const caixa = root.querySelector('[data-onb-positions]');
  if (!caixa) return;
  const lista = posicoesDe(onbEscolha.favoriteSport);
  const titulo = root.querySelector('[data-onb-titulo-posicao]');
  if (titulo) {
    titulo.textContent = onbEscolha.favoriteSport
      ? `Onde você joga no ${onbEscolha.favoriteSport}?`
      : 'Onde você joga?';
  }
  if (!lista.length) {
    caixa.innerHTML = '<p class="onb-vazio">Essa modalidade é individual — não tem posição.</p>';
    return;
  }
  caixa.innerHTML = lista.map((p) => `<label>
      <input type="radio" name="onb-position" value="${escapeHtml(p.id)}"${p.id === onbEscolha.position ? ' checked' : ''}>
      <span><i class="ic" data-lucide="${escapeHtml(p.icon)}"></i>${escapeHtml(p.id)}</span>
    </label>`).join('');
  window.pqRefreshIcons?.(caixa);
}

function renderOnboarding(root, route) {
  document.documentElement.dataset.bottombar = 'none';

  if (!authService.hasSession()) {
    location.replace(authHashFor('onboarding'));
    return;
  }

  onbStep = 1;
  const user = authService.currentUser() || {};
  onbEscolha = {
    favoriteSport: user.favoriteSport || '',
    position: user.position || '',
    level: user.level || ''
  };

  const esportes = root.querySelector('[data-onb-esportes]');
  if (esportes) {
    esportes.innerHTML = MODALIDADES.map((e) => `<label>
      <input type="radio" name="onb-sport" value="${escapeHtml(e)}"${e === onbEscolha.favoriteSport ? ' checked' : ''}>
      <span>${escapeHtml(e)}</span>
    </label>`).join('');
  }

  pintarPosicoesOnb(root);

  const niveis = root.querySelector('[data-onb-levels]');
  if (niveis) {
    niveis.innerHTML = LEVELS.map((l) => `<label>
      <input type="radio" name="onb-level" value="${escapeHtml(l.id)}"${l.id === onbEscolha.level ? ' checked' : ''}>
      <span><strong>${escapeHtml(l.label)}</strong><small>${escapeHtml(l.hint)}</small></span>
    </label>`).join('');
  }

  /* O "Depois" saiu: com o onboarding obrigatorio, ele virava armadilha —
     levava para outra rota e o guard devolvia a pessoa para ca no mesmo
     instante, parecendo tela travada. */

  onbPaint(root);
  window.pqRefreshIcons?.(root);
}

/* ══════════════════ Busca de clube ══════════════════ */

async function renderClubSearch(root, route) {
  const lista = root.querySelector('[data-club-results]');
  if (!lista) return;

  // Aceita ?codigo= do convite e ?q= da busca. A URL e a unica fonte de
  // verdade, igual em renderExplore.
  const termo = route.query.get('q') || route.query.get('codigo') || '';
  const campo = root.querySelector('[data-search-form] input[name="q"]');
  if (campo) campo.value = termo;

  if (!termo.trim()) {
    lista.innerHTML = `<div class="empty">
      <span class="empty-ic"><i class="ic" data-lucide="search"></i></span>
      <h3>Ache seu time</h3>
      <p>Busque pelo nome do clube ou cole o código que mandaram no grupo.</p>
    </div>`;
    window.pqRefreshIcons?.(root);
    return;
  }

  const [clubes, meu] = await Promise.all([venueService.clubs(), venueService.myClub()]);
  const alvo = normalizeSearch(termo);
  const alvoCodigo = alvo.replace(/[^a-z0-9]/g, '');

  const achados = clubes.filter((club) => {
    if (meu && club.id === meu.id) return false;
    // Codigo casa EXATO, nunca por pedaco: codigo e identidade, nao palavra
    // chave. Busca parcial vazaria quais codigos existem.
    if (club.code && normalizeSearch(club.code) === alvoCodigo) return true;
    return normalizeSearch(club.name).includes(alvo);
  });

  lista.innerHTML = achados.length
    ? achados.map((club) => `<article class="payment-row club-hit">
        <span class="badge-ic">${escapeHtml(club.name.charAt(0).toUpperCase())}</span>
        <span>
          <strong>${escapeHtml(club.name)}</strong>
          <small>${escapeHtml(club.sport)} &middot; ${escapeHtml(club.city)} &middot; ${club.members.length} no time</small>
        </span>
        <button class="btn btn-xs" type="button"
                data-club-join="${club.id}"
                data-requires-auth="clubes?codigo=${escapeHtml(club.code || '')}">Entrar</button>
      </article>`).join('')
    : `<div class="empty">
        <span class="empty-ic"><i class="ic" data-lucide="search-x"></i></span>
        <h3>Nenhum clube com esse nome ou código</h3>
        <p>Confira o código com quem te chamou, ou crie o seu.</p>
        <button class="btn block" type="button" data-sheet-open="club-edit-sheet" data-requires-auth="clube">Criar meu clube</button>
      </div>`;

  window.pqRefreshIcons?.(root);
}

export async function renderMobilePage(route, root) {
  if (activeMobileApprovalTimer) {
    clearInterval(activeMobileApprovalTimer);
    activeMobileApprovalTimer = null;
  }
  if (activeMobileMap) {
    activeMobileMap.remove();
    activeMobileMap = null;
    activeUserMarker = null;
  }
  if (route.name !== 'home') stopGameCardTicker();
  // A barra de baixo pertence a tela, nao ao app: toda rota comeca sem ela e
  // quem precisa (renderGame / renderClub) reescreve o atributo.
  delete document.documentElement.dataset.bottombar;
  // Zera a secao do clube so ao ENTRAR na rota. renderClub roda de novo a cada
  // voto de presenca e a cada formulario enviado — zerar la arrancaria a
  // pessoa de Membros no meio do uso.
  if (route.name !== 'clube') clubSection = 'peladas';
  currentRoute = route;
  const renderers = {
    home: renderHome,
    quadras: renderExplore,
    mapa: renderMap,
    quadra: renderVenue,
    pagamento: renderPayment,
    confirmado: renderConfirmation,
    reservas: renderReservations,
    favoritos: renderFavorites,
    carteira: renderWallet,
    carteiraAcao: renderWalletAction,
    perfil: renderProfile,
    config: async () => {},
    mensagens: renderMessages,
    clube: renderClub,
    game: renderGame,
    entrar: renderAuth,
    cadastro: renderAuth,
    onboarding: renderOnboarding,
    clubes: renderClubSearch
  };
  // O percentual da taxa aparece em texto corrido; preencher aqui evita
  // "9%" escrito na mao voltando a divergir da constante.
  root.querySelectorAll('[data-fee-pct]').forEach((el) => {
    el.textContent = String(Math.round(SERVICE_FEE_RATE * 100));
  });
  await renderers[route.name]?.(root, route);
  syncMarketplaceState(document);
}

export function initMobileActions() {
  if (!document.querySelector('[data-route-view]')) return;

  /* Gate de acao — para o que NAO e navegacao (abrir a folha de criar clube,
     entrar num clube). Navegação ja e coberta pela guarda de rota no app.js.

     Fase de CAPTURA, e nao bolha: o caminho de um clique e
     document(capture) -> alvo -> document(bubble), e todos os outros
     handlers deste arquivo e do ui.js estao na bolha do document. Em bolha,
     a folha de criar clube abriria antes do gate barrar, e a pessoa veria o
     formulario piscar e sumir. */
  document.addEventListener('click', (event) => {
    const alvo = event.target.closest('[data-requires-auth]');
    if (!alvo || !requiresLogin() || authService.hasSession()) return;
    event.preventDefault();
    event.stopPropagation();
    window.pqToast?.('Entre na sua conta para continuar');
    location.hash = authHashFor(alvo.dataset.requiresAuth || location.hash);
  }, true);

  document.addEventListener('click', async (event) => {
    const view = document.querySelector('[data-route-view]');

    const google = event.target.closest('[data-google-login]');
    if (google) {
      google.setAttribute('disabled', 'disabled');
      try {
        const session = await authService.loginWithGoogle();
        goAfterAuth(currentRoute, session.isNew);
      } catch (error) {
        window.pqToast?.(error.message || 'Não foi possível entrar com o Google');
      } finally {
        google.removeAttribute('disabled');
      }
      return;
    }

    const onbNext = event.target.closest('[data-onb-next]');
    if (onbNext) {
      onbStep = Math.min(4, onbStep + 1);
      view?.querySelector('[data-onb-step]')?.closest('.onb-page')
        ?.classList.remove('onb-page--back');
      onbPaint(view);
      return;
    }

    const onbBack = event.target.closest('[data-onb-back]');
    if (onbBack) {
      onbStep = Math.max(1, onbStep - 1);
      // A classe inverte o sentido da animacao: voltar entra pela esquerda.
      view?.querySelector('.onb-page')?.classList.add('onb-page--back');
      onbPaint(view);
      return;
    }

    const onbFinish = event.target.closest('[data-onb-finish]');
    if (onbFinish) {
      await authService.completeOnboarding(onbEscolha);
      await venueService.saveProfile(onbEscolha);
      location.replace(`#${safeNext(currentRoute)}`);
      return;
    }

  });

  /* A escolha do onboarding acende o botao do passo. */
  document.addEventListener('change', (event) => {
    const radio = event.target.closest('[data-onb-esportes] input, [data-onb-positions] input, [data-onb-levels] input');
    if (!radio) return;
    const campo = { 'onb-sport': 'favoriteSport', 'onb-position': 'position' }[radio.name] || 'level';
    onbEscolha = { ...onbEscolha, [campo]: radio.value };
    const raiz = document.querySelector('[data-route-view]');
    if (campo === 'favoriteSport') {
      /* Trocar de modalidade invalida a posicao anterior: "Fixo" nao existe no
         volei. Limpa e repinta com a lista certa. */
      onbEscolha.position = '';
      pintarPosicoesOnb(raiz);
    }
    onbPaint(raiz);
  });

  document.addEventListener('submit', async (event) => {
    const search = event.target.closest('[data-search-form]');
    if (search) {
      event.preventDefault();
      const query = new URLSearchParams(new FormData(search));
      for (const [key, value] of [...query]) {
        if (!String(value).trim()) query.delete(key);
      }
      // Opt-in: sem o atributo continua indo para quadras, que e o que os
      // dois formularios existentes esperam.
      const alvo = search.dataset.searchTarget || 'quadras';
      location.hash = `${alvo}${query.toString() ? `?${query}` : ''}`;
      return;
    }

    const filter = event.target.closest('[data-filter-form]');
    if (filter) {
      event.preventDefault();
      const data = new FormData(filter);
      const query = new URLSearchParams();
      const sport = data.get('esporte');
      // "Personalizado" manda o valor da barra em vez do preset.
      const radius = data.get('raio') === 'custom' ? data.get('raioKm') : data.get('raio');
      const now = data.get('agora');
      const currentQuery = routeQuery(currentRoute);
      const term = currentQuery.get('q');
      if (sport) query.set('esporte', sport);
      if (radius) query.set('raio', radius);
      if (now) query.set('agora', '1');
      if (term) query.set('q', term);
      // Preserva o local da URL. Sobrescrever com o localStorage trocava em
      // silencio a cidade que a pessoa tinha escolhido.
      query.set('local', currentQuery.get('local') || currentLocation());
      closeMarketSheet(filter.closest('[data-market-sheet]'));
      location.hash = `quadras?${query}`;
      return;
    }

    const profileForm = event.target.closest('[data-profile-edit-form]');
    if (profileForm) {
      event.preventDefault();
      if (!profileForm.reportValidity()) return;
      const data = new FormData(profileForm);
      const saved = await venueService.saveProfile({
        name: String(data.get('name') || '').trim(),
        email: String(data.get('email') || '').trim(),
        phone: String(data.get('phone') || '').trim(),
        city: String(data.get('city') || '').trim()
      });
      const view = document.querySelector('[data-route-view]');
      syncMobileProfile(view, saved);
      closeMarketSheet(profileForm.closest('[data-market-sheet]'));
      window.pqToast?.('Perfil atualizado');
      return;
    }

    /* A ficha tem folha propria. Posicao vale dobrado: alem do cracha do
       topo, e o que o registro de membro do clube passa a espelhar. */
    const cardForm = event.target.closest('[data-player-card-form]');
    if (cardForm) {
      event.preventDefault();
      const data = new FormData(cardForm);
      const saved = await venueService.saveProfile({
        position: String(data.get('position') || ''),
        level: String(data.get('level') || ''),
        birthDate: String(data.get('birthDate') || ''),
        foot: String(data.get('foot') || '')
      });
      const view = document.querySelector('[data-route-view]');
      syncMobileProfile(view, saved);
      closeMarketSheet(cardForm.closest('[data-market-sheet]'));
      window.pqToast?.('Ficha atualizada');
      return;
    }

    const clubForm = event.target.closest('[data-club-form]');
    if (clubForm) {
      event.preventDefault();
      if (!clubForm.reportValidity()) return;
      const data = new FormData(clubForm);
      const user = await venueService.profile();
      const id = Number(data.get('id')) || null;
      const saved = await venueService.saveClub({
        id,
        name: String(data.get('name') || '').trim(),
        sport: String(data.get('sport') || ''),
        city: String(data.get('city') || '').trim(),
        description: String(data.get('description') || '').trim(),
        createdBy: user.id,
        // Quem cria entra como dono; edição preserva os membros existentes.
        members: id ? undefined : [{
          id: user.id,
          name: user.name,
          role: 'dono',
          // Do perfil, nao de um valor escrito na mao: e o perfil que manda
          // em quem a pessoa e. (Antes aqui havia um ternario com os dois
          // ramos devolvendo 'Jogador'.)
          position: user.position || 'Jogador',
          rating: user.rating ?? null,
          since: mesAno()
        }]
      });
      closeMarketSheet(clubForm.closest('[data-market-sheet]'));
      window.pqToast?.(id ? 'Clube atualizado' : `${saved.name} criado!`);
      const view = document.querySelector('[data-route-view]');
      await renderClub(view);
      window.pqRefreshIcons?.(view);
      return;
    }

    const clubChatForm = event.target.closest('[data-club-chat-form]');
    if (clubChatForm) {
      event.preventDefault();
      const input = clubChatForm.elements.message;
      const text = input.value.trim();
      if (!text) return;
      const [user, club] = await Promise.all([venueService.profile(), venueService.myClub()]);
      if (!club) return;
      await venueService.sendClubMessage(club.id, {
        memberId: user.id,
        name: user.name,
        text,
        time: 'agora'
      });
      input.value = '';
      const view = document.querySelector('[data-route-view]');
      await renderClub(view);
      window.pqRefreshIcons?.(view);
      return;
    }

    /* Entrar / criar conta. Antes do [data-demo-form], que e generico. */
    const authForm = event.target.closest('[data-auth-form]');
    if (authForm) {
      event.preventDefault();
      if (!authForm.reportValidity()) return;
      const erro = authForm.querySelector('[data-auth-error]');
      if (erro) erro.hidden = true;
      const submit = authForm.querySelector('[type="submit"]');
      submit?.setAttribute('disabled', 'disabled');
      try {
        const dados = Object.fromEntries(new FormData(authForm));
        const modo = authForm.dataset.authForm;
        const session = modo === 'register'
          ? await authService.register(dados)
          : await authService.login(dados);
        goAfterAuth(currentRoute, session.isNew);
      } catch (error) {
        const msg = error.message || 'Não foi possível continuar';
        window.pqToast?.(msg);
        if (erro) {
          erro.textContent = msg;
          erro.hidden = false;
        }
      } finally {
        submit?.removeAttribute('disabled');
      }
      return;
    }

    const demo = event.target.closest('[data-demo-form]');
    if (demo) {
      event.preventDefault();
      if (!demo.reportValidity()) return;
      window.pqToast?.(demo.dataset.success || 'Alteracoes salvas');
      return;
    }

    const composer = event.target.closest('[data-message-form]');
    if (composer) {
      event.preventDefault();
      const input = composer.elements.message;
      const message = input.value.trim();
      if (!message) return;
      await venueService.sendMessage(composer.dataset.conversationId, message);
      const view = document.querySelector('[data-route-view]');
      await renderMessages(view, currentRoute);
      window.pqRefreshIcons?.(view);
    }
  });

  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-game-reload]')) location.reload();
  });

  // A barra de km so aparece quando "Personalizado" esta marcado.
  document.addEventListener('change', (event) => {
    const radio = event.target.closest('[name="raio"]');
    if (radio) {
      const range = document.querySelector('[data-raio-range]');
      if (range) range.hidden = radio.value !== 'custom';
      return;
    }
    const km = event.target.closest('[name="raioKm"]');
    if (km) {
      const output = document.querySelector('[data-raio-output]');
      if (output) output.textContent = `${km.value} km`;
    }
  });

  document.addEventListener('input', (event) => {
    const km = event.target.closest('[name="raioKm"]');
    if (!km) return;
    const output = document.querySelector('[data-raio-output]');
    if (output) output.textContent = `${km.value} km`;
  });

  document.addEventListener('click', async (event) => {
    const clubTab = event.target.closest('[data-club-tab]');
    if (clubTab) {
      selectClubSection(clubTab.dataset.clubTab);
      return;
    }

    const vote = event.target.closest('[data-pelada-confirm]');
    if (vote) {
      const [peladaId, value] = vote.dataset.peladaConfirm.split(':');
      const user = await venueService.profile();
      await venueService.setPeladaAttendance(peladaId, user.id, value);
      const view = document.querySelector('[data-route-view]');
      await renderClub(view);
      window.pqRefreshIcons?.(view);
      return;
    }

  const joinBtn = event.target.closest('[data-club-join]');
  if (joinBtn) {
    try {
      const club = await venueService.joinClub(joinBtn.dataset.clubJoin);
      window.pqToast?.(`Bem-vindo ao ${club.name}!`);
      location.hash = 'clube';
    } catch (error) {
      window.pqToast?.(error.message || 'Não foi possível entrar');
    }
    return;
  }

  if (event.target.closest('[data-club-copy]')) {
    const code = document.querySelector('[data-club-code]')?.dataset.raw || '';
    try {
      await navigator.clipboard.writeText(code);
      window.pqToast?.('Código copiado');
    } catch (error) {
      window.pqToast?.(`Código do time: ${code}`);
    }
    return;
  }

  if (event.target.closest('[data-club-share]')) {
    const code = document.querySelector('[data-club-code]')?.dataset.raw || '';
    const nome = document.querySelector('[data-club-name]')?.textContent || 'nosso time';
    const texto = `Bora jogar? Entra no ${nome} no Qadras com o código ${formatClubCode(code)}.`;
    // O link so entra quando existe dominio: sob file:// no app o
    // location.origin e a string "null", e iria link quebrado para o
    // WhatsApp de alguem.
    const payload = { title: 'Qadras', text: texto };
    if (APP_PUBLIC_URL) payload.url = `${APP_PUBLIC_URL}/index.html#clubes?codigo=${code}`;
    try {
      if (navigator.share) await navigator.share(payload);
      else {
        await navigator.clipboard.writeText(payload.url || texto);
        window.pqToast?.('Convite copiado!');
      }
    } catch (error) { /* a pessoa cancelou o compartilhamento */ }
    return;
  }

  const leaveBtn = event.target.closest('[data-club-leave]');
  if (leaveBtn) {
    const club = await venueService.myClub();
    if (!club) return;
    if (!window.confirm(`Sair do ${club.name}? Você perde acesso às peladas e à conversa do time.`)) return;
    await venueService.leaveClub(club.id);
    window.pqToast?.('Você saiu do clube');
    const view = document.querySelector('[data-route-view]');
    await renderClub(view);
    window.pqRefreshIcons?.(view);
    return;
  }

  const deleteBtn = event.target.closest('[data-club-delete]');
  if (deleteBtn) {
    const club = await venueService.myClub();
    if (!club) return;
    if (!window.confirm(`Apagar o ${club.name}? As peladas e a conversa vão junto. Não dá para desfazer.`)) return;
    try {
      await venueService.deleteClub(club.id);
      window.pqToast?.('Clube apagado');
      const view = document.querySelector('[data-route-view]');
      await renderClub(view);
      window.pqRefreshIcons?.(view);
    } catch (error) {
      window.pqToast?.(error.message || 'Não foi possível apagar');
    }
    return;
  }

  const removeBtn = event.target.closest('[data-member-remove]');
  if (removeBtn) {
    const club = await venueService.myClub();
    if (!club) return;
    const alvo = club.members.find((m) => m.id === removeBtn.dataset.memberRemove);
    if (!window.confirm(`Remover ${alvo ? alvo.name : 'este membro'} do clube?`)) return;
    try {
      await venueService.removeMember(club.id, removeBtn.dataset.memberRemove);
      const view = document.querySelector('[data-route-view]');
      await renderClub(view);
      window.pqRefreshIcons?.(view);
    } catch (error) {
      window.pqToast?.(error.message || 'Não foi possível remover');
    }
    return;
  }

    const editClub = event.target.closest('[data-club-edit]');
    if (editClub) {
      const club = await venueService.myClub();
      prefillClubForm(club);
      openMarketSheet('club-edit-sheet');
    }
  });

  document.addEventListener('change', async (event) => {
    const photoInput = event.target.closest('[data-profile-photo-input]');
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
      const saved = await venueService.saveProfile({ photo });
      const view = document.querySelector('[data-route-view]');
      syncMobileProfile(view, saved);
      window.pqToast?.('Foto do perfil atualizada');
    } catch (error) {
      window.pqToast?.(error.message || 'Não foi possível atualizar a foto');
    } finally {
      photoInput.disabled = false;
      photoInput.value = '';
    }
  });

  document.addEventListener('click', async (event) => {
    const sheetTrigger = event.target.closest('[data-sheet-open]');
    if (sheetTrigger) {
      event.preventDefault();
      openMarketSheet(sheetTrigger.dataset.sheetOpen);
      return;
    }

    const sheetClose = event.target.closest('[data-sheet-close]');
    if (sheetClose) {
      closeMarketSheet(sheetClose.closest('[data-market-sheet]'));
      if (!sheetClose.matches('a[href^="#"]')) event.preventDefault();
      return;
    }

    const locationOption = event.target.closest('[data-location-value]');
    if (locationOption) {
      const value = locationOption.dataset.locationValue;
      storage.set('current_location', value);
      storage.remove('current_coordinates');
      storage.remove('current_location_auto');
      /* player_local e a chave que venues.js le para mandar lat/lng a API.
         O app nunca escrevia nela, entao a listagem ia sem coordenada e o
         servidor media tudo do centro de Goiania — por isso uma arena a
         600 km aparecia como "3,8 km". */
      const coordCidade = LOCATION_COORDINATES[value];
      definirLocal(coordCidade
        ? { label: value, lat: coordCidade[0], lng: coordCidade[1] }
        : { label: value });
      syncMarketplaceState(document);
      closeMarketSheet(locationOption.closest('[data-market-sheet]'));
      window.pqToast?.(`Localização alterada para ${value}`);
      return;
    }

    const useCurrentLocation = event.target.closest('[data-use-current-location]');
    if (useCurrentLocation) {
      if (!geoService.geolocationSupported()) {
        window.pqToast?.('Localização do aparelho indisponível');
        return;
      }
      useCurrentLocation.disabled = true;
      geoService.getCurrentPosition()
        .then(async ({ latitude, longitude }) => {
          storage.set('current_coordinates', [latitude, longitude]);

          /* Resolve o NOME do lugar. Antes gravava a string "Localização
             atual" e era isso que a pessoa via no topo da tela para sempre —
             o app tinha a coordenada e mesmo assim nao dizia onde era.
             A resolucao ja existia no layout de desktop; o app ficou de fora.

             Acima de 60 km o servidor devolve rotulo generico (nomear um
             bairro a 600 km confunde mais do que ajuda), e ai "Localização
             atual" continua sendo a legenda honesta. */
          let rotulo = 'Localização atual';
          try {
            const lugar = await venueService.localDeCoordenada(latitude, longitude);
            if (lugar?.label && lugar.distanceKm <= 60) rotulo = lugar.label;
          } catch (error) {
            /* Sem nome, segue com a coordenada: a busca por proximidade
               funciona do mesmo jeito. */
          }

          storage.set('current_location', rotulo);
          storage.set('current_location_auto', true);
          definirLocal({ label: rotulo, lat: latitude, lng: longitude, auto: true });
          syncMarketplaceState(document);
          closeMarketSheet(useCurrentLocation.closest('[data-market-sheet]'));
          window.pqToast?.(`Localização: ${rotulo}`);
        })
        .catch(() => {
          window.pqToast?.('Não foi possível acessar sua localização');
        })
        .finally(() => {
          useCurrentLocation.disabled = false;
        });
      return;
    }

    const markNotifications = event.target.closest('[data-mark-notifications]');
    if (markNotifications) {
      storage.set('notifications_read', true);
      syncMarketplaceState(document);
      closeMarketSheet(markNotifications.closest('[data-market-sheet]'));
      window.pqToast?.('Notificações marcadas como lidas');
      return;
    }

    const locate = event.target.closest('[data-map-locate]');
    if (locate && activeMobileMap) {
      if (!geoService.geolocationSupported()) {
        activeMobileMap.setView(currentCoordinates(), 15, { animate: true });
        window.pqToast?.('Localização do aparelho indisponível');
        return;
      }
      window.pqToast?.('Buscando sua localização...');
      geoService.getCurrentPosition()
        .then(({ latitude, longitude }) => {
          const coordinates = [latitude, longitude];
          storage.set('current_coordinates', coordinates);
          storage.set('current_location', 'Localização atual');
          syncMarketplaceState(document);
          activeUserMarker?.setLatLng(coordinates);
          activeMobileMap?.setView(coordinates, 15, { animate: true });
          activeUserMarker?.openPopup();
        })
        .catch(() => {
          activeMobileMap?.setView(currentCoordinates(), 15, { animate: true });
          window.pqToast?.('Não foi possível acessar sua localização');
        });
      return;
    }

    const calendarNav = event.target.closest('[data-calendar-nav]');
    if (calendarNav) {
      const root = calendarNav.closest('[data-venue-page]');
      const booking = root.querySelector('[data-booking]');
      const month = calendarMonthDate(booking.dataset.calendarMonth);
      month.setMonth(month.getMonth() + Number(calendarNav.dataset.calendarNav));
      booking.dataset.calendarMonth = calendarMonthValue(month);
      renderBookingCalendar(root);
      return;
    }

    const calendarDate = event.target.closest('[data-calendar-date]');
    if (calendarDate && !calendarDate.disabled) {
      const root = calendarDate.closest('[data-venue-page]');
      const booking = root.querySelector('[data-booking]');
      booking.dataset.date = calendarDate.dataset.calendarDate;
      booking.dataset.hour = '';
      renderBookingCalendar(root);
      renderBooking(root);
      // Busca a agenda REAL da data escolhida e redesenha com ela.
      await carregarDisponibilidade(booking);
      renderBooking(root);
      return;
    }

    const plan = event.target.closest('[data-plan]');
    if (plan) {
      const root = document.querySelector('[data-route-view]');
      const booking = root.querySelector('[data-booking]');
      booking.dataset.planKind = plan.dataset.plan;
      if (plan.dataset.plan === 'mensalista') {
        booking.dataset.date = nextWeekdayDate(Number(booking.dataset.planWeekday || 3));
        booking.dataset.calendarMonth = calendarMonthValue(parseLocalDate(booking.dataset.date));
      }
      renderBookingCalendar(root);
      renderBooking(root);
      window.pqRefreshIcons?.(root);
      return;
    }

    const weekday = event.target.closest('[data-weekday]');
    if (weekday) {
      const root = document.querySelector('[data-route-view]');
      const booking = root.querySelector('[data-booking]');
      booking.dataset.planWeekday = weekday.dataset.weekday;
      // A data de inicio vai para a proxima ocorrencia do dia escolhido
      // DENTRO DO MES QUE A PESSOA ESTA OLHANDO. Antes eu jogava sempre para
      // a proxima ocorrencia a partir de hoje e reescrevia o calendarMonth —
      // entao quem navegava ate setembro e escolhia um dia era chutado de
      // volta para agosto.
      booking.dataset.date = firstWeekdayInMonth(
        Number(weekday.dataset.weekday), booking.dataset.calendarMonth);
      renderBookingCalendar(root);
      renderBooking(root);
      return;
    }

    const slot = event.target.closest('[data-slot-hour]');
    if (slot && !slot.disabled) {
      const root = slot.closest('[data-venue-page]');
      root.querySelector('[data-booking]').dataset.hour = slot.dataset.slotHour;
      renderBooking(root);
      return;
    }

    const duration = event.target.closest('[data-duration]');
    if (duration && !duration.disabled) {
      const root = duration.closest('[data-venue-page]');
      root.querySelector('[data-booking]').dataset.duration = duration.dataset.duration;
      renderBooking(root);
      return;
    }

    const paymentRequest = event.target.closest('[data-payment-cta]');
    if (paymentRequest?.dataset.paymentRoute) {
      event.preventDefault();
      const paymentRoot = paymentRequest.closest('[data-payment-page]');
      const selectedMethod = paymentRoot?.querySelector('[data-payment-method].on')?.dataset.paymentMethod || 'pix';
      const params = new URLSearchParams(paymentRequest.dataset.paymentQuery || '');
      params.set('metodo', selectedMethod);
      params.set('deadline', String(Date.now() + APPROVAL_WINDOW_MS));
      location.hash = `${paymentRequest.dataset.paymentRoute}?${params}`;
      return;
    }

    const galleryStep = event.target.closest('[data-gallery-step]');
    if (galleryStep) {
      const root = galleryStep.closest('[data-venue-page]');
      const photos = [...(root?.querySelectorAll('[data-gallery-image]') || [])];
      if (!photos.length) return;
      const currentIndex = Math.max(0, photos.findIndex((button) => button.classList.contains('on')));
      const nextIndex = (currentIndex + Number(galleryStep.dataset.galleryStep) + photos.length) % photos.length;
      photos[nextIndex].click();
      return;
    }

    const galleryDot = event.target.closest('[data-gallery-index]');
    if (galleryDot) {
      const root = galleryDot.closest('[data-venue-page]');
      const track = root?.querySelector('[data-venue-track]');
      if (!track) return;
      track.scrollTo({ left: track.clientWidth * Number(galleryDot.dataset.galleryIndex), behavior: 'smooth' });
      return;
    }

    const galleryImage = event.target.closest('[data-gallery-image]');
    if (galleryImage) {
      const root = galleryImage.closest('[data-venue-page]');
      const hero = root?.querySelector('[data-venue-hero]');
      if (!hero) return;
      hero.src = galleryImage.dataset.galleryImage;
      const photos = [...root.querySelectorAll('[data-gallery-image]')];
      photos.forEach((button) => {
        button.classList.toggle('on', button === galleryImage);
      });
      const current = root.querySelector('[data-venue-photo-current]');
      if (current) current.textContent = String(photos.indexOf(galleryImage) + 1);
      return;
    }

    const method = event.target.closest('[data-payment-method]');
    if (method && !method.disabled) {
      const root = method.closest('[data-payment-page]');
      syncMobilePaymentChoice(root, method.dataset.paymentMethod);
      return;
    }

    const favorite = event.target.closest('[data-favorite-toggle]');
    if (favorite) {
      event.preventDefault();
      event.stopPropagation();
      const active = await venueService.toggleFavorite(favorite.dataset.favoriteToggle);
      favorite.classList.toggle('on', active);
      window.pqToast?.(active ? 'Quadra salva nos favoritos' : 'Removida dos favoritos');
      if (currentRoute?.name === 'favoritos') {
        const view = document.querySelector('[data-route-view]');
        await renderFavorites(view);
        window.pqRefreshIcons?.(view);
      }
      return;
    }

    const amount = event.target.closest('[data-amount]');
    if (amount) {
      amount.parentElement.querySelectorAll('[data-amount]').forEach((item) => item.classList.toggle('on', item === amount));
    }
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMarketSheet();
  });

  syncMarketplaceState(document);
}

function matchPhaseNow(match) {
  if (!match) return null;
  const now = Date.now();
  if (match.phase === 'post-game') return 'post-game';
  if (now >= match.endTimestamp) return 'post-game';
  if (now >= match.startTimestamp) return 'during-game';
  return 'pre-game';
}

function formatClock(totalSeconds) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const min = Math.floor(safe / 60);
  const sec = safe % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function formatCountdown(msLeft) {
  const totalMin = Math.max(0, Math.floor(msLeft / 60000));
  if (totalMin >= 1440) {
    const days = Math.floor(totalMin / 1440);
    return { value: `${days}d`, unit: days === 1 ? 'dia' : 'dias' };
  }
  if (totalMin >= 60) {
    const hours = Math.floor(totalMin / 60);
    const min = totalMin % 60;
    return { value: `${hours}h${String(min).padStart(2, '0')}`, unit: 'para comecar' };
  }
  if (totalMin >= 1) return { value: `${totalMin}`, unit: totalMin === 1 ? 'minuto' : 'minutos' };
  return { value: formatClock(msLeft / 1000), unit: 'quase la' };
}

/** Card da partida na home — sempre visivel, nas 3 fases (ou vazio, sem partida). */
function buildGameCard(match) {
  const phase = matchPhaseNow(match);
  if (!phase) {
    return `<a class="game-card game-card--empty" href="#quadras" data-game-card data-game-phase="none">
      <span class="game-card__icon"><i class="ic" data-lucide="calendar-plus"></i></span>
      <span class="game-card__info">
        <span class="game-card__label">Nenhuma partida marcada</span>
        <span class="game-card__title">Bora marcar um jogo?</span>
        <span class="game-card__meta"><span>Encontre uma quadra livre perto de você</span></span>
      </span>
      <i class="ic game-card__chevron" data-lucide="chevron-right"></i>
    </a>`;
  }

  const venue = escapeHtml(match.venueName || 'Sua partida');
  const sport = escapeHtml(match.sport || '');

  if (phase === 'during-game') {
    const elapsed = Math.floor((Date.now() - match.startTimestamp) / 1000);
    const remaining = Math.max(0, Math.floor((match.endTimestamp - Date.now()) / 1000));
    const progress = Math.min(100, (elapsed / Math.max(1, match.duration * 60)) * 100);
    return `<a class="game-card game-card--live" href="#game" data-game-card data-game-phase="during-game">
      <span class="game-card__icon"><i class="ic" data-lucide="activity"></i></span>
      <span class="game-card__info">
        <span class="game-card__label"><span class="game-card__dot"></span>Partida em andamento</span>
        <span class="game-card__title">${venue}</span>
        <span class="game-card__meta">
          <span class="game-card__score" data-game-card-score>${match.score?.teamA ?? 0} × ${match.score?.teamB ?? 0}</span>
          <span>·</span>
          <span>${sport}</span>
        </span>
      </span>
      <span class="game-card__countdown">
        <span data-game-card-value>${formatClock(remaining)}</span>
        <small data-game-card-unit>restam</small>
      </span>
      <span class="game-card__progress"><span data-game-card-progress style="width:${progress}%"></span></span>
    </a>`;
  }

  if (phase === 'post-game') {
    return `<a class="game-card game-card--done" href="#game" data-game-card data-game-phase="post-game">
      <span class="game-card__icon"><i class="ic" data-lucide="award"></i></span>
      <span class="game-card__info">
        <span class="game-card__label">Partida encerrada</span>
        <span class="game-card__title">${venue}</span>
        <span class="game-card__meta"><span>Avalie a quadra e veja o resultado</span></span>
      </span>
      <span class="game-card__countdown">
        <span data-game-card-value>${match.score?.teamA ?? 0} × ${match.score?.teamB ?? 0}</span>
        <small data-game-card-unit>final</small>
      </span>
    </a>`;
  }

  const countdown = formatCountdown(match.startTimestamp - Date.now());
  const confirmed = match.players?.confirmed?.length || 0;
  return `<a class="game-card game-card--next" href="#game" data-game-card data-game-phase="pre-game">
    <span class="game-card__icon"><i class="ic" data-lucide="clock"></i></span>
    <span class="game-card__info">
      <span class="game-card__label">Próxima partida</span>
      <span class="game-card__title">${venue}</span>
      <span class="game-card__meta">
        <span>${sport}</span>
        <span>·</span>
        <span>${escapeHtml(match.startTime || '')}</span>
        <span>·</span>
        <span>${confirmed} confirmados</span>
      </span>
    </span>
    <span class="game-card__countdown">
      <span data-game-card-value>${countdown.value}</span>
      <small data-game-card-unit>${countdown.unit}</small>
    </span>
  </a>`;
}

function stopGameCardTicker() {
  if (gameCardTicker) {
    clearInterval(gameCardTicker);
    gameCardTicker = null;
  }
}

/** Mantem o card vivo: countdown, cronometro e placar atualizam a cada segundo. */
function startGameCardTicker(container, match) {
  stopGameCardTicker();
  if (!container || !match) return;

  let lastPhase = matchPhaseNow(match);
  gameCardTicker = setInterval(() => {
    if (!container.isConnected) {
      stopGameCardTicker();
      return;
    }
    const phase = matchPhaseNow(match);
    if (phase !== lastPhase) {
      // Mudou de fase (ex.: comecou a partida) — redesenha o card inteiro.
      lastPhase = phase;
      match.phase = phase;
      container.innerHTML = buildGameCard(match);
      window.pqRefreshIcons?.(container);
      return;
    }

    const value = container.querySelector('[data-game-card-value]');
    const unit = container.querySelector('[data-game-card-unit]');
    if (!value) return;

    if (phase === 'during-game') {
      const remaining = Math.max(0, Math.floor((match.endTimestamp - Date.now()) / 1000));
      value.textContent = formatClock(remaining);
      const elapsed = Math.floor((Date.now() - match.startTimestamp) / 1000);
      const bar = container.querySelector('[data-game-card-progress]');
      if (bar) bar.style.width = `${Math.min(100, (elapsed / Math.max(1, match.duration * 60)) * 100)}%`;
      const score = container.querySelector('[data-game-card-score]');
      const live = getActiveMatch();
      if (score && live?.score) {
        match.score = live.score;
        score.textContent = `${live.score.teamA} × ${live.score.teamB}`;
      }
      return;
    }

    if (phase === 'pre-game') {
      const countdown = formatCountdown(match.startTimestamp - Date.now());
      value.textContent = countdown.value;
      if (unit) unit.textContent = countdown.unit;
    }
  }, 1000);
}

/* ═══════════════ Clube ═══════════════
   O clube e o grupo que organiza a pelada recorrente. Uma pelada pode ser
   "do clube" ou "avulsa" — e a avulsa precisa ser alcancavel mesmo sem
   clube, e metade da intencao do produto. */

const ATTENDANCE_LABEL = { sim: 'Vou', talvez: 'Talvez', nao: 'Não vou' };

function peladaDateLabel(pelada) {
  const [y, m, d] = String(pelada.dateISO || '').split('-').map(Number);
  if (!y) return pelada.dateISO || '';
  const date = new Date(y, m - 1, d);
  const today = new Date();
  const days = Math.round((date - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
  if (days === 0) return 'Hoje';
  if (days === 1) return 'Amanhã';
  return date.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
}

/* Mesma anatomia do card de reserva (.res-card): foto da quadra, titulo,
   duas linhas de meta com icone e um rodape com selo. Uma pelada e um jogo
   agendado — nao havia motivo para inventar outro card. */
function peladaCard(pelada, userId, venue) {
  const mine = pelada.attendance?.[userId] || null;
  const going = Object.values(pelada.attendance || {}).filter((v) => v === 'sim').length;
  const statusClass = pelada.kind === 'avulsa' ? 'pendente' : 'pago';
  const statusLabel = pelada.kind === 'avulsa' ? 'Avulsa' : 'Do clube';
  const end = pelada.startTime && pelada.duration
    ? addMinutesToTime(pelada.startTime, pelada.duration)
    : '';

  const votes = ['sim', 'talvez', 'nao'].map((value) => `
    <button type="button" class="seg-item${mine === value ? ' on' : ''}"
            data-pelada-confirm="${pelada.id}:${value}">${ATTENDANCE_LABEL[value]}</button>`).join('');

  return `<article class="res-card pelada-card">
    <img src="${escapeHtml(venue?.image || '')}" alt="${escapeHtml(pelada.venueName || '')}" loading="lazy">
    <div class="res-info">
      <strong>${escapeHtml(pelada.title || 'Pelada')}</strong>
      <span class="res-meta">${icon('map-pin')}${escapeHtml(pelada.venueName || '')}</span>
      <span class="res-meta">${icon('calendar-days')}${escapeHtml(peladaDateLabel(pelada))} - ${escapeHtml(pelada.startTime || '')}${end ? ' a ' + escapeHtml(end) : ''}</span>
      <div class="res-foot">
        <span class="status ${statusClass}">${statusLabel}</span>
        <span class="res-val">${going}/${pelada.maxPlayers || '-'}</span>
      </div>
      <div class="seg pelada-card__seg" role="group" aria-label="Sua presença">${votes}</div>
    </div>
  </article>`;
}

function addMinutesToTime(hhmm, minutes) {
  const [h, m] = String(hhmm).split(':').map(Number);
  if (Number.isNaN(h)) return '';
  const total = h * 60 + (m || 0) + Number(minutes || 0);
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/* Linha de membro no idioma de lista do app (.payment-row), o mesmo das
   formas de pagamento e das configurações. */
/* KRT4P9 -> KRT-4P9. Hifen so na exibicao: e mais facil de ditar em voz
   alta, mas o dado guardado nao tem separador. */
function formatClubCode(code) {
  const limpo = String(code || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
  return limpo.length === 6 ? `${limpo.slice(0, 3)}-${limpo.slice(3)}` : limpo;
}

function memberRow(member, user, souDono) {
  const initial = member.name.charAt(0).toUpperCase();
  // A linha da propria pessoa le do perfil vivo: editar posicao no Perfil
  // reflete aqui na hora, sem precisar reescrever o registro de membro.
  const eu = user && member.id === user.id;
  const position = eu ? (user.position || member.position) : member.position;
  const role = member.role === 'dono' ? 'Dono do clube' : (position || 'Membro');
  const rating = eu ? (user.rating ?? member.rating) : member.rating;
  const tail = member.role === 'dono'
    ? '<span class="status pago">Dono</span>'
    : souDono && !eu
      ? `<button class="member-remove" type="button" data-member-remove="${escapeHtml(member.id)}" aria-label="Remover ${escapeHtml(member.name)}">${icon('user-minus')}</button>`
      : `<span class="member-rating">${icon('star')}${rating ?? '-'}</span>`;
  return `<div class="payment-row member-row">
    <span class="badge-ic member-row__avatar">${initial}</span>
    <span><strong>${escapeHtml(member.name)}</strong><small>${escapeHtml(role)} &middot; desde ${escapeHtml(member.since || '')}</small></span>
    ${tail}
  </div>`;
}

/* Mesmo idioma das abas da partida ([data-*-tab] + [data-*-panel] + hidden),
   sem o ARIA de tablist: a barra do clube nao e so um tablist — o terceiro
   espaco e o CTA de agendar. Fora de um tablist, aria-pressed e o correto. */
function selectClubSection(name) {
  clubSection = name;
  document.querySelectorAll('[data-club-tab]').forEach((tab) => {
    const on = tab.dataset.clubTab === name;
    tab.classList.toggle('is-active', on);
    tab.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  document.querySelectorAll('[data-club-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.clubPanel !== name;
  });
}

/* Reusa .mobile-bubbles / .bubble / .mobile-composer — o mesmo chat das
   mensagens com as arenas. "me" sai pelo memberId, nao pelo nome: o nome
   muda quando a pessoa edita o perfil. */
function renderClubChat(root, messages, userId) {
  const box = root.querySelector('[data-club-bubbles]');
  if (!box) return;
  box.innerHTML = messages.length
    ? messages.map((m) => {
        const mine = m.memberId === userId;
        const name = mine ? '' : `<div class="bub-name">${escapeHtml(m.name || '')}</div>`;
        return `<div class="bubble ${mine ? 'me' : 'them'}">
          ${name}
          <div class="bub-txt">${escapeHtml(m.text)}</div>
          <div class="bub-time">${escapeHtml(m.time || '')}</div>
        </div>`;
      }).join('')
    : '<div class="empty"><h3>Nenhuma mensagem</h3><p>Comece a combinar a próxima pelada.</p></div>';
  box.scrollTop = box.scrollHeight;
}

async function renderClub(root) {
  const [user, club] = await Promise.all([venueService.profile(), venueService.myClub()]);
  const emptyView = root.querySelector('[data-club-empty]');
  const clubView = root.querySelector('[data-club-view]');
  const [peladas, venues] = await Promise.all([venueService.peladas(), venueService.list({})]);
  const venueOf = (p) => venues.find((v) => v.id === p.venueId);
  const upcoming = peladas
    .filter((p) => p.status !== 'cancelada')
    .sort((a, b) => String(a.dateISO).localeCompare(String(b.dateISO)));

  fillSportOptions();
  fillVenueOptions();

  if (!club) {
    // Sem clube nao ha secoes para navegar — a barra de 5 espacos serve
    // melhor, e quem nao tem clube quer mais sair do que gerenciar.
    delete document.documentElement.dataset.bottombar;
    if (emptyView) emptyView.hidden = false;
    if (clubView) clubView.hidden = true;
    // Sem clube, so as avulsas fazem sentido aqui — uma pelada de clube
    // pertence a um grupo do qual esta pessoa nao faz parte.
    const solo = root.querySelector('[data-pelada-list-solo]');
    if (solo) {
      const avulsas = upcoming.filter((p) => p.kind === 'avulsa');
      solo.innerHTML = avulsas.length
        ? avulsas.map((p) => peladaCard(p, user.id, venueOf(p))).join('')
        : '<div class="empty"><h3>Nenhuma pelada avulsa</h3><p>Marque um jogo sem precisar de time fixo.</p></div>';
    }
    window.pqRefreshIcons?.(root);
    return;
  }

  document.documentElement.dataset.bottombar = 'clube';
  if (emptyView) emptyView.hidden = true;
  if (clubView) clubView.hidden = false;

  root.querySelector('[data-club-name]').textContent = club.name;
  root.querySelector('[data-club-sport]').textContent = club.sport;
  root.querySelector('[data-club-city]').textContent = club.city;
  root.querySelector('[data-club-description]').textContent = club.description || '';
  root.querySelector('[data-club-avatar]').textContent = club.name.charAt(0).toUpperCase();
  root.querySelector('[data-member-label]').textContent = club.members.length === 1 ? '1 no time' : `${club.members.length} no time`;
  root.querySelector('[data-pelada-label]').textContent = upcoming.length === 1 ? '1 marcada' : `${upcoming.length} marcadas`;
  const souDono = club.members.some((m) => m.id === user.id && m.role === 'dono');

  const codigo = root.querySelector('[data-club-code]');
  if (codigo) {
    codigo.textContent = formatClubCode(club.code);
    codigo.dataset.raw = club.code || '';
  }

  /* Dono nao "sai": ele apaga. E so consegue apagar com o clube vazio, entao
     a dica explica o que fazer antes em vez de deixar o botao morto sem
     motivo aparente. */
  const sozinho = club.members.length <= 1;
  const btnSair = root.querySelector('[data-club-leave]');
  if (btnSair) btnSair.hidden = souDono;
  const btnApagar = root.querySelector('[data-club-delete]');
  if (btnApagar) {
    btnApagar.hidden = !souDono;
    btnApagar.disabled = !sozinho;
  }
  const dica = root.querySelector('[data-club-delete-hint]');
  if (dica) dica.hidden = !souDono || sozinho;
  root.querySelector('[data-member-list]').innerHTML = club.members
    .map((m) => memberRow(m, user, souDono)).join('');
  root.querySelector('[data-pelada-list]').innerHTML = upcoming.length
    ? upcoming.map((p) => peladaCard(p, user.id, venueOf(p))).join('')
    : '<div class="empty"><h3>Nenhuma pelada marcada</h3><p>Agende a próxima e o time confirma presença por aqui.</p></div>';

  const clubNameLabel = document.querySelector('[data-pelada-club-name]');
  if (clubNameLabel) clubNameLabel.textContent = club.name;

  prefillClubForm(club);
  renderClubChat(root, await venueService.clubChat(club.id), user.id);
  selectClubSection(clubSection);
  window.pqRefreshIcons?.(root);
}

/* A grade de esportes da folha sai da MESMA fonte da fileira do Explorar.
   Duas listas escritas separadamente foi a origem do filtro bugado: a folha
   nao reconhecia Beach Tennis, Basquete nem Tenis, e a fileira nao
   reconhecia "outros". */
const SPORT_FILTER_ICONS = {
  'Futebol Society': 'goal',
  Futsal: 'trophy',
  Volei: 'volleyball',
  'Beach Tennis': 'circle-dot',
  Basquete: 'target',
  Tenis: 'activity'
};

async function fillFilterSports(sportAtual) {
  const grid = document.querySelector('[data-filter-sports]');
  if (!grid) return;
  const sports = await venueService.sports();
  const opcoes = [
    { value: '', label: 'Todos', icon: 'shapes' },
    ...sports.map((nome) => ({
      value: nome,
      label: displayText(nome),
      icon: SPORT_FILTER_ICONS[nome] || 'circle-dot'
    }))
  ];
  grid.innerHTML = opcoes.map((o) => `<label>
    <input type="radio" name="esporte" value="${escapeHtml(o.value)}"${o.value === sportAtual ? ' checked' : ''}>
    <span><i class="ic" data-lucide="${o.icon}"></i>${escapeHtml(o.label)}</span>
  </label>`).join('');
  window.pqRefreshIcons?.(grid);
}

/* As folhas sao globais (vivem fora do route-view), entao os selects sao
   preenchidos aqui — mesmo motivo pelo qual o filter-sheet ja faz isso. */
function fillSportOptions() {
  const select = document.querySelector('[data-sport-options]');
  if (!select || select.options.length) return;
  select.innerHTML = SPORTS.map((sport) => `<option value="${escapeHtml(sport)}">${escapeHtml(sport)}</option>`).join('');
}

async function fillVenueOptions() {
  const select = document.querySelector('[data-venue-options]');
  if (!select || select.options.length) return;
  const venues = await venueService.list({});
  select.innerHTML = venues
    .map((v) => `<option value="${v.id}">${escapeHtml(v.name)} — ${escapeHtml(v.neighborhood || '')}</option>`)
    .join('');
}

function prefillClubForm(club) {
  const form = document.querySelector('[data-club-form]');
  if (!form) return;
  const title = document.querySelector('[data-club-form-title]');
  if (title) title.textContent = club ? 'Editar clube' : 'Criar clube';
  form.elements.id.value = club?.id || '';
  form.elements.name.value = club?.name || '';
  form.elements.city.value = club?.city || '';
  form.elements.description.value = club?.description || '';
  if (club?.sport) form.elements.sport.value = club.sport;
}

async function renderGame(root) {
  // Otimista de proposito: a barra entra junto com a rota, sem piscar a
  // tabbar enquanto a partida carrega. Se nao houver partida, ela sai e a
  // navegacao normal volta — o estado vazio precisa de uma saida.
  document.documentElement.dataset.bottombar = 'game';
  const status = await loadGame();
  if (status === 'ok') return;
  delete document.documentElement.dataset.bottombar;
  // 'empty' = nao ha partida. 'error' = a tela nao montou — nao mentir dizendo
  // que nao ha jogo; o motivo real fica no console.
  root.innerHTML = status === 'empty'
    ? '<div class="empty"><h3>Nenhuma partida ativa</h3><p>Quando você tiver um jogo marcado ele aparece aqui.</p><a class="btn" href="#quadras">Encontrar uma quadra</a></div>'
    : '<div class="empty"><h3>Não foi possível abrir a partida</h3><p>Recarregue a tela. Se continuar, feche e abra o app.</p><button class="btn" type="button" data-game-reload>Recarregar</button></div>';
}
