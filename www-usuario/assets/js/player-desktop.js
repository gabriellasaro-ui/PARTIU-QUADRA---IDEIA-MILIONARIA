import venueService from '../../services/venues.js';
import { calculateCheckoutAmounts, formatCurrency } from '../../utils/formatters.js';
import { imageFileToDataUrl } from '../../utils/helpers.js';
import { loadGame, destroyGame } from './game-mode.js';

let currentRoute = null;
let desktopMap = null;
let activeDesktopApprovalTimer = null;
const USER_LOCATION = [-16.6950, -49.2550];
const APPROVAL_WINDOW_MS = 15 * 60 * 1000;
const MOCK_APPROVAL_DELAY_MS = 5000;
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
    'Jardim Goias': 'Jardim Goiás',
    'Alto da Gloria': 'Alto da Glória',
    'Grama sintetica': 'Grama sintética',
    Vestiario: 'Vestiário'
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

function bookingDayOffset(value) {
  const today = parseLocalDate(localDateValue());
  return Math.round((parseLocalDate(value) - today) / 86400000);
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

function availabilityForDay(base, dayIndex) {
  if (!dayIndex) return base;
  return base.map((slot, index) => ({
    ...slot,
    status: base[(index + dayIndex) % base.length].status
  }));
}

function routeQuery(route) {
  return route?.query instanceof URLSearchParams ? route.query : new URLSearchParams();
}

function venueCard(venue, favorite = false) {
  const favoriteButton = favorite
    ? `<button type="button" class="fav-heart on" data-player-favorite="${venue.id}" aria-label="Remover dos favoritos">
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
        <img src="${escapeHtml(venue.image)}" alt="${escapeHtml(venue.name)}" loading="lazy">
      </div>
      <div class="bd">
        <div class="qcard-kicker">${icon(SPORT_ICONS[venue.sport] || 'trophy')}${escapeHtml(venue.sport)}</div>
        <h3>${escapeHtml(venue.name)}</h3>
        <p class="meta">${icon('map-pin')}${escapeHtml(venue.neighborhood)} - ${venue.distance.toLocaleString('pt-BR')} km</p>
        <div class="tags">${venue.tags.slice(0, 2).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>
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
      <img src="${escapeHtml(venue.image)}" alt="" style="width:64px;height:58px;object-fit:cover;border-radius:7px">
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
  const local = query.get('local') || 'Goiânia, GO';
  const radius = query.get('raio') || '5';
  const now = query.get('agora') === '1';
  const [sports, listedVenues] = await Promise.all([
    venueService.sports(),
    venueService.list({ sport })
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
          <span>${icon('map-pin', 'ic sm')}${escapeHtml(local)}</span>
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
            ${icon(SPORT_ICONS[sport] || 'trophy')}
            <span data-sport-label>${escapeHtml(sport || 'Todos os esportes')}</span>
            ${icon('chevron-down', 'desktop-sport-chevron')}
          </button>
          <div class="desktop-sport-menu" data-sport-menu role="listbox" aria-label="Escolha um esporte" hidden>
            <button type="button" class="${sport ? '' : 'is-selected'}" data-sport-option="" role="option" aria-selected="${String(!sport)}">
              ${icon('sparkles')}<span>Todos os esportes</span>${icon('check', 'desktop-sport-check')}
            </button>
            ${sports.map((item) => `
              <button type="button" class="${item === sport ? 'is-selected' : ''}" data-sport-option="${escapeHtml(item)}" role="option" aria-selected="${String(item === sport)}">
                ${icon(SPORT_ICONS[item] || 'trophy')}<span>${escapeHtml(item)}</span>${icon('check', 'desktop-sport-check')}
              </button>`).join('')}
          </div>
        </div>
        <button class="btn btn-primary" type="submit">${icon('arrow-right')}Buscar</button>
      </form>
    </section>

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

function initExploreMap(root) {
  const mapElement = root.querySelector('[data-player-map]');
  if (!mapElement || !window.L) return;
  desktopMap?.remove();
  const venues = JSON.parse(root.dataset.mapVenues || '[]');
  desktopMap = window.L.map(mapElement).setView(USER_LOCATION, 13);
  window.L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(desktopMap);
  const bounds = [USER_LOCATION];
  venues.forEach((venue) => {
    const position = [venue.map.lat, venue.map.lng];
    window.L.marker(position).addTo(desktopMap).bindPopup(mapPopup(venue));
    bounds.push(position);
  });
  if (bounds.length > 1) desktopMap.fitBounds(bounds, { padding: [34, 34], maxZoom: 14 });
  setTimeout(() => desktopMap?.invalidateSize(), 50);
}

async function renderVenue(root, route) {
  const venue = await venueService.get(route.params.id);
  if (!venue) {
    location.hash = 'quadras';
    return;
  }
  const [availability, favoriteIds] = await Promise.all([
    venueService.availability(venue.id),
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
        <img class="desktop-venue-gallery__main" data-player-gallery-hero src="${escapeHtml(gallery[0])}" alt="${escapeHtml(venue.name)}">
        <div class="desktop-venue-gallery__side">
          ${gallery.slice(1, 3).map((photo, index) => `
            <button type="button" data-player-gallery-image="${escapeHtml(photo)}" aria-label="Abrir foto ${index + 2}">
              <img src="${escapeHtml(photo)}" alt="" loading="lazy">
            </button>`).join('')}
        </div>
      </div>
      <div class="desktop-booking-hero__badges">
        <span>${icon('images', 'ic sm')}${gallery.length} fotos</span>
        <span>${icon('navigation', 'ic sm')}${venue.distance.toLocaleString('pt-BR')} km</span>
      </div>
      <button type="button" class="fav-heart ${favoriteIds.includes(venue.id) ? 'on' : ''}" data-player-favorite="${venue.id}" aria-label="Salvar nos favoritos">
        ${icon('heart', 'ic fill')}
      </button>
    </section>

    <section class="desktop-arena-identity">
      <span class="desktop-arena-logo" aria-hidden="true">${escapeHtml(venueInitials(venue.name))}</span>
      <div class="desktop-arena-identity__copy">
        <span>${icon('badge-check', 'ic sm')}Arena verificada</span>
        <h1>${escapeHtml(venue.name)}</h1>
        <p>${icon('map-pin', 'ic sm')}${escapeHtml(displayText(venue.sport))} - ${escapeHtml(displayText(venue.neighborhood))}</p>
      </div>
      <div class="desktop-arena-facts">
        <span>${icon('star', 'ic sm')}<b>${venue.rating}</b><small>${venue.reviews} avaliações</small></span>
        <span>${icon('circle-dollar-sign', 'ic sm')}<b>${money(venue.price)}</b><small>por hora</small></span>
      </div>
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
         data-venue-id="${venue.id}" data-price="${venue.price}" data-day-index="0"
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
                <span>Dom</span><span>Seg</span><span>Ter</span><span>Qua</span><span>Qui</span><span>Sex</span><span>Sab</span>
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
  const baseAvailability = JSON.parse(booking.dataset.availability || '[]');
  const availability = availabilityForDay(baseAvailability, Number(booking.dataset.dayIndex || 0));
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
        const selected = selectedHour && hour >= start && hour < start + duration;
        const availableStart = canStartAt(hour) && !isPast(slot.hour);
        const reason = isPast(slot.hour)
          ? 'Horário já passou'
          : slot.status === 'busy' ? 'Horário ocupado' : `Não há ${duration}h consecutivas a partir daqui`;
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
  return {
    venue,
    date,
    dateText: dateLabel(date),
    hour,
    duration,
    endHour: addHours(hour, duration),
    ...amounts,
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
    ? `<img src="${escapeHtml(profile.photo)}" alt="Foto de ${escapeHtml(profile.name)}">`
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
              <img src="${escapeHtml(venue.image)}" alt="${escapeHtml(venue.name)}">
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
                <span class="badge-ic">${icon('zap')}</span>
                <span><strong>Pix</strong><small>Validação imediata</small></span>
                <span class="ck">${icon('check')}</span>
              </button>
              <button type="button" class="method" data-player-payment-method="card">
                <span class="badge-ic">${icon('credit-card')}</span>
                <span><strong>Cartão de crédito</strong><small>Final 4321</small></span>
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
    subtotal,
    serviceFee,
    total,
    method
  } = context;
  const code = `PQ-${venue.id}${date.slice(5).replace('-', '')}${hour.replace(':', '')}`;
  const query = routeQuery(route);
  const requestedDeadline = Number(query.get('deadline'));
  const deadline = Number.isFinite(requestedDeadline) && requestedDeadline > 0
    ? requestedDeadline
    : Date.now() + APPROVAL_WINDOW_MS;
  const forcedResult = query.get('resultado') || 'aceito';
  let settled = false;

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
            <img src="${escapeHtml(venue.image)}" alt="${escapeHtml(venue.name)}">
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
              <img src="${escapeHtml(venue.image)}" alt="${escapeHtml(venue.name)}">
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

  await venueService.saveReservation({
    ...reservationData,
    status: 'Aguardando aprovação',
    statusClass: 'pendente',
    group: 'proxima'
  });
  renderPending(Math.max(0, deadline - Date.now()));

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
    const conversation = conversations.find((item) => Number(item.venueId) === Number(venue.id));
    return `
      <article class="ritem" data-status="${escapeHtml(reservation.group)}" ${reservation.group === 'proxima' ? '' : 'style="display:none"'}>
        <img src="${escapeHtml(venue.image)}" alt="${escapeHtml(venue.name)}">
        <div class="info">
          <h3>${escapeHtml(venue.name)}</h3>
          <div class="meta">
            <span>${icon(SPORT_ICONS[venue.sport] || 'trophy')}${escapeHtml(venue.sport)}</span>
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

/* Pagamento no desktop. Saldo, extrato e cupom sairam: guardar dinheiro de
   usuario e atividade de instituicao de pagamento. */
async function renderWallet(root) {
  root.innerHTML = `
    <div class="split-2">
      <div>
        <div class="card">
          <h2>Formas de pagamento</h2>
          <div class="rlist">
            <div class="payment-row"><span class="badge-ic">${icon('zap')}</span><span><strong>Pix</strong><small>Aprovação na hora</small></span></div>
            <div class="payment-row"><span class="badge-ic">${icon('credit-card')}</span><span><strong>Visa final 4321</strong><small>Cartão principal</small></span></div>
          </div>
          <a href="#carteira/cartao" class="btn btn-outline" style="margin-top:14px;">${icon('plus', 'ic sm')} Adicionar cartão</a>
        </div>
      </div>
      <aside class="card">
        <h2>Como funciona</h2>
        <p class="muted">Você paga a cada reserva, direto no checkout. A Qadras não guarda saldo.</p>
      </aside>
    </div>`;
}

async function renderWalletAction(root, route) {
  const wallet = await venueService.wallet();
  const action = route.params.action || 'adicionar';
  const pageTitle = document.querySelector('[data-page-title]');
  const pageSub = document.querySelector('[data-page-sub]');
  if (action === 'cartao') {
    if (pageTitle) pageTitle.textContent = 'Adicionar cartão';
    if (pageSub) pageSub.textContent = 'Cadastre um cartão para pagar mais rápido';
    root.innerHTML = `
      <a href="#carteira" class="back-link"><svg class="ic sm"><use href="#i-left"/></svg> Voltar para a carteira</a>
      <form class="split-2" data-player-demo-form data-success="Cartão salvo com sucesso">
        <div class="card">
          <h2>Dados do cartão</h2>
          <div class="inp"><label>Número do cartão</label><input type="text" placeholder="0000 0000 0000 0000" required></div>
          <div class="inp"><label>Nome impresso no cartão</label><input type="text" placeholder="GABRIEL LISBOA" required></div>
          <div class="input-row">
            <div class="inp"><label>Validade</label><input type="text" placeholder="MM/AA" required></div>
            <div class="inp"><label>CVV</label><input type="text" placeholder="123" required></div>
          </div>
        </div>
        <aside><div class="order-card"><h3>Cartão de crédito</h3><p class="muted" style="margin:12px 0;line-height:1.6;">Seus dados são protegidos e criptografados.</p><button type="submit" class="btn btn-primary btn-lg btn-block">Salvar cartão</button><div class="bc-note"><svg class="ic"><use href="#i-shield"/></svg> Pagamento seguro</div></div></aside>
      </form>`;
    return;
  }
  // Cartao e a unica acao que sobrou; qualquer outra volta para Pagamento.
  location.hash = 'carteira';
}

async function renderProfile(root) {
  const [profile, reservations, venues] = await Promise.all([
    venueService.profile(),
    venueService.reservations(),
    venueService.list()
  ]);
  const next = reservations.find((item) => item.group === 'proxima');
  const nextVenue = next ? venues.find((venue) => venue.id === next.venueId) : null;
  const avatar = profile.photo
    ? `<img src="${escapeHtml(profile.photo)}" alt="Foto de ${escapeHtml(profile.name)}">`
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
            <span class="desktop-profile-role">${icon('user-round-check', 'ic sm')}Jogador</span>
            <h2>${escapeHtml(profile.name)}</h2>
            <p>Jogador desde ${escapeHtml(profile.memberSince)}</p>
            <div class="desktop-profile-meta">
              <span>${icon('map-pin', 'ic sm')}${escapeHtml(profile.city)}</span>
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
            <a class="desktop-profile-link" href="#reservas">Ver reservas${icon('chevron-right', 'ic sm')}</a>
          </div>
          ${next && nextVenue ? `
          <div class="desktop-profile-next">
            <span class="desktop-profile-eyebrow">Próximo jogo</span>
            <a href="#quadra/${nextVenue.id}" class="next-game">
              <img src="${escapeHtml(nextVenue.image)}" alt="${escapeHtml(nextVenue.name)}">
              <div class="ng-info"><strong>${escapeHtml(nextVenue.name)}</strong><div class="ng-meta"><span>${icon('calendar-days', 'ic sm')}${escapeHtml(next.date)}</span><span>${icon('clock-3', 'ic sm')}${next.hour}</span></div><span class="status ${escapeHtml(next.statusClass)}">${escapeHtml(next.status)}</span></div>
              ${icon('chevron-right', 'desktop-profile-next__arrow')}
            </a>
          </div>` : ''}
          <div class="desktop-profile-achievements">
            <h3>Conquistas</h3>
            <div class="achv-grid">
              <div class="achv"><span class="ic-wrap">${icon('flame')}</span><div><strong>Veterano</strong><small>10+ jogos</small></div></div>
              <div class="achv"><span class="ic-wrap">${icon('map')}</span><div><strong>Explorador</strong><small>5 quadras diferentes</small></div></div>
              <div class="achv locked"><span class="ic-wrap">${icon('star')}</span><div><strong>Avaliador</strong><small>Faça 3 avaliações</small></div></div>
            </div>
          </div>
        </section>

        <section class="card desktop-profile-about">
          <div class="desktop-profile-section-head">
            <div><h2>Sobre você</h2><p>Informações usadas nas suas reservas.</p></div>
            <button class="icon-btn" type="button" data-player-profile-edit aria-label="Editar dados pessoais" title="Editar dados pessoais">${icon('pencil')}</button>
          </div>
          <div class="desktop-profile-details">
            <div><span>E-mail</span><strong>${escapeHtml(profile.email)}</strong></div>
            <div><span>Celular</span><strong>${escapeHtml(profile.phone)}</strong></div>
            <div><span>Cidade</span><strong>${escapeHtml(profile.city)}</strong></div>
            <div><span>Esporte favorito</span><strong>${escapeHtml(profile.favoriteSport)}</strong></div>
          </div>
        </section>
      </div>

      <form id="player-profile-form" class="card desktop-profile-editor" data-player-profile-form hidden>
        <div class="desktop-profile-section-head">
          <div><h2>Editar perfil</h2><p>Atualize como suas informações aparecem no aplicativo.</p></div>
          <button class="icon-btn" type="button" data-player-profile-cancel aria-label="Fechar edicao">${icon('x')}</button>
        </div>
        <div class="inp"><label>Nome completo</label><input type="text" name="name" value="${escapeHtml(profile.name)}" autocomplete="name" required></div>
        <div class="input-row">
          <div class="inp"><label>E-mail</label><input type="email" name="email" value="${escapeHtml(profile.email)}" autocomplete="email" required></div>
          <div class="inp"><label>Celular</label><input type="tel" name="phone" value="${escapeHtml(profile.phone)}" autocomplete="tel" required></div>
        </div>
        <div class="input-row">
          <div class="inp"><label>Cidade</label><input type="text" name="city" value="${escapeHtml(profile.city)}" autocomplete="address-level2" required></div>
          <div class="inp"><label>CPF</label><input type="text" value="000.000.000-00" disabled></div>
        </div>
        <label class="field-lbl">Esportes que você curte</label>
        <div class="chips" data-player-profile-sports>${['Futebol Society', 'Beach Tennis', 'Volei', 'Basquete', 'Tenis'].map((item, index) => `<button type="button" class="chip ${index < 2 ? 'on' : ''}" data-chip-toggle>${item}</button>`).join('')}</div>
        <div class="desktop-profile-editor__actions">
          <button class="btn btn-outline" type="button" data-player-profile-cancel>Cancelar</button>
          <button class="btn btn-primary" type="submit">${icon('check', 'ic sm')}Salvar alterações</button>
        </div>
      </form>
    </div>`;
}

async function renderConfig(root) {
  const sports = await venueService.sports();
  root.innerHTML = `
    <form id="player-config-form" class="settings" data-player-demo-form data-success="Configurações salvas">
      <section class="set-card">
        <div class="set-aside"><h2>Notificações</h2><p>Como você quer ser avisado.</p></div>
        <div class="set-fields">
          <label class="switch-row"><span>Reserva confirmada</span><span class="switch on"></span></label>
          <label class="switch-row"><span>Lembrete 1h antes do jogo</span><span class="switch on"></span></label>
          <label class="switch-row"><span>Quadras novas perto de você</span><span class="switch"></span></label>
          <label class="switch-row"><span>Promocoes e cupons</span><span class="switch on"></span></label>
        </div>
      </section>
      <section class="set-card">
        <div class="set-aside"><h2>Preferências de jogo</h2><p>Deixamos a busca do seu jeito.</p></div>
        <div class="set-fields">
          <div class="input-row">
            <div class="inp"><label>Esporte padrão</label><select>${sports.map((sport) => `<option ${sport === 'Futebol Society' ? 'selected' : ''}>${escapeHtml(sport)}</option>`).join('')}</select></div>
            <div class="inp"><label>Distância padrão</label><select><option>Até 2 km</option><option selected>Até 5 km</option><option>Até 10 km</option></select></div>
          </div>
          <div class="inp"><label>Cidade</label><input type="text" value="Goiânia"></div>
        </div>
      </section>
      <section class="set-card">
        <div class="set-aside"><h2>Privacidade</h2><p>Controle quem ve seus dados.</p></div>
        <div class="set-fields">
          <label class="switch-row"><span>Mostrar meu nome para a arena<small>Ela vê quem reservou ao confirmar o horário</small></span><span class="switch on"></span></label>
          <label class="switch-row"><span>Compartilhar minhas estatísticas<small>Jogos e reservas aparecem no perfil público</small></span><span class="switch"></span></label>
        </div>
      </section>
      <section class="set-card danger">
        <div class="set-aside"><h2>Conta</h2><p>Encerrar a sessão ou excluir sua conta.</p></div>
        <div class="set-fields"><div style="display:flex;gap:10px"><a href="./login.html" class="btn btn-soft">Sair da conta</a><button type="button" class="btn btn-danger" disabled title="Disponivel quando a API de conta for conectada">Excluir conta</button></div></div>
      </section>
    </form>`;
}

async function renderMessages(root, route) {
  const conversations = await venueService.conversations();
  const selectedId = route.params.id || 0;
  const active = conversations.find((item) => item.id === Number(selectedId));
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
    pagamento: renderPayment,
    confirmado: renderConfirmation,
    reservas: renderReservations,
    favoritos: renderFavorites,
    carteira: renderWallet,
    carteiraAcao: renderWalletAction,
    perfil: renderProfile,
    config: renderConfig,
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
      const favoriteSport = profileForm.querySelector('[data-chip-toggle].on')?.textContent.trim();
      const changes = {
        name: String(data.get('name') || '').trim(),
        email: String(data.get('email') || '').trim(),
        phone: String(data.get('phone') || '').trim(),
        city: String(data.get('city') || '').trim()
      };
      if (favoriteSport) changes.favoriteSport = favoriteSport;
      await venueService.saveProfile(changes);
      const view = document.querySelector('[data-player-desktop-route-view]');
      await renderPlayerDesktopPage(currentRoute, view);
      window.pqToast?.('Perfil atualizado');
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
      booking.dataset.dayIndex = String(bookingDayOffset(calendarDate.dataset.playerCalendarDate));
      booking.dataset.date = calendarDate.dataset.playerCalendarDate;
      booking.dataset.hour = '';
      renderDesktopBookingCalendar(root);
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
