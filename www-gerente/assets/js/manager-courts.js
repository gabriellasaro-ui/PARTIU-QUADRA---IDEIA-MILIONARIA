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
import { API_BASE_URL } from '../../config/constants.js';
import managerService from '../../services/manager-api.js';

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

/* Quadras vivas: /api/gerente/quadras quando houver API. */
export async function loadCourts() {
  if (!API_BASE_URL) return courts();
  return managerService.quadras();
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

export async function renderManagerCourts(root) {
  const lista = API_BASE_URL ? await loadCourts() : courts();

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

  // Os numeros da vitrine existiam em ARENA e ninguem lia: estavam escritos
  // na mao no HTML.
  const views = root.querySelector('[data-showcase-views]');
  if (views) views.textContent = ARENA.views30d.toLocaleString('pt-BR');
  const conv = root.querySelector('[data-showcase-conversion]');
  if (conv) conv.textContent = `${String(ARENA.conversion).replace('.', ',')}%`;

  // Turbinar: estado com prazo, nao booleano.
  const boost = showcase();
  const ativo = boost.featuredUntil && new Date(boost.featuredUntil) > new Date();
  const status = root.querySelector('[data-boost-status]');
  if (status) {
    status.textContent = ativo
      ? `Turbinada até ${new Date(boost.featuredUntil).toLocaleDateString('pt-BR')}.`
      : 'Sua arena aparece na ordem normal, por avaliação.';
  }
  const btnBoost = root.querySelector('[data-boost-toggle]');
  if (btnBoost) btnBoost.textContent = ativo ? 'Turbinada' : 'Turbinar';
  root.querySelector('[data-boost]')?.classList.toggle('is-on', Boolean(ativo));

  // Vitrine: os toggles refletem o estado salvo, nao a classe escrita no HTML.
  const estado = showcase();
  root.querySelectorAll('[data-showcase-setting]').forEach((btn) => {
    const ligado = Boolean(estado[btn.dataset.showcaseSetting]);
    btn.classList.toggle('is-on', ligado);
    btn.setAttribute('aria-pressed', String(ligado));
  });


  window.pqRefreshIcons?.(root);
}

export function initManagerCourts() {
  document.addEventListener('click', async (event) => {
    const root = document.querySelector('[data-desktop-route-view]');
    if (!root) return;

    // Pausar/ativar e a unica edição que vale a pena fazer sem sair da
    // lista. O resto abre o formulario completo, que e uma pagina.
    const toggle = event.target.closest('[data-court-toggle]');
    if (toggle) {
      const court = (API_BASE_URL ? await loadCourts() : courts())
        .find((c) => String(c.id) === toggle.dataset.courtToggle);
      if (!court) return;
      if (API_BASE_URL) {
        try {
          await managerService.atualizarQuadra(court.id, { ativa: !court.active });
        } catch (error) {
          window.pqToast?.(error.message || 'Não foi possível salvar');
          return;
        }
      } else {
        saveCourt(court.id, { active: !court.active });
      }
      await renderManagerCourts(root);
      window.pqToast?.(court.active ? `${court.label} pausada` : `${court.label} ativada`);
      return;
    }

    if (event.target.closest('[data-boost-toggle]')) {
      const estado = showcase();
      const ativo = estado.featuredUntil && new Date(estado.featuredUntil) > new Date();
      if (ativo) {
        window.pqToast?.('Sua arena já está turbinada');
        return;
      }
      const ate = new Date();
      ate.setDate(ate.getDate() + 30);
      /* Grava tambem no override da quadra: e por venue_overrides que o
         Explorar do jogador enxerga, e sem isso "turbinar" nao mudaria
         nada na busca — a arena pagaria por um selo. */
      storage.set(SHOWCASE_KEY, { ...estado, featured: true, featuredUntil: ate.toISOString() });
      const over = storage.get('venue_overrides', {});
      over[ARENA.id] = { ...(over[ARENA.id] || {}), boosted: true, boostedUntil: ate.toISOString() };
      storage.set('venue_overrides', over);
      renderManagerCourts(root);
      window.pqToast?.('Arena turbinada por 30 dias');
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
