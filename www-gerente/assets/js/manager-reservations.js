/* Reservas da arena, separando mensalistas de avulsas.

   A separacao nao e enfeite: sao dois negocios diferentes para quem opera a
   quadra. O mensalista e receita recorrente e o horario dele esta ocupado
   todo mes — nao adianta o gerente reaprovar a mesma quinta quatro vezes.
   O avulso e caso a caso e precisa de decisao.

   Refeito contra os dados da arena. A versao anterior lia as reservas DO
   JOGADOR e carimbava o nome do perfil em todas as linhas — nove reservas,
   um cliente so. Agora cada reserva tem cliente e telefone proprios, que e
   justamente o que o gerente precisa para ligar e confirmar. */
import { ARENA_BOOKINGS, ARENA_MEMBERS, STATUS_CLASS } from '../../config/manager-data.js';
import storage from '../../storage/storage.js';
import { formatCurrency } from '../../utils/formatters.js';

const STATUS_KEY = 'manager-booking-status';
const MEMBERS_KEY = 'manager-members';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

const inicial = (nome) => String(nome || '?').charAt(0).toUpperCase();

/* O gerente aprova reservas; a decisao dele persiste por cima do mock. */
function bookings() {
  const over = storage.get(STATUS_KEY, {});
  return ARENA_BOOKINGS.map((b) => ({ ...b, status: over[b.id] || b.status }));
}

function linhaAvulsa(r) {
  const pedeAcao = r.status === 'Solicitada' || r.status === 'Pendente';
  const acao = pedeAcao
    ? `<button class="btn btn-primary btn-xs" data-manager-approve="${r.id}">Aprovar</button>`
    : '<button class="btn btn-soft btn-xs" data-toast="Detalhes preparados para a API">Detalhes</button>';
  return `<tr>
    <td>
      <div class="cli">
        <span class="av">${inicial(r.cliente)}</span>
        <div><strong>${escapeHtml(r.cliente)}</strong><small>${escapeHtml(r.telefone)}</small></div>
      </div>
    </td>
    <td>${escapeHtml(r.quadra)}</td>
    <td>${escapeHtml(r.data)}</td>
    <td class="num">${escapeHtml(r.hora)}</td>
    <td class="val num">${formatCurrency(r.valor)}</td>
    <td><span class="status ${escapeHtml(STATUS_CLASS[r.status] || 'pendente')}">${escapeHtml(r.status)}</span></td>
    <td><span class="act-inline">${acao}</span></td>
  </tr>`;
}

function cardMensalista(m) {
  return `<article class="mensal-card">
    <div class="mensal-card__top">
      <span class="av">${inicial(m.name)}</span>
      <div>
        <strong>${escapeHtml(m.name)}</strong>
        <small>${escapeHtml(m.court)}</small>
      </div>
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

export function renderManagerReservations(root) {
  const lista = root.querySelector('[data-manager-reservation-list]');
  if (!lista) return;

  // Mesma fonte da tela de Mensalistas — as duas telas nao podem discordar.
  const mensalistas = storage.get(MEMBERS_KEY, ARENA_MEMBERS);

  const box = root.querySelector('[data-manager-mensal-list]');
  if (box) {
    box.innerHTML = mensalistas.length
      ? mensalistas.map(cardMensalista).join('')
      : '<p class="panel-sub">Nenhum mensalista ainda. Quem assina aparece aqui com o horário fixo.</p>';
  }
  const contador = root.querySelector('[data-manager-mensal-count]');
  if (contador) contador.textContent = mensalistas.length;

  const avulsas = bookings();
  lista.innerHTML = avulsas.length
    ? avulsas.map(linhaAvulsa).join('')
    : '<tr><td colspan="7" class="panel-sub">Nenhuma reserva avulsa no período.</td></tr>';

  window.pqRefreshIcons?.(root);
}

export function initManagerReservations() {
  document.addEventListener('click', (event) => {
    const aprovar = event.target.closest('[data-manager-approve]');
    if (!aprovar) return;
    const root = document.querySelector('[data-desktop-route-view]');
    const id = Number(aprovar.dataset.managerApprove);
    const reserva = bookings().find((r) => r.id === id);
    if (!reserva) return;
    storage.set(STATUS_KEY, { ...storage.get(STATUS_KEY, {}), [id]: 'Confirmado' });
    renderManagerReservations(root);
    window.pqToast?.(`Reserva de ${reserva.cliente} confirmada`);
  });
}
