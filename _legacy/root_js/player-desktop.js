import venueService from '../../services/venues.js';
import { formatCurrency } from '../../utils/formatters.js';
import { imageFileToDataUrl } from '../../utils/helpers.js';

let currentRoute = null;
let desktopMap = null;
const USER_LOCATION = [-16.6950, -49.2550];
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
  if (localDateValue(date) === localDateValue(tomorrow)) return `Amanha, ${short}`;
  const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' }).format(date).replace('.', '');
  return `${weekday}, ${short}`;
}

function buildDays() {
  const formatter = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' });
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() + index);
    const label = index === 0 ? 'Hoje' : index === 1 ? 'Amanha' : formatter.format(date).replace('.', '');
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
          <a href="#quadra/${venue.id}" class="btn btn-primary">Ver horarios${icon('arrow-right', 'ic sm')}</a>
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
  const local = query.get('local') || 'Goiania, GO';
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
      ? `${venues.length} quadras com horarios proximos`
      : `${venues.length} quadras disponiveis perto de ${local}`;
  }
  const topbarSearch = document.querySelector('[data-player-desktop-search] [name="q"]');
  if (topbarSearch) topbarSearch.value = term;
  const sharedQuery = new URLSearchParams({ local, raio: radius });
  if (term) sharedQuery.set('q', term);
  if (sport) sharedQuery.set('esporte', sport);
  const nowQuery = new URLSearchParams(sharedQuery);
  nowQuery.set('agora', '1');

  root.innerHTML = `
    <section class="desktop-market-hero">
      <div class="desktop-market-hero__top">
        <div class="desktop-market-hero__copy">
          <span>${icon('map-pin', 'ic sm')}${escapeHtml(local)}</span>
          <h2>${now ? 'Horarios livres agora' : 'Quadras perto de voce'}</h2>
          <p>Escolha o esporte, ajuste a distancia e encontre o melhor horario.</p>
        </div>
        <div class="desktop-market-hero__actions">
          <a class="desktop-now-action" href="#quadras?${nowQuery}">${icon('zap')}Jogar agora</a>
          <button class="desktop-map-action" type="button" data-player-view="map">${icon('map-pinned')}Abrir mapa</button>
        </div>
      </div>
      <form class="toolbar desktop-market-search" data-player-explore-form>
        <div class="field grow">
          ${icon('search')}
          <input type="search" name="q" value="${escapeHtml(term)}" placeholder="Quadra, bairro ou esporte">
        </div>
        <div class="field desktop-location-field">
          ${icon('map-pin')}
          <input type="text" name="local" value="${escapeHtml(local)}" aria-label="Cidade ou regiao">
        </div>
        <div class="field">
          ${icon('trophy')}
          <select name="esporte" aria-label="Esporte">
            <option value="">Todos os esportes</option>
            ${sports.map((item) => `<option value="${escapeHtml(item)}" ${item === sport ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          ${icon('route')}
          <select name="raio" aria-label="Distancia maxima">
            ${['2', '5', '10'].map((value) => `<option value="${value}" ${value === radius ? 'selected' : ''}>Ate ${value} km</option>`).join('')}
          </select>
        </div>
        <button class="btn btn-primary" type="submit">${icon('arrow-right')}Buscar</button>
      </form>
    </section>

    <div class="chips desktop-sport-chips">
      <a class="chip ${sport ? '' : 'on'}" href="#quadras?local=${encodeURIComponent(local)}&raio=${radius}${term ? `&q=${encodeURIComponent(term)}` : ''}${now ? '&agora=1' : ''}">${icon('sparkles')}Todos</a>
      ${sports.map((item) => `<a class="chip ${item === sport ? 'on' : ''}" href="#quadras?local=${encodeURIComponent(local)}&raio=${radius}&esporte=${encodeURIComponent(item)}${term ? `&q=${encodeURIComponent(term)}` : ''}${now ? '&agora=1' : ''}">${icon(SPORT_ICONS[item] || 'trophy')}${escapeHtml(item)}</a>`).join('')}
    </div>

    <div class="res-bar">
      <div class="res-count"><b>${venues.length}</b> resultados${term ? ` para "${escapeHtml(term)}"` : sport ? ` para ${escapeHtml(sport)}` : ''} - ordenado por distancia</div>
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
          <p>Tente aumentar a distancia ou trocar o esporte.</p>
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
  const days = buildDays();
  const gallery = [venue.image, venue.image, venue.image];
  const pageTitle = document.querySelector('[data-page-title]');
  const pageSub = document.querySelector('[data-page-sub]');
  if (pageTitle) pageTitle.textContent = venue.name;
  if (pageSub) pageSub.textContent = `${venue.sport} - ${venue.neighborhood}`;
  document.title = `${venue.name} - Qadras`;

  root.innerHTML = `
    <a href="#quadras" class="back-link"><svg class="ic sm"><use href="#i-left"/></svg> Voltar para explorar</a>

    <div class="gallery">
      <div class="g-main">
        <span class="pill star"><svg class="ic"><use href="#i-star"/></svg>${venue.rating} - ${venue.reviews} avaliacoes</span>
        <button type="button" class="fav-heart ${favoriteIds.includes(venue.id) ? 'on' : ''}" data-player-favorite="${venue.id}" aria-label="Salvar nos favoritos">
          <svg class="ic fill"><use href="#i-heart"/></svg>
        </button>
        <img src="${escapeHtml(gallery[0])}" alt="${escapeHtml(venue.name)}">
      </div>
      <img src="${escapeHtml(gallery[1])}" alt="">
      <img src="${escapeHtml(gallery[2])}" alt="">
    </div>

    <div class="detail-cols" data-player-booking
         data-venue-id="${venue.id}" data-price="${venue.price}" data-day-index="0"
         data-date="${days[0].date}" data-duration="1"
         data-hour="${availability.find((slot) => slot.status === 'free')?.hour || ''}">
      <div class="detail-main">
        <h1>${escapeHtml(venue.name)}</h1>
        <div class="meta">
          <span class="star"><svg class="ic"><use href="#i-star"/></svg>${venue.rating}</span>
          <span><svg class="ic"><use href="#i-pin"/></svg>${escapeHtml(venue.neighborhood)} - ${venue.distance.toLocaleString('pt-BR')} km</span>
          <span><svg class="ic"><use href="#i-grid"/></svg>${escapeHtml(venue.sport)}</span>
        </div>

        <div class="dsection">
          <h2>Sobre a quadra</h2>
          <p class="desc">Quadra de ${escapeHtml(venue.sport.toLowerCase())} no ${escapeHtml(venue.neighborhood)}, com estrutura completa para sua partida. Espaco bem cuidado, ideal para jogos com os amigos, treinos ou campeonatos. Reserve online e pague pelo app.</p>
        </div>

        <div class="dsection">
          <h2>Comodidades</h2>
          <div class="amenities">
            ${[...venue.tags, 'Bola inclusa', 'Wi-Fi no local'].map((item) => `<div class="amenity"><svg class="ic"><use href="#i-check"/></svg>${escapeHtml(item)}</div>`).join('')}
          </div>
        </div>

        <div class="dsection">
          <h2>Disponibilidade</h2>
          <div class="days">
            ${days.map((day) => `
              <button type="button" class="day ${day.index === 0 ? 'on' : ''}" data-player-day="${day.index}" data-booking-date="${day.date}">
                <span class="d">${escapeHtml(day.label)}</span><span class="n">${day.day}</span>
              </button>`).join('')}
          </div>
          <div class="legend" style="margin-top:18px;">
            <span><i class="dot free"></i> Livre</span>
            <span><i class="dot busy"></i> Ocupado</span>
          </div>
          <div class="avail" data-player-slots></div>
          <div class="dur-seg" data-player-durations style="margin-top:18px;">
            <button type="button" class="dur on" data-player-duration="1">1 hora</button>
            <button type="button" class="dur" data-player-duration="2">2 horas</button>
            <button type="button" class="dur" data-player-duration="3">3 horas</button>
          </div>
        </div>
      </div>

      <aside>
        <div class="booking-card">
          <div class="bc-price">${money(venue.price)}<small> /hora</small></div>
          <div class="bc-rate"><svg class="ic"><use href="#i-star"/></svg>${venue.rating} <span style="color:var(--muted);font-weight:500;">- ${venue.reviews} avaliacoes</span></div>
          <div class="bc-fields">
            <div class="bc-field"><span class="k"><svg class="ic"><use href="#i-calendar"/></svg> Data</span><span class="v" data-player-booking-date>${dateLabel(days[0].date)}</span></div>
            <div class="bc-field"><span class="k"><svg class="ic"><use href="#i-clock"/></svg> Horario</span><span class="v" data-player-booking-range>Escolha um horario</span></div>
          </div>
          <div class="bc-summary">
            <div class="line"><span class="muted">Aluguel <span data-player-booking-hours></span></span><span data-player-booking-sub>-</span></div>
            <div class="line total"><span>Total</span><span data-player-booking-total>-</span></div>
          </div>
          <a class="btn btn-volt btn-lg btn-block is-disabled" data-player-booking-cta><span data-player-booking-label>Escolha um horario</span></a>
          <a href="#mensagens" class="btn btn-soft btn-block" style="margin-top:10px;"><svg class="ic sm"><use href="#i-chat"/></svg> Conversar com a arena</a>
          <div class="bc-note"><svg class="ic"><use href="#i-shield"/></svg> Voce so e cobrado apos confirmar</div>
        </div>
      </aside>
    </div>`;
  root.querySelector('[data-player-booking]').dataset.availability = JSON.stringify(availability);
  renderBooking(root);
}

function renderBooking(root) {
  const booking = root.querySelector('[data-player-booking]');
  if (!booking) return;
  const baseAvailability = JSON.parse(booking.dataset.availability || '[]');
  const availability = availabilityForDay(baseAvailability, Number(booking.dataset.dayIndex || 0));
  let selectedHour = booking.dataset.hour || '';
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
    ['Tarde', availability.filter((slot) => Number(slot.hour.slice(0, 2)) >= 12 && Number(slot.hour.slice(0, 2)) < 18)],
    ['Noite', availability.filter((slot) => Number(slot.hour.slice(0, 2)) >= 18)]
  ];
  root.querySelector('[data-player-slots]').innerHTML = groups.map(([label, slots]) => `
    <div class="avail-group">
      <div class="avail-lbl">${label}</div>
      <div class="avail-slots">${slots.map((slot) => {
        const hour = Number(slot.hour.slice(0, 2));
        const selected = selectedHour && hour >= start && hour < start + duration;
        return `<button type="button" class="slot ${slot.status} ${selected ? 'sel' : ''}" data-player-slot="${slot.hour}" ${slot.status === 'busy' ? 'disabled' : ''}>${slot.hour}</button>`;
      }).join('')}</div>
    </div>`).join('');

  root.querySelectorAll('[data-player-duration]').forEach((button) => {
    const value = Number(button.dataset.playerDuration);
    button.disabled = value > maxDuration;
    button.classList.toggle('off', value > maxDuration);
    button.classList.toggle('on', value === duration);
  });

  const total = Number(booking.dataset.price) * duration;
  root.querySelector('[data-player-booking-date]').textContent = dateLabel(booking.dataset.date);
  root.querySelector('[data-player-booking-range]').textContent = selectedHour ? `${selectedHour} - ${addHours(selectedHour, duration)}` : 'Escolha um horario';
  root.querySelector('[data-player-booking-hours]').textContent = selectedHour ? `(${duration}h)` : '';
  root.querySelector('[data-player-booking-sub]').textContent = selectedHour ? money(total) : '-';
  root.querySelector('[data-player-booking-total]').textContent = selectedHour ? money(total) : '-';
  const cta = root.querySelector('[data-player-booking-cta]');
  cta.classList.toggle('is-disabled', !selectedHour);
  cta.querySelector('[data-player-booking-label]').textContent = selectedHour ? `Reservar - ${money(total)}` : 'Escolha um horario';
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
  return {
    venue,
    date,
    dateText: dateLabel(date),
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
  const { venue, date, dateText, hour, duration, endHour, total } = context;
  const pageSub = document.querySelector('[data-page-sub]');
  if (pageSub) pageSub.textContent = `${venue.name} - ${dateText} - ${hour}`;
  const confirmation = new URLSearchParams({ date, hora: hour, dur: String(duration) });
  root.innerHTML = `
    <a href="#quadra/${venue.id}" class="back-link"><svg class="ic sm"><use href="#i-left"/></svg> Voltar para a quadra</a>
    <div class="split-2">
      <div>
        <div class="card">
          <h2>Forma de pagamento</h2>
          ${[
            ['i-zap', 'Pix', 'aprovacao na hora'],
            ['i-card', 'Cartao de credito', ''],
            ['i-wallet', 'Saldo Qadras', 'R$ 85,00 disponivel']
          ].map(([icon, label, sub], index) => `
            <button type="button" class="method ${index === 0 ? 'on' : ''}" data-player-payment-method>
              <span class="badge-ic"><svg class="ic"><use href="#${icon}"/></svg></span>
              <span>${label}${sub ? `<small> - ${sub}</small>` : ''}</span>
              <span class="ck"><svg class="ic"><use href="#i-check"/></svg></span>
            </button>`).join('')}
        </div>
        <form class="card" data-player-demo-form data-success="Dados conferidos">
          <h2>Seus dados</h2>
          <div class="inp"><label>Nome completo</label><input type="text" value="Gabriel Lisboa" required></div>
          <div class="input-row">
            <div class="inp"><label>E-mail</label><input type="email" value="gabriel@email.com" required></div>
            <div class="inp"><label>Celular</label><input type="tel" value="(62) 99999-0000" required></div>
          </div>
          <div class="inp" style="margin-bottom:0;"><label>CPF</label><input type="text" value="000.000.000-00" required></div>
        </form>
      </div>
      <aside>
        <div class="order-card">
          <div class="mini">
            <img src="${escapeHtml(venue.image)}" alt="${escapeHtml(venue.name)}">
            <div><h3>${escapeHtml(venue.name)}</h3><div class="meta">${escapeHtml(venue.sport)} - ${escapeHtml(venue.neighborhood)}</div></div>
          </div>
          <div class="line"><span class="muted">Data</span><span><b>${escapeHtml(dateText)}</b></span></div>
          <div class="line"><span class="muted">Horario</span><span><b>${hour} - ${endHour}</b></span></div>
          <div class="line"><span class="muted">Aluguel (${duration}h)</span><span>${money(total)}</span></div>
          <div class="line total"><span>Total</span><span>${money(total)}</span></div>
          <a href="#confirmado/${venue.id}?${confirmation}" class="btn btn-volt btn-lg btn-block" style="margin-top:16px;">Pagar ${money(total)}</a>
          <div class="bc-note"><svg class="ic"><use href="#i-shield"/></svg> Pagamento protegido e criptografado</div>
        </div>
      </aside>
    </div>`;
}

async function renderConfirmation(root, route) {
  const context = await bookingContext(route);
  if (!context) {
    location.hash = 'quadras';
    return;
  }
  const { venue, date, dateText, hour, duration, endHour, total } = context;
  const code = `PQ-${venue.id}${date.slice(5).replace('-', '')}${hour.replace(':', '')}`;
  const pageSub = document.querySelector('[data-page-sub]');
  if (pageSub) pageSub.textContent = `Codigo ${code}`;
  await venueService.saveReservation({
    code,
    venueId: venue.id,
    date: dateText,
    dateValue: date,
    hour,
    endHour,
    duration,
    price: total,
    status: 'Confirmada',
    statusClass: 'pago',
    group: 'proxima'
  });
  root.innerHTML = `
    <div class="confirm">
      <div class="ring"><svg class="ic"><use href="#i-check"/></svg></div>
      <h1>Tudo certo, esta marcado!</h1>
      <p class="sub">Enviamos o comprovante para o seu e-mail. E so chegar e jogar.</p>
      <div class="ticket">
        <div class="tk-top">
          <img src="${escapeHtml(venue.image)}" alt="${escapeHtml(venue.name)}">
          <div><h3>${escapeHtml(venue.name)}</h3><div class="m">${escapeHtml(venue.sport)} - ${escapeHtml(venue.neighborhood)}</div></div>
        </div>
        <div class="tk-body">
          <div class="row"><span class="k">Data</span><span class="v">${escapeHtml(dateText)}</span></div>
          <div class="row"><span class="k">Horario</span><span class="v">${hour} - ${endHour}</span></div>
          <div class="row"><span class="k">Endereco</span><span class="v">${escapeHtml(venue.neighborhood)}, Goiania</span></div>
          <div class="row"><span class="k">Pagamento</span><span class="v">Pix - aprovado</span></div>
          <div class="row"><span class="k">Codigo da reserva</span><span class="v code">${code}</span></div>
        </div>
      </div>
      <div class="confirm-actions">
        <a href="#reservas" class="btn btn-outline btn-lg">Minhas reservas</a>
        <a href="#quadras" class="btn btn-primary btn-lg">Reservar outra quadra</a>
      </div>
    </div>`;
}

async function renderReservations(root) {
  const [reservations, venues] = await Promise.all([
    venueService.reservations(),
    venueService.list()
  ]);
  const cards = reservations.map((reservation) => {
    const venue = venues.find((item) => item.id === reservation.venueId);
    if (!venue) return '';
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
            <a href="#quadra/${venue.id}" class="btn btn-outline">Reagendar</a>
          </div>
        </div>
      </article>`;
  }).join('');
  root.innerHTML = `
    <section class="desktop-reservations-view">
    <div class="tabs" data-seg data-target="#player-reservations">
      <a class="on" data-filter="proxima">Proximas</a>
      <a data-filter="historico">Historico</a>
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

async function renderWallet(root) {
  const wallet = await venueService.wallet();
  root.innerHTML = `
    <div class="split-2">
      <div>
        <div class="wallet-hero">
          <div><div class="wh-label">Saldo disponivel</div><div class="wh-val num">${money(wallet.balance)}</div></div>
          <div class="wh-actions">
            <a href="#carteira/adicionar" class="btn btn-volt">Adicionar saldo</a>
            <a href="#carteira/cupom" class="btn btn-ghost">Usar cupom</a>
          </div>
        </div>
        <div class="panel">
          <div class="panel-head"><h2>Extrato</h2><button class="lk" type="button" data-csv-table="#player-statement" data-csv-name="extrato-partiu-quadra.csv">Exportar CSV</button></div>
          <table class="tbl" id="player-statement">
            <thead><tr><th>Data</th><th>Descricao</th><th>Valor</th></tr></thead>
            <tbody>${wallet.transactions.map((item) => `
              <tr>
                <td>${escapeHtml(item.date)}</td>
                <td>${escapeHtml(item.description)}</td>
                <td class="val num" style="color:${item.value > 0 ? 'var(--green-600)' : 'var(--ink)'}">${item.value > 0 ? '+ ' : ''}${money(Math.abs(item.value))}</td>
              </tr>`).join('')}</tbody>
          </table>
        </div>
      </div>
      <aside>
        <div class="card">
          <h2>Formas de pagamento</h2>
          <div class="method on"><span class="badge-ic"><svg class="ic"><use href="#i-zap"/></svg></span><span>Pix <small>- aprovacao na hora</small></span><span class="ck"><svg class="ic"><use href="#i-check"/></svg></span></div>
          <div class="method"><span class="badge-ic"><svg class="ic"><use href="#i-card"/></svg></span><span>Cartao final 4321 <small>- Visa</small></span><span class="ck"><svg class="ic"><use href="#i-check"/></svg></span></div>
          <a href="#carteira/cartao" class="btn btn-outline btn-block" style="margin-top:6px;"><svg class="ic sm"><use href="#i-plus"/></svg> Adicionar cartao</a>
        </div>
        <div class="card" style="margin-bottom:0;">
          <h2>Indique e ganhe</h2>
          <p style="font-size:14px;color:var(--ink-2);line-height:1.6;">Cada amigo que reservar pela sua indicacao vira <b>R$ 20 de cashback</b> na sua carteira.</p>
          <button type="button" class="btn btn-primary btn-block" data-copy="https://partiu.app/r/GABRIEL20" data-copy-msg="Link de indicacao copiado!" style="margin-top:8px;"><svg class="ic sm"><use href="#i-gift"/></svg> Copiar meu link</button>
        </div>
      </aside>
    </div>`;
}

async function renderWalletAction(root, route) {
  const wallet = await venueService.wallet();
  const action = route.params.action || 'adicionar';
  const pageTitle = document.querySelector('[data-page-title]');
  const pageSub = document.querySelector('[data-page-sub]');
  if (action === 'cupom') {
    if (pageTitle) pageTitle.textContent = 'Usar cupom';
    if (pageSub) pageSub.textContent = 'Aplique um codigo e ganhe desconto ou bonus';
    root.innerHTML = `
      <a href="#carteira" class="back-link"><svg class="ic sm"><use href="#i-left"/></svg> Voltar para a carteira</a>
      <div class="split-2">
        <form class="card" data-player-demo-form data-success="Cupom aplicado com sucesso">
          <h2>Tem um cupom?</h2>
          <div class="inp"><label>Codigo do cupom</label><input type="text" name="codigo" placeholder="Ex.: PARTIU10" required></div>
          <button type="submit" class="btn btn-volt btn-lg btn-block"><svg class="ic sm"><use href="#i-gift"/></svg> Aplicar cupom</button>
        </form>
        <aside class="card">
          <h2>Cupons disponiveis</h2>
          <div class="rlist">${wallet.coupons.map((coupon) => `
            <div class="coupon">
              <div class="coupon-code">${escapeHtml(coupon.code)}</div>
              <div class="coupon-desc">${escapeHtml(coupon.description)}</div>
              <button type="button" class="btn btn-soft btn-xs" data-copy="${escapeHtml(coupon.code)}" data-copy-msg="Codigo copiado">Copiar</button>
            </div>`).join('')}</div>
        </aside>
      </div>`;
    return;
  }
  if (action === 'cartao') {
    if (pageTitle) pageTitle.textContent = 'Adicionar cartao';
    if (pageSub) pageSub.textContent = 'Cadastre um cartao para pagar mais rapido';
    root.innerHTML = `
      <a href="#carteira" class="back-link"><svg class="ic sm"><use href="#i-left"/></svg> Voltar para a carteira</a>
      <form class="split-2" data-player-demo-form data-success="Cartao salvo com sucesso">
        <div class="card">
          <h2>Dados do cartao</h2>
          <div class="inp"><label>Numero do cartao</label><input type="text" placeholder="0000 0000 0000 0000" required></div>
          <div class="inp"><label>Nome impresso no cartao</label><input type="text" placeholder="GABRIEL LISBOA" required></div>
          <div class="input-row">
            <div class="inp"><label>Validade</label><input type="text" placeholder="MM/AA" required></div>
            <div class="inp"><label>CVV</label><input type="text" placeholder="123" required></div>
          </div>
        </div>
        <aside><div class="order-card"><h3>Cartao de credito</h3><p class="muted" style="margin:12px 0;line-height:1.6;">Seus dados sao protegidos e criptografados.</p><button type="submit" class="btn btn-primary btn-lg btn-block">Salvar cartao</button><div class="bc-note"><svg class="ic"><use href="#i-shield"/></svg> Pagamento seguro</div></div></aside>
      </form>`;
    return;
  }
  if (pageTitle) pageTitle.textContent = 'Adicionar saldo';
  if (pageSub) pageSub.textContent = 'Recarregue sua carteira via Pix';
  root.innerHTML = `
    <a href="#carteira" class="back-link"><svg class="ic sm"><use href="#i-left"/></svg> Voltar para a carteira</a>
    <form class="split-2" data-player-demo-form data-success="Pix gerado com sucesso">
      <div>
        <div class="card">
          <h2>Quanto quer adicionar?</h2>
          <div class="chips">${[30, 50, 100, 200].map((value) => `<button type="button" class="chip ${value === 100 ? 'on' : ''}" data-chip-toggle>${money(value)}</button>`).join('')}</div>
          <div class="inp"><label>Ou digite um valor</label><input type="number" value="100" min="10" step="10"></div>
        </div>
        <div class="card"><h2>Forma de pagamento</h2><div class="method on"><span class="badge-ic"><svg class="ic"><use href="#i-zap"/></svg></span><span>Pix <small>- cai na hora</small></span><span class="ck"><svg class="ic"><use href="#i-check"/></svg></span></div></div>
      </div>
      <aside><div class="order-card"><h3>Sua carteira</h3><div class="line"><span class="muted">Saldo atual</span><span>${money(wallet.balance)}</span></div><div class="line"><span class="muted">Recarga</span><span>${money(100)}</span></div><div class="line total"><span>Novo saldo</span><span>${money(wallet.balance + 100)}</span></div><button type="submit" class="btn btn-volt btn-lg btn-block" style="margin-top:16px;">Gerar Pix</button></div></aside>
    </form>`;
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
        <div class="desktop-profile-cover"></div>
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
          <button class="btn btn-outline desktop-profile-edit" type="button" data-player-profile-edit>
            ${icon('pencil', 'ic sm')}Editar perfil
          </button>
        </div>
        <div class="prof-stats desktop-profile-stats">
          <div><b class="num">${profile.stats.games}</b><span>jogos</span></div>
          <div><b class="num">${profile.stats.reservations}</b><span>reservas</span></div>
          <div><b class="num">${profile.stats.favorites}</b><span>favoritas</span></div>
        </div>
      </section>

      <div class="desktop-profile-grid">
        <div class="desktop-profile-column">
        ${next && nextVenue ? `
          <div class="card">
            <h2>Proximo jogo</h2>
            <a href="#quadra/${nextVenue.id}" class="next-game">
              <img src="${escapeHtml(nextVenue.image)}" alt="${escapeHtml(nextVenue.name)}">
              <div class="ng-info"><strong>${escapeHtml(nextVenue.name)}</strong><div class="ng-meta"><span>${icon('calendar-days', 'ic sm')}${escapeHtml(next.date)}</span><span>${icon('clock-3', 'ic sm')}${next.hour}</span></div><span class="status ${escapeHtml(next.statusClass)}">${escapeHtml(next.status)}</span></div>
            </a>
          </div>` : ''}
        <div class="card"><h2>Conquistas</h2><div class="achv-grid">
          <div class="achv"><span class="ic-wrap">${icon('flame')}</span><div><strong>Veterano</strong><small>10+ jogos</small></div></div>
          <div class="achv"><span class="ic-wrap">${icon('map')}</span><div><strong>Explorador</strong><small>5 quadras diferentes</small></div></div>
          <div class="achv locked"><span class="ic-wrap">${icon('star')}</span><div><strong>Avaliador</strong><small>Faca 3 avaliacoes</small></div></div>
        </div></div>
        </div>

        <section class="card desktop-profile-about">
          <div class="desktop-profile-section-head">
            <div><h2>Sobre voce</h2><p>Informacoes usadas nas suas reservas.</p></div>
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
          <div><h2>Editar perfil</h2><p>Atualize como suas informacoes aparecem no aplicativo.</p></div>
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
        <label class="field-lbl">Esportes que voce curte</label>
        <div class="chips" data-player-profile-sports>${['Futebol Society', 'Beach Tennis', 'Volei', 'Basquete', 'Tenis'].map((item, index) => `<button type="button" class="chip ${index < 2 ? 'on' : ''}" data-chip-toggle>${item}</button>`).join('')}</div>
        <div class="desktop-profile-editor__actions">
          <button class="btn btn-outline" type="button" data-player-profile-cancel>Cancelar</button>
          <button class="btn btn-primary" type="submit">${icon('check', 'ic sm')}Salvar alteracoes</button>
        </div>
      </form>
    </div>`;
}

async function renderConfig(root) {
  const sports = await venueService.sports();
  root.innerHTML = `
    <form id="player-config-form" class="settings" data-player-demo-form data-success="Configuracoes salvas">
      <section class="set-card">
        <div class="set-aside"><h2>Notificacoes</h2><p>Como voce quer ser avisado.</p></div>
        <div class="set-fields">
          <label class="switch-row"><span>Reserva confirmada</span><span class="switch on"></span></label>
          <label class="switch-row"><span>Lembrete 1h antes do jogo</span><span class="switch on"></span></label>
          <label class="switch-row"><span>Quadras novas perto de voce</span><span class="switch"></span></label>
          <label class="switch-row"><span>Promocoes e cupons</span><span class="switch on"></span></label>
        </div>
      </section>
      <section class="set-card">
        <div class="set-aside"><h2>Preferencias de jogo</h2><p>Deixamos a busca do seu jeito.</p></div>
        <div class="set-fields">
          <div class="input-row">
            <div class="inp"><label>Esporte padrao</label><select>${sports.map((sport) => `<option ${sport === 'Futebol Society' ? 'selected' : ''}>${escapeHtml(sport)}</option>`).join('')}</select></div>
            <div class="inp"><label>Distancia padrao</label><select><option>Ate 2 km</option><option selected>Ate 5 km</option><option>Ate 10 km</option></select></div>
          </div>
          <div class="inp"><label>Cidade</label><input type="text" value="Goiania"></div>
        </div>
      </section>
      <section class="set-card">
        <div class="set-aside"><h2>Privacidade</h2><p>Controle quem ve seus dados.</p></div>
        <div class="set-fields">
          <label class="switch-row"><span>Mostrar meu nome para a arena<small>Ela ve quem reservou ao confirmar o horario</small></span><span class="switch on"></span></label>
          <label class="switch-row"><span>Compartilhar minhas estatisticas<small>Jogos e reservas aparecem no perfil publico</small></span><span class="switch"></span></label>
        </div>
      </section>
      <section class="set-card danger">
        <div class="set-aside"><h2>Conta</h2><p>Encerrar a sessao ou excluir sua conta.</p></div>
        <div class="set-fields"><div style="display:flex;gap:10px"><a href="./login.html" class="btn btn-soft">Sair da conta</a><button type="button" class="btn btn-danger" disabled title="Disponivel quando a API de conta for conectada">Excluir conta</button></div></div>
      </section>
    </form>`;
}

async function renderMessages(root, route) {
  const conversations = await venueService.conversations();
  const selectedId = route.params.id || conversations[0]?.id || 0;
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
  const search = document.querySelector('[data-player-desktop-search]');
  const actions = document.querySelector('[data-player-topbar-actions]');
  if (search) search.hidden = route.name !== 'quadras';
  if (!actions) return;
  if (route.name === 'perfil') {
    actions.innerHTML = `<button type="button" class="btn btn-outline" data-player-profile-edit>${icon('pencil', 'ic sm')}Editar perfil</button>`;
  } else if (route.name === 'config') {
    actions.innerHTML = '<button type="submit" form="player-config-form" class="btn btn-primary">Salvar alteracoes</button>';
  } else {
    actions.replaceChildren();
  }
  window.pqRefreshIcons?.(actions);
}

export async function renderPlayerDesktopPage(route, root) {
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
    mensagens: renderMessages
  };
  const page = root.querySelector('[data-player-desktop-page]');
  if (!page || !renderers[route.name]) return;
  await renderers[route.name](page, route);
  updateTopbar(route);
  window.pqRefreshIcons?.(page);
}

export function initPlayerDesktopActions() {
  document.addEventListener('submit', async (event) => {
    const explore = event.target.closest('[data-player-explore-form], [data-player-desktop-search]');
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
      window.pqToast?.(demo.dataset.success || 'Alteracoes salvas');
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
      window.pqToast?.('Escolha uma imagem de ate 10 MB');
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
      window.pqToast?.(error.message || 'Nao foi possivel atualizar a foto');
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

    const day = event.target.closest('[data-player-day]');
    if (day) {
      const root = day.closest('[data-player-desktop-page]');
      const booking = root.querySelector('[data-player-booking]');
      booking.dataset.dayIndex = day.dataset.playerDay;
      booking.dataset.date = day.dataset.bookingDate;
      booking.dataset.hour = '';
      root.querySelectorAll('[data-player-day]').forEach((button) => button.classList.toggle('on', button === day));
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

    const method = event.target.closest('[data-player-payment-method]');
    if (method) {
      method.parentElement.querySelectorAll('[data-player-payment-method]').forEach((item) => item.classList.toggle('on', item === method));
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
