/* Minhas quadras — os espacos DESTA arena.

   A versao anterior listava venueService.list(), que devolve as 6 arenas do
   marketplace. Errado: o gerente nao administra a concorrencia. Aqui ele ve
   Society 1, Society 2 e Areia, que sao as quadras dentro da arena dele.

   Duas metades, como no app antigo:
   - Vitrine no Explorar: como a arena aparece para o jogador, com os numeros
     que justificam mexer nisso (visualizacoes, conversao) e a previa real.
   - Espacos cadastrados: o catalogo, com ocupacao e preco de cada quadra.

   Preco e status ficam em storage, entao o que a arena edita persiste. */
import { ARENA, COURTS } from '../../config/manager-data.js';
import storage from '../../storage/storage.js';
import { formatCurrency } from '../../utils/formatters.js';

const COURTS_KEY = 'manager-courts';
const SHOWCASE_KEY = 'manager-showcase';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

/* Os dados base sao fixos; o gerente so sobrescreve preco e status. Guardar
   o override em vez da quadra inteira evita que uma mudanca no catalogo
   fique presa atras de uma copia velha no localStorage. */
const overrides = () => storage.get(COURTS_KEY, {});

export function courts() {
  const over = overrides();
  const base = COURTS.map((court) => ({ ...court, ...(over[court.id] || {}) }));
  // Quadras que o gerente cadastrou existem so no override — sem isto elas
  // seriam salvas e desapareceriam no proximo render.
  const novas = Object.values(over).filter((c) => c.label && !COURTS.some((b) => b.id === c.id));
  return [...base, ...novas];
}

function saveCourt(id, patch) {
  const over = overrides();
  over[id] = { ...(over[id] || {}), ...patch };
  storage.set(COURTS_KEY, over);
}

export const showcase = () => ({
  visible: ARENA.visible,
  featured: ARENA.featured,
  ...storage.get(SHOWCASE_KEY, {})
});

function courtCard(court) {
  const mensal = Number(court.priceMonthly || court.price * 4);
  return `<article class="qcard" data-court="${court.id}">
    <div class="ph">
      <span class="pill tl status ${court.active ? 'pago' : 'pendente'}">${court.active ? 'Ativa' : 'Pausada'}</span>
      <img src="${escapeHtml(court.photo)}" alt="${escapeHtml(court.label)}" loading="lazy">
    </div>
    <div class="bd">
      <h3>${escapeHtml(court.label)}</h3>
      <p class="meta"><svg class="ic"><use href="#i-grid"/></svg>${escapeHtml(court.sport)} · ${formatCurrency(court.price)}/h</p>

      <div class="qcard-prices">
        <div><small>Avulso</small><strong>${formatCurrency(court.price)}<span> /hora</span></strong></div>
        <div><small>Mensalista</small><strong>${formatCurrency(mensal)}<span> /mês</span></strong></div>
      </div>

      <div class="faixa">
        <div class="faixa-top"><span>Ocupação</span><b>${court.occupancy}%</b></div>
        <div class="faixa-bar"><span style="width:${court.occupancy}%"></span></div>
      </div>

      <div class="foot">
        <button class="btn btn-soft" type="button" data-court-edit="${court.id}">Editar</button>
        <button class="btn btn-outline" type="button" data-court-toggle="${court.id}">${court.active ? 'Pausar' : 'Ativar'}</button>
      </div>
    </div>
  </article>`;
}

export function renderManagerCourts(root) {
  const lista = courts();

  const grid = root.querySelector('[data-court-list]');
  if (grid) {
    grid.innerHTML = lista.map(courtCard).join('')
      + `<button type="button" class="qcard add-card" data-court-new>
           <span class="add-ic"><svg class="ic lg"><use href="#i-plus"/></svg></span>
           <strong>Adicionar quadra</strong>
           <small>Cadastre mais um espaço da sua arena</small>
         </button>`;
  }

  const contador = root.querySelector('[data-court-count]');
  if (contador) {
    const ativas = lista.filter((c) => c.active).length;
    contador.textContent = `${lista.length} quadras cadastradas · ${ativas} ativas`;
  }

  // Vitrine: os toggles refletem o estado salvo, nao a classe escrita no HTML.
  const estado = showcase();
  root.querySelectorAll('[data-showcase-setting]').forEach((btn) => {
    const ligado = Boolean(estado[btn.dataset.showcaseSetting]);
    btn.classList.toggle('is-on', ligado);
    btn.setAttribute('aria-pressed', String(ligado));
  });

  // Previa: e a primeira quadra ativa que o jogador veria no Explorar.
  const destaque = lista.find((c) => c.active) || lista[0];
  const preview = root.querySelector('[data-showcase-preview]');
  if (preview && destaque) {
    preview.innerHTML = `<div class="manager-showcase-preview__image">
        <img src="${escapeHtml(destaque.photo)}" alt="${escapeHtml(ARENA.name)}">
        <span><svg class="ic sm"><use href="#i-pin"/></svg> ${ARENA.distance} km</span>
      </div>
      <div class="manager-showcase-preview__body">
        <div><strong>${escapeHtml(ARENA.name)}</strong><small>${escapeHtml(destaque.sport)} · ${escapeHtml(ARENA.neighborhood)}</small></div>
        <span><svg class="ic sm"><use href="#i-star"/></svg> ${ARENA.rating}</span>
      </div>`;
  }

  window.pqRefreshIcons?.(root);
}

function abrirEditor(root, court) {
  const dialog = root.querySelector('[data-court-dialog]');
  const form = root.querySelector('[data-court-form]');
  if (!dialog || !form) return;
  root.querySelector('[data-court-dialog-name]').textContent = court ? court.label : 'Nova quadra';
  form.elements.id.value = court?.id || '';
  form.elements.label.value = court?.label || '';
  form.elements.sport.value = court?.sport || 'Futebol Society';
  form.elements.price.value = court?.price ?? 120;
  form.elements.priceMonthly.value = court?.priceMonthly ?? 408;
  dialog.hidden = false;
}

export function initManagerCourts() {
  document.addEventListener('click', (event) => {
    const root = document.querySelector('[data-desktop-route-view]');
    if (!root) return;

    if (event.target.closest('[data-court-new]')) {
      abrirEditor(root, null);
      return;
    }
    if (event.target.closest('[data-court-cancel]')) {
      root.querySelector('[data-court-dialog]').hidden = true;
      return;
    }

    const editar = event.target.closest('[data-court-edit]');
    if (editar) {
      abrirEditor(root, courts().find((c) => String(c.id) === editar.dataset.courtEdit));
      return;
    }

    const toggle = event.target.closest('[data-court-toggle]');
    if (toggle) {
      const court = courts().find((c) => String(c.id) === toggle.dataset.courtToggle);
      if (!court) return;
      saveCourt(court.id, { active: !court.active });
      renderManagerCourts(root);
      window.pqToast?.(court.active ? `${court.label} pausada` : `${court.label} ativada`);
      return;
    }

    const setting = event.target.closest('[data-showcase-setting]');
    if (setting) {
      const chave = setting.dataset.showcaseSetting;
      const estado = showcase();
      storage.set(SHOWCASE_KEY, { ...estado, [chave]: !estado[chave] });
      renderManagerCourts(root);
    }
  });

  document.addEventListener('submit', (event) => {
    const form = event.target.closest('[data-court-form]');
    if (!form) return;
    event.preventDefault();
    if (!form.reportValidity()) return;

    const root = document.querySelector('[data-desktop-route-view]');
    const data = new FormData(form);
    const id = Number(data.get('id')) || Date.now();
    saveCourt(id, {
      id,
      label: String(data.get('label') || '').trim(),
      sport: String(data.get('sport') || ''),
      price: Number(data.get('price') || 0),
      priceMonthly: Number(data.get('priceMonthly') || 0),
      active: true,
      occupancy: courts().find((c) => c.id === id)?.occupancy ?? 0,
      photo: courts().find((c) => c.id === id)?.photo || COURTS[0].photo
    });

    root.querySelector('[data-court-dialog]').hidden = true;
    renderManagerCourts(root);
    window.pqToast?.('Quadra salva');
  });
}
