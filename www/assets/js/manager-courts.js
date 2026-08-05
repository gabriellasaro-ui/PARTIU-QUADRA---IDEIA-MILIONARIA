/* Minhas quadras — os espacos DESTA arena.

   A versao anterior listava venueService.list(), que devolve as 6 arenas do
   marketplace. Errado: o gerente nao administra a concorrencia. Aqui ele ve
   Society 1, Society 2 e Areia, que sao as quadras dentro da arena dele.

   Duas metades, como no app antigo:
   - Vitrine no Explorar: como a arena aparece para o jogador, com os numeros
     que justificam mexer nisso (visualizacoes, conversao) e a previa real.
   - Espacos cadastrados: o catalogo, com ocupacao e preco de cada quadra.

   Preço e status ficam em storage, entao o que a arena edita persiste. */
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

export function saveCourt(id, patch) {
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
        <a class="btn btn-soft" href="./dashboard.html#quadra/${court.id}">Editar</a>
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
      + `<a class="qcard add-card" href="./dashboard.html#quadra">
           <span class="add-ic"><svg class="ic lg"><use href="#i-plus"/></svg></span>
           <strong>Adicionar quadra</strong>
           <small>Cadastre mais um espaço da sua arena</small>
         </a>`;
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

export function initManagerCourts() {
  document.addEventListener('click', (event) => {
    const root = document.querySelector('[data-desktop-route-view]');
    if (!root) return;

    // Pausar/ativar e a unica edição que vale a pena fazer sem sair da
    // lista. O resto abre o formulario completo, que e uma pagina.
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
}
