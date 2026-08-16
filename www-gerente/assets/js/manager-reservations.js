/* Lista de reservas da arena — porte de _legacy/.../g_reservas.html.

   Refeita como linha (manager-booking-row), nao como tabela: cada reserva
   traz cliente, telefone, quadra, data, valor, status e as acoes. A tabela
   anterior nao deixava aprovar nem abrir a reserva, que sao as duas unicas
   coisas que o gerente vem fazer aqui.

   Banner, resumo e filtros vem junto porque sao o que responde "o que
   precisa de mim agora". */
import { ARENA_MEMBERS } from '../../config/manager-data.js';
import { loadBookings, applyBookingAction } from './manager-bookings.js';
import storage from '../../storage/storage.js';
import { formatCurrency } from '../../utils/formatters.js';
import { API_BASE_URL } from '../../config/constants.js';
import managerService from '../../services/manager-api.js';

const MEMBERS_KEY = 'manager-members';

let filtro = '';
let busca = '';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

const inicial = (nome) => String(nome || '?').charAt(0).toUpperCase();

function linha(r) {
  const acoes = r.status === 'Solicitada'
    ? `<button type="button" class="btn btn-danger btn-xs" data-booking-refuse="${r.id}">Recusar</button>
       <button type="button" class="btn btn-primary btn-xs" data-booking-approve="${r.id}"><svg class="ic sm"><use href="#i-check"/></svg> Aprovar</button>`
    : `<a href="./dashboard.html#reserva/${r.id}" class="btn btn-soft btn-xs">Ver detalhes</a>`;

  return `<article class="manager-booking-row${r.status === 'Solicitada' ? ' is-request' : ''}" data-status="${escapeHtml(r.cls)}">
    <div class="manager-booking-person">
      <span class="manager-avatar">${escapeHtml(inicial(r.cliente))}</span>
      <div><strong>${escapeHtml(r.cliente)}</strong><small>${escapeHtml(r.telefone)}</small></div>
    </div>
    <div class="manager-booking-fact"><span>Quadra</span><strong>${escapeHtml(r.quadra)}</strong></div>
    <div class="manager-booking-fact"><span>Data e horário</span><strong>${escapeHtml(r.data)} · <span class="num">${escapeHtml(r.hora)}</span></strong></div>
    <div class="manager-booking-fact"><span>Valor</span><strong class="num">${formatCurrency(r.valor)}</strong></div>
    <div class="manager-booking-status"><span class="status ${escapeHtml(r.cls)}">${escapeHtml(r.status)}</span></div>
    <div class="manager-booking-actions">${acoes}</div>
  </article>`;
}

function cardMensalista(m) {
  return `<article class="mensal-card">
    <div class="mensal-card__top">
      <span class="av">${escapeHtml(inicial(m.name))}</span>
      <div><strong>${escapeHtml(m.name)}</strong><small>${escapeHtml(m.court)}</small></div>
      <span class="status ${m.status === 'renovando' ? 'pendente' : 'pago'}">${m.status === 'renovando' ? 'Renovando' : 'Mensalista'}</span>
    </div>
    <div class="mensal-card__grid">
      <div><small>Compromisso</small><strong>Toda ${escapeHtml(m.day)}</strong></div>
      <div><small>Horário</small><strong>${escapeHtml(m.time)}</strong></div>
      <div><small>Sessões no mês</small><strong>4</strong></div>
      <div><small>Receita do mês</small><strong>${formatCurrency(m.price)}</strong></div>
    </div>
  </article>`;
}

export async function renderManagerReservations(root) {
  const lista = root.querySelector('[data-manager-reservation-list]');
  if (!lista) return;

  const todas = await loadBookings();
  const solicitadas = todas.filter((r) => r.status === 'Solicitada');

  // O banner some quando nao ha o que responder — um aviso permanente vira
  // decoração e para de ser lido.
  const banner = root.querySelector('[data-booking-banner]');
  if (banner) {
    banner.hidden = solicitadas.length === 0;
    const texto = root.querySelector('[data-booking-banner-count]');
    if (texto) {
      texto.textContent = solicitadas.length === 1
        ? '1 solicitação precisa da sua resposta'
        : `${solicitadas.length} solicitações precisam da sua resposta`;
    }
  }

  const set = (sel, valor) => {
    const el = root.querySelector(sel);
    if (el) el.textContent = valor;
  };
  set('[data-booking-total]', todas.length);
  set('[data-booking-volume]', formatCurrency(todas.reduce((t, r) => t + Number(r.valor || 0), 0)));
  set('[data-booking-pending]', solicitadas.length);
  root.querySelector('[data-booking-pending-card]')?.classList.toggle('has-pending', solicitadas.length > 0);

  const termo = busca.trim().toLowerCase();
  const visiveis = todas.filter((r) => (!filtro || r.cls === filtro)
    && (!termo || `${r.cliente} ${r.quadra} ${r.codigo || ''}`.toLowerCase().includes(termo)));

  lista.innerHTML = visiveis.map(linha).join('');
  const vazio = root.querySelector('[data-booking-empty]');
  if (vazio) vazio.hidden = visiveis.length > 0;

  root.querySelectorAll('[data-booking-filter]').forEach((b) => {
    b.classList.toggle('on', b.dataset.bookingFilter === filtro);
  });

  let mensalistas = storage.get(MEMBERS_KEY, ARENA_MEMBERS);
  if (API_BASE_URL) {
    try {
      mensalistas = await managerService.mensalistas();
    } catch (error) {}
  }
  const box = root.querySelector('[data-manager-mensal-list]');
  if (box) {
    box.innerHTML = mensalistas.length
      ? mensalistas.map(cardMensalista).join('')
      : '<p class="panel-sub">Nenhum mensalista ainda. Quem assina aparece aqui com o horário fixo.</p>';
  }
  set('[data-manager-mensal-count]', mensalistas.length);

  window.pqRefreshIcons?.(root);
}

export function initManagerReservations() {
  document.addEventListener('click', async (event) => {
    const root = document.querySelector('[data-desktop-route-view]');
    if (!root) return;

    const aprovar = event.target.closest('[data-booking-approve]');
    if (aprovar) {
      try {
        await applyBookingAction(aprovar.dataset.bookingApprove, 'Confirmado');
        await renderManagerReservations(root);
        window.pqToast?.('Reserva aprovada');
      } catch (error) {
        window.pqToast?.(error.message || 'Não foi possível aprovar');
      }
      return;
    }

    const recusar = event.target.closest('[data-booking-refuse]');
    if (recusar) {
      try {
        await applyBookingAction(recusar.dataset.bookingRefuse, 'Recusada');
        await renderManagerReservations(root);
        window.pqToast?.('Reserva recusada');
      } catch (error) {
        window.pqToast?.(error.message || 'Não foi possível recusar');
      }
      return;
    }

    const aba = event.target.closest('[data-booking-filter]');
    if (aba) {
      filtro = aba.dataset.bookingFilter;
      await renderManagerReservations(root);
    }
  });

  document.addEventListener('input', (event) => {
    const campo = event.target.closest('[data-booking-search]');
    if (!campo) return;
    busca = campo.value;
    renderManagerReservations(document.querySelector('[data-desktop-route-view]'));
  });
}
