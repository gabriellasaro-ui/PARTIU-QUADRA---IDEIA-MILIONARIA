/* Quadras da arena — a primeira tela do gerente ligada a dados de verdade.
   Ate aqui o app do gerente era HTML fixo: preco, nome e status eram texto
   escrito na mao, entao "a arena define o preco" nao existia.

   O que a arena grava aqui aparece para o jogador: venueService guarda um
   override por id e as leituras (list/featured/get) aplicam por cima. */
import venueService from '../../services/venues.js';
import { formatCurrency } from '../../utils/formatters.js';

const SURFACES = { 'Futebol Society': 'soccer', Futsal: 'futsal', Volei: 'sand', 'Beach Tennis': 'sand' };

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function venueCard(venue) {
  const surface = SURFACES[venue.sport] || 'soccer';
  const ativa = venue.active !== false;
  const mensal = Number(venue.priceMonthly || venue.price * 4);
  const economia = venue.price * 4 - mensal;

  return `<article class="qcard" data-manager-venue="${venue.id}">
    <div class="ph court-surface ${surface}">
      <span class="pill status ${ativa ? 'pago' : 'pendente'} tl">${ativa ? 'Ativa' : 'Pausada'}</span>
      <span class="pill star tr"><svg class="ic"><use href="#i-star"/></svg>${venue.rating}</span>
    </div>
    <div class="bd">
      <h3>${escapeHtml(venue.name)}</h3>
      <p class="meta"><svg class="ic"><use href="#i-pin"/></svg>${escapeHtml(venue.sport)} - ${escapeHtml(venue.neighborhood)}</p>
      <div class="tags">${venue.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>

      <div class="qcard-prices">
        <div>
          <small>Avulso</small>
          <strong>${formatCurrency(venue.price)}<span> /hora</span></strong>
        </div>
        <div>
          <small>Mensalista</small>
          <strong>${formatCurrency(mensal)}<span> /mês</span></strong>
          ${economia > 0 ? `<em>economia de ${formatCurrency(economia)}</em>` : ''}
        </div>
      </div>

      <div class="foot">
        <button class="btn" type="button" data-manager-venue-edit="${venue.id}">Editar preços</button>
        <button class="btn btn-soft" type="button" data-manager-venue-toggle="${venue.id}">${ativa ? 'Pausar' : 'Ativar'}</button>
      </div>
    </div>
  </article>`;
}

export async function renderManagerVenues(root) {
  const list = root.querySelector('[data-manager-venue-list]');
  if (!list) return;
  const venues = await venueService.list({});
  list.innerHTML = venues.map(venueCard).join('');
  window.pqRefreshIcons?.(list);
}

function openEditor(root, venue) {
  const dialog = root.querySelector('[data-manager-venue-dialog]');
  if (!dialog) return;
  dialog.querySelector('[data-venue-dialog-name]').textContent = venue.name;
  const form = dialog.querySelector('[data-manager-venue-form]');
  form.elements.id.value = venue.id;
  form.elements.price.value = venue.price;
  form.elements.priceMonthly.value = venue.priceMonthly || venue.price * 4;
  dialog.hidden = false;
}

function closeEditor(root) {
  const dialog = root.querySelector('[data-manager-venue-dialog]');
  if (dialog) dialog.hidden = true;
}

export function initManagerVenues() {
  document.addEventListener('click', async (event) => {
    const root = document.querySelector('[data-desktop-route-view]');
    if (!root) return;

    const edit = event.target.closest('[data-manager-venue-edit]');
    if (edit) {
      const venue = await venueService.get(edit.dataset.managerVenueEdit);
      if (venue) openEditor(root, venue);
      return;
    }

    if (event.target.closest('[data-manager-venue-cancel]')) {
      closeEditor(root);
      return;
    }

    const toggle = event.target.closest('[data-manager-venue-toggle]');
    if (toggle) {
      const venue = await venueService.get(toggle.dataset.managerVenueToggle);
      if (!venue) return;
      await venueService.saveVenue({ ...venue, active: venue.active === false });
      await renderManagerVenues(root);
      window.pqToast?.(venue.active === false ? 'Quadra ativada' : 'Quadra pausada');
    }
  });

  document.addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-manager-venue-form]');
    if (!form) return;
    event.preventDefault();
    if (!form.reportValidity()) return;
    const root = document.querySelector('[data-desktop-route-view]');
    const data = new FormData(form);
    const venue = await venueService.get(data.get('id'));
    if (!venue) return;
    await venueService.saveVenue({
      ...venue,
      price: Number(data.get('price')),
      priceMonthly: Number(data.get('priceMonthly'))
    });
    closeEditor(root);
    await renderManagerVenues(root);
    window.pqToast?.('Preços atualizados');
  });
}
