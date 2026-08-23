/* Detalhe da reserva — as quatro acoes do app antigo.

   No Flask cada acao era um POST proprio (aprovar / recusar / pagar /
   cancelar) e a regra de qual aparece estava no template. Aqui a regra vive
   no JS, mas e a mesma: Solicitada oferece aprovar e recusar; Pendente
   oferece confirmar pagamento; o que ja esta encerrado nao oferece nada
   alem de voltar. */
import { bookings, getBooking, loadBooking, loadBookings, setBookingStatus, applyBookingAction, encerrada, setPageMeta } from './manager-bookings.js';
import { formatCurrency } from '../../utils/formatters.js';
import { API_BASE_URL } from '../../config/constants.js';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

/* O id vem do hash: #reserva/7 */
export const bookingIdFromHash = () => (location.hash.split('/')[1] || '').trim();

function acoes(r) {
  if (r.status === 'Solicitada') {
    return `<div class="set-hint" style="margin:0 0 14px;"><i class="ic" data-lucide="bell"></i> Este cliente está aguardando sua aprovação.</div>
      <button type="button" class="btn btn-primary btn-block" style="margin-bottom:10px;" data-bd-action="Confirmado"><i class="ic sm" data-lucide="circle-check"></i> Aprovar reserva</button>
      <button type="button" class="btn btn-danger btn-block" data-bd-action="Recusada"><i class="ic sm" data-lucide="circle-x"></i> Recusar</button>`;
  }
  if (encerrada(r)) {
    return `<div class="set-hint" style="margin:0;"><i class="ic" data-lucide="circle-x"></i> Reserva ${escapeHtml(r.status.toLowerCase())}. Não há mais ações disponíveis.</div>
      <a href="./dashboard.html#reservas" class="btn btn-soft btn-block" style="margin-top:14px;">Voltar para reservas</a>`;
  }
  // Com API o pagamento pendente nao se confirma na mao: quem move a reserva
  // de "aguardando pagamento" e o webhook do pagamento. O botao so existe no
  // mock, onde o gerente e a propria maquina.
  return `${r.status === 'Pendente' && !API_BASE_URL
      ? '<button type="button" class="btn btn-primary btn-block" style="margin-bottom:10px;" data-bd-action="Pago">Confirmar pagamento</button>'
      : ''}
    <a href="./dashboard.html#agenda" class="btn btn-soft btn-block" style="margin-bottom:10px;">Ver na agenda</a>
    <button type="button" class="btn btn-danger btn-block" data-bd-action="Cancelada">Cancelar reserva</button>`;
}

export async function renderManagerBookingDetail(root) {
  const wrap = root.querySelector('[data-booking-detail]');
  if (!wrap) return;

  const id = bookingIdFromHash();
  const r = (API_BASE_URL ? await loadBooking(id) : null) || getBooking(id);
  if (!r) {
    wrap.innerHTML = `<div class="manager-empty-list">
      <i class="ic" data-lucide="calendar"></i>
      <strong>Reserva não encontrada</strong>
      <span>Ela pode ter sido removida.</span>
      <a href="./dashboard.html#reservas" class="btn btn-soft btn-xs" style="margin-top:12px;">Voltar para reservas</a>
    </div>`;
    window.pqRefreshIcons?.(root);
    return;
  }

  setPageMeta('Detalhes da reserva', `${r.cliente} · ${r.data}`);

  const set = (sel, valor) => {
    const el = wrap.querySelector(sel);
    if (el) el.textContent = valor;
  };

  set('[data-bd-quadra]', r.quadra);
  set('[data-bd-data]', r.data);
  set('[data-bd-hora]', r.hora);
  set('[data-bd-codigo]', r.codigo || '—');
  set('[data-bd-cliente]', r.cliente);
  set('[data-bd-ini]', String(r.cliente).charAt(0).toUpperCase());
  set('[data-bd-telefone]', r.telefone);

  // "8 no total" era numero fixo no template antigo. Aqui e a contagem real
  // de reservas deste cliente.
  // Historico do cliente: pagina grande, porque aqui se CONTA e nao se navega.
  const todas = API_BASE_URL
    ? (await loadBookings({ porPagina: 100 })).reservas
    : bookings();
  const doCliente = todas.filter((b) => b.cliente === r.cliente).length;
  set('[data-bd-historico]', `${doCliente} ${doCliente === 1 ? 'reserva' : 'reservas'}`);

  const status = wrap.querySelector('[data-bd-status]');
  if (status) {
    status.textContent = r.status;
    status.className = `status ${r.cls}`;
  }

  const caixa = wrap.querySelector('[data-bd-actions]');
  if (caixa) caixa.innerHTML = acoes(r);

  window.pqRefreshIcons?.(root);
}

export function initManagerBookingDetail() {
  document.addEventListener('click', async (event) => {
    const botao = event.target.closest('[data-bd-action]');
    if (!botao) return;
    const root = document.querySelector('[data-desktop-route-view]');
    const id = bookingIdFromHash();
    const acao = botao.dataset.bdAction;
    if (API_BASE_URL && acao !== 'Pago') {
      try {
        await applyBookingAction(id, acao);
      } catch (error) {
        window.pqToast?.(error.message || 'Não foi possível concluir');
        return;
      }
    } else {
      setBookingStatus(id, acao);
    }
    await renderManagerBookingDetail(root);
    window.pqToast?.(`Reserva ${acao.toLowerCase()}`);
  });
}
