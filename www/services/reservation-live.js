import { API_BASE_URL } from '../config/constants.js';
import api from './api.js';

/* Reserva real (API) no fluxo de confirmacao.
   Mock (sem API_BASE_URL) nao passa por aqui: a aprovacao continua simulada.
   O polling de /events e o caminho de dados; o WS da Fase 6 entra depois,
   ouvindo booking.updated — ate la, o mesmo callback onDone fecha os dois. */

const TERMINAL_STATUSES = new Set([
  'confirmed',
  'completed',
  'rejected',
  'cancelled',
  'expired',
  'refunded',
  'payment_failed'
]);

let watcherTimer = null;

function uuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `pq-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/* Cria a reserva com Idempotency-Key (replay devolve a original) e ja "paga"
   no fluxo mock da F4, que move pending_payment -> requested. */
export async function submitPlayerReservation(context, idempotencyKey) {
  if (!API_BASE_URL) return { reserva: null, key: idempotencyKey || '', replay: false };
  const key = idempotencyKey || uuid();
  const data = await api.post(
    '/api/reservas',
    {
      quadraId: context.venue.id,
      data: context.date,
      hora: context.hour,
      dur: context.duration,
      plano: context.plan || 'avulso',
      dia: context.plan === 'mensalista' ? context.weekday : null,
      pagamento: context.method === 'wallet' ? 'pix' : context.method
    },
    { headers: { 'Idempotency-Key': key } }
  );
  return { reserva: (data?.reservas || [])[0] || null, key, replay: Boolean(data?.replay) };
}

export async function payPlayerReservation(reservaId) {
  if (!API_BASE_URL || !reservaId) return null;
  const data = await api.post(`/api/reservas/${reservaId}/pagar`);
  const payment = data?.payment;
  // Dev/demo: o provider real confirma por webhook; o mock usa o mesmo
  // caminho senao a reserva nao sai de pending_payment.
  if (payment?.provider === 'mock') {
    await api.post('/api/payments/webhook/mock', {
      webhookId: `mock-auto-${payment.providerRef}`,
      status: 'confirmed',
      paymentRef: payment.providerRef,
      amountCents: Math.round((payment.amount || 0) * 100)
    });
  }
  return data;
}

export function watchReservation(reservaId, { onStatus, onDone, interval = 2000 }) {
  stopReservationWatch();
  if (!API_BASE_URL || !reservaId) return null;

  let stopped = false;

  async function poll() {
    if (stopped) return;
    try {
      const data = await api.get(`/api/reservas/${reservaId}/events`);
      const events = data?.events || [];
      const last = events[events.length - 1];
      if (!last) {
        if (onStatus) onStatus(null);
        return;
      }
      if (onStatus) onStatus(last.to);
      if (TERMINAL_STATUSES.has(last.to)) {
        stop();
        if (onDone) onDone(last.to, last);
      }
    } catch (error) {
      // Falha transitoria de rede: tenta de novo no proximo ciclo.
    }
  }

  poll();
  watcherTimer = window.setInterval(poll, interval);

  function stop() {
    stopped = true;
    if (watcherTimer) {
      window.clearInterval(watcherTimer);
      watcherTimer = null;
    }
  }

  return stop;
}

export function stopReservationWatch() {
  if (watcherTimer) {
    window.clearInterval(watcherTimer);
    watcherTimer = null;
  }
}
