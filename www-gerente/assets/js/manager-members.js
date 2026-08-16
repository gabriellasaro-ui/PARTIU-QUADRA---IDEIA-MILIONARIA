/* Mensalistas da arena — refeito com os dados e a estrutura do app antigo.

   O que estava errado antes: a lista comecava vazia (os tres mensalistas do
   app antigo tinham virado HTML fixo e sumiram na refatoracao) e o select de
   quadra oferecia as 6 arenas do marketplace em vez de Society 1 / Society 2
   / Areia. Agora as duas coisas vem de config/manager-data.js.

   Duas origens, de proposito:
   - "pelo app": o plano nasceu de uma reserva mensalista do jogador. Nao da
     para editar aqui, porque quem manda e a reserva.
   - "cadastro manual": o gerente fechou por fora e registrou. Esse ele
     edita e remove.

   Mostrar as duas juntas e o ponto: para a operacao da quadra, os dois
   ocupam o mesmo horário toda semana. A origem so muda quem pode alterar. */
import venueService from '../../services/venues.js';
import storage from '../../storage/storage.js';
import { formatCurrency } from '../../utils/formatters.js';
import { ARENA_MEMBERS } from '../../config/manager-data.js';
import { courts, loadCourts } from './manager-courts.js';
import { API_BASE_URL } from '../../config/constants.js';
import managerService from '../../services/manager-api.js';

const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
// Dia da semana em ingles no formato do backend (0=segunda..6=domingo).
const DIA_INDICE = { domingo: 6, segunda: 0, terça: 1, quarta: 2, quinta: 3, sexta: 4, sábado: 5 };
// Mesma chave do app antigo: quem ja tinha mensalista cadastrado nao perde.
const KEY = 'manager-members';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

/* Semeia com os mensalistas da arena na primeira visita. Depois disso quem
   manda e o storage — inclusive se o gerente apagar todos, a lista fica
   vazia em vez de ressuscitar os tres. */
function manuais() {
  const salvo = storage.get(KEY, null);
  if (salvo === null) {
    storage.set(KEY, ARENA_MEMBERS);
    return ARENA_MEMBERS;
  }
  return salvo;
}

function linha({ id, name, court, day, time, price, status, origem }) {
  const doApp = origem === 'app';
  const editavel = origem === 'manual';
  return `<article class="manager-member" data-member-id="${escapeHtml(id)}">
    <span class="manager-avatar">${escapeHtml(String(name).charAt(0).toUpperCase())}</span>
    <div class="manager-member__person">
      <strong>${escapeHtml(name)}</strong>
      <small>${escapeHtml(court)}</small>
    </div>
    <div><span>Recorrência</span><strong>Toda ${escapeHtml(day)} · ${escapeHtml(time)}</strong></div>
    <div><span>Mensalidade</span><strong class="num">${formatCurrency(price)}</strong></div>
    <span class="status ${doApp ? 'pago' : (status === 'renovando' ? 'pendente' : 'confirmado')}">${
      doApp ? 'Pelo app' : (status === 'renovando' ? 'Renovando' : 'Ativo')
    }</span>
    <div class="manager-row-actions">
      ${doApp
        ? '<span class="manager-locked" title="Este plano vem de uma reserva do app">—</span>'
        : `${editavel ? `<button type="button" class="manager-row-menu" data-member-edit="${escapeHtml(id)}" aria-label="Editar ${escapeHtml(name)}"><svg class="ic"><use href="#i-pencil"/></svg></button>` : ''}
           <button type="button" class="manager-row-menu is-danger" data-member-remove="${escapeHtml(id)}" aria-label="Remover ${escapeHtml(name)}"><svg class="ic"><use href="#i-x"/></svg></button>`}
    </div>
  </article>`;
}

/* Planos vindos do app: um por reserva mensalista.

   Falha em silencio de proposito. Isto e um extra por cima da lista da
   arena, e ha copias do venueService sem peladas(): sem o try, um metodo
   ausente derrubava a tela inteira e o gerente ficava sem ver nem os
   mensalistas que ele mesmo cadastrou. */
async function planosDoApp() {
  try {
    return await lerPlanosDoApp();
  } catch {
    return [];
  }
}

async function lerPlanosDoApp() {
  const [peladas, perfil] = await Promise.all([venueService.peladas(), venueService.profile()]);
  const mapa = new Map();
  peladas.filter((p) => p.plan === 'mensalista' && p.reservationCode).forEach((p) => {
    if (mapa.has(p.reservationCode)) return;
    mapa.set(p.reservationCode, {
      id: p.reservationCode,
      name: perfil.name,
      court: p.venueName,
      day: WEEKDAYS[new Date(`${p.dateISO}T12:00`).getDay()],
      time: p.startTime,
      price: 0,
      origem: 'app'
    });
  });
  // O valor do plano esta na reserva, nao na pelada.
  const reservas = await venueService.reservations();
  mapa.forEach((plano, code) => {
    plano.price = reservas.find((r) => r.code === code)?.price || 0;
  });
  return [...mapa.values()];
}

export async function renderManagerMembers(root) {
  const list = root.querySelector('[data-member-list]');
  if (!list) return;

  // Com API a lista inteira vem do backend — incluindo os planos abertos
  // pelo app, entao o extra do venueService (catalogo do marketplace) nao se
  // aplica. Sem API, o comportamento e o antigo: planos do app + cadastros
  // manuais do storage.
  let todos;
  let opcoesQuadras;
  if (API_BASE_URL) {
    todos = (await managerService.mensalistas()).map((m) => ({ ...m, origem: 'api' }));
    opcoesQuadras = await loadCourts();
  } else {
    const doApp = await planosDoApp();
    todos = [...doApp, ...manuais().map((m) => ({ ...m, origem: 'manual' }))];
    opcoesQuadras = courts();
  }

  list.innerHTML = todos.length
    ? todos.map(linha).join('')
    : '<p class="panel-sub">Nenhum mensalista ainda. Quem assinar pelo app entra aqui sozinho; quem fechar por fora você cadastra no botão acima.</p>';

  // Resumo: o que a recorrencia representa para o caixa da arena.
  const receita = todos.reduce((t, m) => t + Number(m.price || 0), 0);
  const set = (sel, valor) => {
    const el = root.querySelector(sel);
    if (el) el.textContent = valor;
  };
  set('[data-member-count]', todos.length);
  set('[data-member-total]', todos.length);
  set('[data-member-revenue]', formatCurrency(receita));
  // Cada mensalista trava um horário por semana — 4 sessoes no mes.
  set('[data-member-slots]', todos.length * 4);

  const select = root.querySelector('[data-member-courts]');
  if (select) {
    const atual = select.value;
    select.innerHTML = opcoesQuadras.map((c) => `<option>${escapeHtml(c.label)}</option>`).join('');
    if (atual) select.value = atual;
  }

  window.pqRefreshIcons?.(root);
}

function abrirEditor(root, membro) {
  const dialog = root.querySelector('[data-member-dialog]');
  const form = root.querySelector('[data-member-form]');
  if (!dialog || !form) return;
  root.querySelector('[data-member-dialog-title]').textContent = membro ? 'Editar mensalista' : 'Novo mensalista';
  form.elements.id.value = membro?.id || '';
  form.elements.name.value = membro?.name || '';
  form.elements.day.value = membro ? membro.day.charAt(0).toUpperCase() + membro.day.slice(1) : 'Quarta';
  form.elements.time.value = membro?.time || '20:00';
  form.elements.price.value = membro?.price || 420;
  if (membro?.court) form.elements.court.value = membro.court;
  dialog.hidden = false;
}

export function initManagerMembers() {
  document.addEventListener('click', async (event) => {
    const root = document.querySelector('[data-desktop-route-view]');
    if (!root) return;

    if (event.target.closest('[data-member-new]')) {
      abrirEditor(root, null);
      return;
    }
    if (event.target.closest('[data-member-cancel]')) {
      root.querySelector('[data-member-dialog]').hidden = true;
      return;
    }

    const editar = event.target.closest('[data-member-edit]');
    if (editar) {
      abrirEditor(root, manuais().find((m) => m.id === editar.dataset.memberEdit));
      return;
    }

    const remover = event.target.closest('[data-member-remove]');
    if (remover) {
      const id = remover.dataset.memberRemove;
      if (API_BASE_URL) {
        try {
          await managerService.cancelarMensalista(id);
        } catch (error) {
          window.pqToast?.(error.message || 'Não foi possível remover');
          return;
        }
      } else {
        storage.set(KEY, manuais().filter((m) => m.id !== id));
      }
      await renderManagerMembers(root);
      window.pqToast?.('Mensalista removido');
    }
  });

  document.addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-member-form]');
    if (!form) return;
    event.preventDefault();
    if (!form.reportValidity()) return;

    const root = document.querySelector('[data-desktop-route-view]');
    const data = new FormData(form);

    if (API_BASE_URL) {
      const nome = String(data.get('name') || '').trim();
      const diaPt = String(data.get('day') || 'quarta').toLowerCase();
      const hora = String(data.get('time') || '20:00');
      const quadra = String(data.get('court') || '');
      const quadras = await loadCourts();
      const courtId = quadras.find((c) => c.label === quadra)?.id || quadras[0]?.id;
      // O backend quer o indice do dia (0=segunda..6=domingo).
      const dia = DIA_INDICE[diaPt] ?? 2;
      const date = proximoDiaDaSemana(dia);
      try {
        await managerService.criarMensalista({ courtId, dia, date, hora, clientName: nome });
      } catch (error) {
        window.pqToast?.(error.message || 'Não foi possível salvar');
        return;
      }
      root.querySelector('[data-member-dialog]').hidden = true;
      form.reset();
      await renderManagerMembers(root);
      window.pqToast?.('Mensalista salvo');
      return;
    }

    const id = String(data.get('id') || '') || `member-${Date.now()}`;
    const anterior = manuais().find((m) => m.id === id);
    const membro = {
      id,
      name: String(data.get('name') || '').trim(),
      court: String(data.get('court') || ''),
      day: String(data.get('day') || '').toLowerCase(),
      time: String(data.get('time') || ''),
      price: Number(data.get('price') || 0),
      status: anterior?.status || 'ativo'
    };
    const lista = manuais().filter((m) => m.id !== id);
    storage.set(KEY, [...lista, membro]);

    root.querySelector('[data-member-dialog]').hidden = true;
    form.reset();
    await renderManagerMembers(root);
    window.pqToast?.('Mensalista salvo');
  });
}

/* Proxima data futura que cai no dia da semana pedido (0=segunda..6=domingo) —
   o backend nao aceita start_at no passado, entao hoje sozinho nao basta. */
function proximoDiaDaSemana(diaIndice) {
  const hoje = new Date();
  const alvo = (diaIndice + 1) % 7;
  let diff = (alvo - hoje.getDay() + 7) % 7;
  if (diff === 0) diff = 7;
  const d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + diff);
  return d.toISOString().slice(0, 10);
}
