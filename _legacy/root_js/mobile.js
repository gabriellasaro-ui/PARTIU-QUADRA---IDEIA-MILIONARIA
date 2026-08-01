import venueService from '../../services/venues.js';
import storage from '../../storage/storage.js';
import { formatCurrency } from '../../utils/formatters.js';
import { imageFileToDataUrl } from '../../utils/helpers.js';

let currentRoute = null;
let activeMobileMap = null;
let activeUserMarker = null;
const DEFAULT_LOCATION = [-16.6950, -49.2550];
const LOCATION_COORDINATES = {
  'Goiania, GO': DEFAULT_LOCATION,
  'Aparecida de Goiania, GO': [-16.8233, -49.2434]
};
const SPORT_ICONS = {
  'Futebol Society': 'goal',
  'Beach Tennis': 'circle-dot',
  Volei: 'volleyball',
  Basquete: 'target',
  Tenis: 'activity',
  Futsal: 'trophy'
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

function currentLocation() {
  return storage.get('current_location', 'Goiania, GO');
}

function currentCoordinates() {
  const saved = storage.get('current_coordinates');
  if (currentLocation() === 'Localizacao atual' && Array.isArray(saved) && saved.length === 2) {
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
    form?.querySelectorAll('[name="esporte"]').forEach((input) => {
      input.checked = input.value === sport;
    });
    form?.querySelectorAll('[name="raio"]').forEach((input) => {
      input.checked = input.value === radius;
    });
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

function venueCard(venue, options = {}) {
  const action = options.action || 'Ver horarios';
  const removable = options.removable
    ? `<button class="favorite-float on" type="button" data-favorite-toggle="${venue.id}" aria-label="Remover dos favoritos">${icon('heart', 'ic fill')}</button>`
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

function buildDays() {
  const formatter = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' });
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() + index);
    const label = index === 0 ? 'Hoje' : index === 1 ? 'Amanh\u00e3' : formatter.format(date).replace('.', '');
    return { index, label, day: date.getDate(), date: localDateValue(date) };
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

async function renderHome(root) {
  const [sports, venues] = await Promise.all([venueService.sports(), venueService.featured()]);
  const greeting = root.querySelector('[data-home-greeting]');
  const chips = root.querySelector('[data-sport-chips]');
  const featured = root.querySelector('[data-featured-list]');

  if (greeting) {
    const hour = new Date().getHours();
    greeting.textContent = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  }
  if (chips) {
    chips.innerHTML = sports
      .map((sport) => `
        <a class="sport-item" href="#quadras?esporte=${encodeURIComponent(sport)}">
          <span>${icon(SPORT_ICONS[sport] || 'trophy')}</span>
          <strong>${escapeHtml(sport.replace(' Society', ''))}</strong>
        </a>`)
      .join('');
  }
  if (featured) featured.innerHTML = venues.map((venue) => venueCard(venue, { action: 'Reservar' })).join('');
  syncMarketplaceState(root);
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
    ? `${venues.length} quadras com horarios proximos`
    : `${venues.length} opcoes em ate ${radius} km`;
  const searchInput = root.querySelector('[data-search-form] [name="q"]');
  if (searchInput) searchInput.value = term;
  const radiusInput = root.querySelector('[data-search-form] [name="raio"]');
  if (radiusInput) radiusInput.value = radius;
  const locationInput = root.querySelector('[data-search-form] [name="local"]');
  if (locationInput) locationInput.value = local;
  const sportInput = root.querySelector('[data-search-sport]');
  if (sportInput) {
    sportInput.value = sport;
    sportInput.disabled = !sport;
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
        <p>Tente aumentar a distancia ou trocar o esporte.</p>
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
    ? `${venues.length} opcoes de ${sport}`
    : `${venues.length} quadras perto de voce`;
  filters.innerHTML = [
    `<a class="chip ${sport ? '' : 'on'}" href="#mapa">Todos</a>`,
    ...sports.map((item) => `<a class="chip ${item === sport ? 'on' : ''}" href="#mapa?esporte=${encodeURIComponent(item)}">${escapeHtml(item)}</a>`)
  ].join('');

  if (!window.L) {
    mapElement.innerHTML = `
      <div class="map-unavailable">
        ${icon('map-pin-off', 'ic lg')}
        <strong>Mapa indisponivel</strong>
        <span>Confira sua conexao e tente novamente.</span>
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
  }).addTo(activeMobileMap).bindPopup('Voce esta aqui');

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

  root.querySelector('[data-venue-hero]').src = venue.image;
  root.querySelector('[data-venue-hero]').alt = venue.name;
  root.querySelector('[data-venue-distance]').textContent = `${formatDistance(venue.distance)} km`;
  root.querySelector('[data-venue-name]').textContent = venue.name;
  root.querySelector('[data-venue-meta]').textContent = `${venue.sport} - ${venue.neighborhood}`;
  root.querySelector('[data-venue-rating]').textContent = venue.rating;
  root.querySelector('[data-venue-reviews]').textContent = `(${venue.reviews} avaliacoes)`;
  root.querySelector('[data-venue-tags]').innerHTML = venue.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('');

  const favoriteButton = root.querySelector('[data-favorite-toggle]');
  favoriteButton.dataset.favoriteToggle = venue.id;
  favoriteButton.classList.toggle('on', favoriteIds.includes(venue.id));

  const booking = root.querySelector('[data-booking]');
  booking.dataset.venueId = venue.id;
  booking.dataset.price = venue.price;
  booking.dataset.availability = JSON.stringify(availability);
  booking.dataset.dayIndex = '0';
  booking.dataset.duration = '1';
  booking.dataset.hour = availability.find((slot) => slot.status === 'free')?.hour || '';

  const days = buildDays();
  booking.dataset.date = days[0].date;
  root.querySelector('[data-days]').innerHTML = days.map((day) => `
    <button type="button" class="day ${day.index === 0 ? 'on' : ''}" data-day-index="${day.index}" data-booking-date="${day.date}" aria-pressed="${day.index === 0}">
      <span class="d">${escapeHtml(day.label)}</span>
      <span class="n">${day.day}</span>
    </button>`).join('');

  renderBooking(root);
}

function renderBooking(root) {
  const booking = root.querySelector('[data-booking]');
  if (!booking) return;

  const baseAvailability = JSON.parse(booking.dataset.availability || '[]');
  const dayIndex = Number(booking.dataset.dayIndex || 0);
  const availability = availabilityForDay(baseAvailability, dayIndex);
  let selectedHour = booking.dataset.hour;
  let duration = Number(booking.dataset.duration || 1);
  const freeHours = availability.filter((slot) => slot.status === 'free').map((slot) => Number(slot.hour.slice(0, 2)));

  if (!availability.some((slot) => slot.hour === selectedHour && slot.status === 'free')) {
    selectedHour = availability.find((slot) => slot.status === 'free')?.hour || '';
    booking.dataset.hour = selectedHour;
  }

  const start = Number(selectedHour.slice(0, 2));
  let maxDuration = 0;
  while (freeHours.includes(start + maxDuration) && maxDuration < 3) maxDuration += 1;
  if (duration > maxDuration) {
    duration = Math.max(1, maxDuration);
    booking.dataset.duration = String(duration);
  }

  const groups = [
    ['Manha', availability.filter((slot) => Number(slot.hour.slice(0, 2)) < 12)],
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
        const selected = selectedHour && hour >= start && hour < start + duration;
        return `<button type="button" class="slot ${slot.status} ${selected ? 'sel' : ''}" data-slot-hour="${slot.hour}" ${slot.status === 'busy' ? 'disabled' : ''}>${slot.hour}</button>`;
      }).join('')}</div>
    </div>`).join('');

  root.querySelectorAll('[data-duration]').forEach((button) => {
    const value = Number(button.dataset.duration);
    button.disabled = value > maxDuration;
    button.classList.toggle('off', value > maxDuration);
    button.classList.toggle('on', value === duration);
  });

  const price = Number(booking.dataset.price || 0);
  const total = price * duration;
  root.querySelector('[data-bk-range]').textContent = selectedHour ? `${selectedHour} a ${addHours(selectedHour, duration)}` : 'Escolha um horario';
  root.querySelector('[data-bk-hours]').textContent = selectedHour ? `(${duration}h)` : '';
  root.querySelector('[data-bk-sub]').textContent = selectedHour ? formatCurrency(total) : '-';
  root.querySelector('[data-bk-total]').textContent = selectedHour ? formatCurrency(total) : '-';

  const cta = root.querySelector('[data-bk-cta]');
  cta.classList.toggle('is-disabled', !selectedHour);
  cta.querySelector('[data-bk-cta-label]').textContent = selectedHour ? `Reservar - ${formatCurrency(total)}` : 'Escolha um horario';
  if (selectedHour) {
    const query = new URLSearchParams({
      date: booking.dataset.date || localDateValue(),
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
  const hour = query.get('hora') || '19:00';
  const duration = Math.max(1, Math.min(3, Number(query.get('dur') || 1)));
  const date = query.get('date') || localDateValue();
  return {
    venue,
    date,
    dateLabel: bookingDateLabel(date),
    hour,
    duration,
    endHour: addHours(hour, duration),
    total: venue.price * duration
  };
}

async function renderPayment(root, route) {
  const context = await bookingContext(route);
  if (!context) {
    location.hash = 'quadras';
    return;
  }
  const { venue, date, dateLabel, hour, duration, endHour, total } = context;
  root.querySelector('[data-back-venue]').href = `#quadra/${venue.id}`;
  root.querySelector('[data-payment-image]').src = venue.image;
  root.querySelector('[data-payment-image]').alt = venue.name;
  root.querySelector('[data-payment-name]').textContent = venue.name;
  root.querySelector('[data-payment-meta]').textContent = `${venue.sport} - ${venue.neighborhood}`;
  root.querySelector('[data-payment-date]').textContent = dateLabel;
  root.querySelector('[data-payment-hour]').textContent = `${hour} a ${endHour}`;
  root.querySelector('[data-payment-rent-label]').textContent = `Aluguel da quadra (${duration}h)`;
  root.querySelector('[data-payment-rent]').textContent = formatCurrency(total);
  root.querySelector('[data-payment-total]').textContent = formatCurrency(total);
  const cta = root.querySelector('[data-payment-cta]');
  const confirmationQuery = new URLSearchParams({
    date,
    hora: hour,
    dur: String(duration)
  });
  cta.href = `#confirmado/${venue.id}?${confirmationQuery}`;
  cta.textContent = `Pagar ${formatCurrency(total)}`;
}

async function renderConfirmation(root, route) {
  const context = await bookingContext(route);
  if (!context) {
    location.hash = 'quadras';
    return;
  }
  const { venue, date, dateLabel, hour, duration, endHour, total } = context;
  const code = `PQ-${venue.id}${date.slice(5).replace('-', '')}${hour.replace(':', '')}`;
  await venueService.saveReservation({
    code,
    venueId: venue.id,
    date: dateLabel,
    dateValue: date,
    hour,
    endHour,
    duration,
    price: total,
    status: 'Confirmada',
    statusClass: 'pago',
    group: 'proxima'
  });
  root.querySelector('[data-confirmation-ticket]').innerHTML = `
    <div class="row"><span class="k">Quadra</span><span class="v">${escapeHtml(venue.name)}</span></div>
    <div class="row"><span class="k">Esporte</span><span class="v">${escapeHtml(venue.sport)}</span></div>
    <div class="row"><span class="k">Local</span><span class="v">${escapeHtml(venue.neighborhood)}</span></div>
    <div class="row"><span class="k">Data</span><span class="v">${escapeHtml(dateLabel)}</span></div>
    <div class="row"><span class="k">Horario</span><span class="v">${hour} a ${endHour}</span></div>
    <div class="row"><span class="k">Codigo</span><span class="v code">${code}</span></div>`;
}

async function renderReservations(root) {
  const reservations = await venueService.reservations();
  const venues = await venueService.list();
  const list = root.querySelector('[data-reservation-list]');
  list.innerHTML = reservations.map((reservation) => {
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
        <p>Toque no coracao de uma quadra para salva-la aqui.</p>
        <a href="#quadras" class="btn block">Explorar quadras</a>
      </div>`;
}

async function renderWallet(root) {
  const wallet = await venueService.wallet();
  root.querySelector('[data-wallet-balance]').textContent = formatCurrency(wallet.balance);
  root.querySelector('[data-wallet-transactions]').innerHTML = wallet.transactions.map((item) => `
    <div class="transaction-row">
      <div><strong>${escapeHtml(item.description)}</strong><span>${escapeHtml(item.date)}</span></div>
      <b class="${item.value > 0 ? 'positive' : ''}">${item.value > 0 ? '+' : '-'} ${formatCurrency(Math.abs(item.value))}</b>
    </div>`).join('');
}

async function renderWalletAction(root, route) {
  const action = route.params.action;
  const wallet = await venueService.wallet();
  const title = root.querySelector('[data-wallet-action-title]');
  const content = root.querySelector('[data-wallet-action-content]');

  if (action === 'adicionar') {
    title.textContent = 'Adicionar saldo';
    content.innerHTML = `
      <div class="balance-inline">Saldo atual <strong>${formatCurrency(wallet.balance)}</strong></div>
      <div class="sec-head"><h2>Escolha um valor</h2></div>
      <div class="amount-grid">
        ${[30, 50, 100, 200].map((value, index) => `<button type="button" class="amount-option ${index === 1 ? 'on' : ''}" data-amount="${value}">${formatCurrency(value)}</button>`).join('')}
      </div>
      <div class="field"><label>Outro valor</label><input type="number" min="10" step="5" placeholder="R$ 0,00"></div>
      <button type="button" class="btn block" data-toast="Pix gerado para adicionar saldo">Gerar Pix</button>`;
    return;
  }

  if (action === 'cartao') {
    title.textContent = 'Adicionar cartao';
    content.innerHTML = `
      <form data-demo-form data-success="Cartao adicionado com sucesso">
        <div class="field"><label>Numero do cartao</label><input type="text" inputmode="numeric" placeholder="0000 0000 0000 0000" required></div>
        <div class="field"><label>Nome impresso</label><input type="text" placeholder="GABRIEL LISBOA" required></div>
        <div class="input-row mobile-two">
          <div class="field"><label>Validade</label><input type="text" inputmode="numeric" placeholder="MM/AA" required></div>
          <div class="field"><label>CVV</label><input type="text" inputmode="numeric" placeholder="000" required></div>
        </div>
        <button class="btn block" type="submit">Salvar cartao</button>
      </form>`;
    return;
  }

  title.textContent = 'Cupons';
  content.innerHTML = `
    <form class="coupon-form" data-demo-form data-success="Cupom aplicado com sucesso">
      <div class="field"><label>Codigo do cupom</label><input type="text" placeholder="Digite seu cupom" required></div>
      <button class="btn block" type="submit">Aplicar cupom</button>
    </form>
    <div class="sec-head"><h2>Cupons disponiveis</h2></div>
    <div class="coupon-list">${wallet.coupons.map((coupon) => `
      <button type="button" class="coupon-row" data-copy="${escapeHtml(coupon.code)}" data-copy-msg="Cupom copiado">
        <span><strong>${escapeHtml(coupon.code)}</strong><small>${escapeHtml(coupon.description)}</small></span>
        ${icon('chevron-right')}
      </button>`).join('')}</div>`;
}

function syncMobileProfile(root, user) {
  if (!root?.querySelector('[data-profile-name]')) return;
  const avatar = root.querySelector('[data-profile-avatar]');
  if (avatar) {
    avatar.classList.toggle('has-photo', Boolean(user.photo));
    avatar.innerHTML = user.photo
      ? `<img src="${escapeHtml(user.photo)}" alt="Foto de ${escapeHtml(user.name)}">`
      : escapeHtml(user.name.slice(0, 1));
  }
  root.querySelector('[data-profile-name]').textContent = user.name;
  root.querySelector('[data-profile-since]').textContent = `Jogador desde ${user.memberSince}`;
  root.querySelector('[data-profile-city]').textContent = user.city;
  root.querySelector('[data-profile-games]').textContent = user.stats.games;
  root.querySelector('[data-profile-reservations]').textContent = user.stats.reservations;
  root.querySelector('[data-profile-favorites]').textContent = user.stats.favorites;
  root.querySelector('[data-profile-sport]').textContent = user.favoriteSport;
  const form = root.querySelector('[data-profile-edit-form]');
  if (form) {
    form.elements.name.value = user.name;
    form.elements.email.value = user.email;
    form.elements.phone.value = user.phone;
    form.elements.city.value = user.city;
  }
}

async function renderProfile(root) {
  const user = await venueService.profile();
  syncMobileProfile(root, user);
}

async function renderMessages(root, route) {
  const conversations = await venueService.conversations();
  const conversationId = Number(route.params.id || 0);
  const active = conversations.find((item) => item.id === conversationId);
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

export async function renderMobilePage(route, root) {
  if (activeMobileMap) {
    activeMobileMap.remove();
    activeMobileMap = null;
    activeUserMarker = null;
  }
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
    mensagens: renderMessages
  };
  await renderers[route.name]?.(root, route);
  syncMarketplaceState(document);
}

export function initMobileActions() {
  document.addEventListener('submit', async (event) => {
    const search = event.target.closest('[data-search-form]');
    if (search) {
      event.preventDefault();
      const query = new URLSearchParams(new FormData(search));
      for (const [key, value] of [...query]) {
        if (!String(value).trim()) query.delete(key);
      }
      location.hash = `quadras${query.toString() ? `?${query}` : ''}`;
      return;
    }

    const filter = event.target.closest('[data-filter-form]');
    if (filter) {
      event.preventDefault();
      const data = new FormData(filter);
      const query = new URLSearchParams();
      const sport = data.get('esporte');
      const radius = data.get('raio');
      const now = data.get('agora');
      const currentQuery = routeQuery(currentRoute);
      const term = currentQuery.get('q');
      if (sport) query.set('esporte', sport);
      if (radius) query.set('raio', radius);
      if (now) query.set('agora', '1');
      if (term) query.set('q', term);
      query.set('local', currentLocation());
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

  document.addEventListener('change', async (event) => {
    const photoInput = event.target.closest('[data-profile-photo-input]');
    if (!photoInput) return;
    const file = photoInput.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      window.pqToast?.('Escolha uma imagem de ate 10 MB');
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
      window.pqToast?.(error.message || 'Nao foi possivel atualizar a foto');
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
      syncMarketplaceState(document);
      closeMarketSheet(locationOption.closest('[data-market-sheet]'));
      window.pqToast?.(`Localizacao alterada para ${value}`);
      return;
    }

    const useCurrentLocation = event.target.closest('[data-use-current-location]');
    if (useCurrentLocation) {
      if (!navigator.geolocation) {
        window.pqToast?.('Localizacao do aparelho indisponivel');
        return;
      }
      useCurrentLocation.disabled = true;
      navigator.geolocation.getCurrentPosition(
        (position) => {
          storage.set('current_coordinates', [position.coords.latitude, position.coords.longitude]);
          storage.set('current_location', 'Localizacao atual');
          syncMarketplaceState(document);
          closeMarketSheet(useCurrentLocation.closest('[data-market-sheet]'));
          useCurrentLocation.disabled = false;
          window.pqToast?.('Localizacao atualizada');
        },
        () => {
          useCurrentLocation.disabled = false;
          window.pqToast?.('Nao foi possivel acessar sua localizacao');
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
      );
      return;
    }

    const markNotifications = event.target.closest('[data-mark-notifications]');
    if (markNotifications) {
      storage.set('notifications_read', true);
      syncMarketplaceState(document);
      closeMarketSheet(markNotifications.closest('[data-market-sheet]'));
      window.pqToast?.('Notificacoes marcadas como lidas');
      return;
    }

    const locate = event.target.closest('[data-map-locate]');
    if (locate && activeMobileMap) {
      if (!navigator.geolocation) {
        activeMobileMap.setView(currentCoordinates(), 15, { animate: true });
        window.pqToast?.('Localizacao do aparelho indisponivel');
        return;
      }
      window.pqToast?.('Buscando sua localizacao...');
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const coordinates = [position.coords.latitude, position.coords.longitude];
          storage.set('current_coordinates', coordinates);
          storage.set('current_location', 'Localizacao atual');
          syncMarketplaceState(document);
          activeUserMarker?.setLatLng(coordinates);
          activeMobileMap?.setView(coordinates, 15, { animate: true });
          activeUserMarker?.openPopup();
        },
        () => {
          activeMobileMap?.setView(currentCoordinates(), 15, { animate: true });
          window.pqToast?.('Nao foi possivel acessar sua localizacao');
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
      );
      return;
    }

    const day = event.target.closest('[data-day-index]');
    if (day) {
      const root = day.closest('[data-venue-page]');
      const booking = root.querySelector('[data-booking]');
      booking.dataset.dayIndex = day.dataset.dayIndex;
      booking.dataset.date = day.dataset.bookingDate;
      booking.dataset.hour = '';
      root.querySelectorAll('[data-day-index]').forEach((button) => {
        const active = button === day;
        button.classList.toggle('on', active);
        button.setAttribute('aria-pressed', String(active));
      });
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

    const method = event.target.closest('[data-payment-method]');
    if (method) {
      const group = method.closest('[data-payment-methods]');
      group.querySelectorAll('[data-payment-method]').forEach((item) => item.classList.toggle('on', item === method));
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
