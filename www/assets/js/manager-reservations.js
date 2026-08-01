/* Reservas da arena, separando mensalistas de avulsas.

   A separacao nao e enfeite: sao dois negocios diferentes para quem opera a
   quadra. O mensalista e receita recorrente e o horario dele esta ocupado
   todo mes — nao adianta o gerente reaprovar a mesma quinta quatro vezes.
   O avulso e caso a caso e precisa de decisao.

   Segunda tela do gerente ligada a dados (a primeira foi Minhas quadras). */
import venueService from '../../services/venues.js';
import { formatCurrency } from '../../utils/formatters.js';

const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function inicial(nome) {
  return String(nome || '?').charAt(0).toUpperCase();
}

function linhaAvulsa(reserva, venue, cliente) {
  const acao = reserva.statusClass === 'pendente'
    ? `<button class="btn btn-primary btn-xs" data-manager-approve="${reserva.code}">Aprovar</button>`
    : `<button class="btn btn-soft btn-xs" data-toast="Detalhes preparados para a API">Detalhes</button>`;
  return `<tr>
    <td><div class="cli"><span class="av">${inicial(cliente)}</span> ${escapeHtml(cliente)}</div></td>
    <td>${escapeHtml(venue?.name || '-')}</td>
    <td>${escapeHtml(reserva.date)}</td>
    <td class="num">${escapeHtml(reserva.hour)}</td>
    <td class="val num">${formatCurrency(reserva.price)}</td>
    <td><span class="status ${escapeHtml(reserva.statusClass)}">${escapeHtml(reserva.status)}</span></td>
    <td><span class="act-inline">${acao}</span></td>
  </tr>`;
}

function cardMensalista(plano) {
  const hoje = new Date().toISOString().slice(0, 10);
  const restantes = plano.sessoes.filter((s) => s.dateISO >= hoje).length;
  return `<article class="mensal-card">
    <div class="mensal-card__top">
      <span class="av">${inicial(plano.cliente)}</span>
      <div>
        <strong>${escapeHtml(plano.cliente)}</strong>
        <small>${escapeHtml(plano.venueName)}</small>
      </div>
      <span class="status pago">Mensalista</span>
    </div>
    <div class="mensal-card__grid">
      <div><small>Compromisso</small><strong>Toda ${WEEKDAYS[plano.weekday]}</strong></div>
      <div><small>Horário</small><strong>${escapeHtml(plano.startTime)}</strong></div>
      <div><small>Sessões no mês</small><strong>${restantes} de ${plano.sessoes.length}</strong></div>
      <div><small>Receita do mês</small><strong>${formatCurrency(plano.valor)}</strong></div>
    </div>
  </article>`;
}

export async function renderManagerReservations(root) {
  const lista = root.querySelector('[data-manager-reservation-list]');
  if (!lista) return;

  const [reservas, venues, peladas, perfil] = await Promise.all([
    venueService.reservations(),
    venueService.list({}),
    venueService.peladas(),
    venueService.profile()
  ]);
  const cliente = perfil.name;

  // Um plano e o conjunto de sessoes que nasceram da mesma reserva.
  const planos = new Map();
  peladas.filter((p) => p.plan === 'mensalista' && p.reservationCode).forEach((p) => {
    const atual = planos.get(p.reservationCode) || {
      cliente,
      venueName: p.venueName,
      startTime: p.startTime,
      weekday: new Date(`${p.dateISO}T12:00`).getDay(),
      valor: reservas.find((r) => r.code === p.reservationCode)?.price || 0,
      sessoes: []
    };
    atual.sessoes.push(p);
    planos.set(p.reservationCode, atual);
  });

  const box = root.querySelector('[data-manager-mensal-list]');
  const head = root.querySelector('[data-manager-mensal-head]');
  if (box) {
    box.innerHTML = planos.size
      ? [...planos.values()].map(cardMensalista).join('')
      : '<p class="panel-sub">Nenhum mensalista ainda. Quem assina aparece aqui com o horário fixo.</p>';
  }
  if (head) head.querySelector('[data-manager-mensal-count]').textContent = planos.size;

  const avulsas = reservas.filter((r) => !planos.has(r.code));
  lista.innerHTML = avulsas.length
    ? avulsas.map((reserva) => linhaAvulsa(reserva, venues.find((v) => v.id === reserva.venueId), cliente)).join('')
    : '<tr><td colspan="7" class="panel-sub">Nenhuma reserva avulsa no periodo.</td></tr>';

  window.pqRefreshIcons?.(root);
}

export function initManagerReservations() {
  document.addEventListener('click', async (event) => {
    const aprovar = event.target.closest('[data-manager-approve]');
    if (!aprovar) return;
    const root = document.querySelector('[data-desktop-route-view]');
    const reservas = await venueService.reservations();
    const reserva = reservas.find((r) => r.code === aprovar.dataset.managerApprove);
    if (!reserva) return;
    await venueService.saveReservation({
      ...reserva,
      status: 'Confirmada',
      statusClass: 'pago'
    });
    await renderManagerReservations(root);
    window.pqToast?.(`Reserva ${reserva.code} aprovada`);
  });
}
