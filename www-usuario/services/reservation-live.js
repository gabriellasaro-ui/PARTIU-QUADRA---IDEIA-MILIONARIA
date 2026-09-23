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
      pagamento: context.method === 'wallet' ? 'pix' : context.method,
      /* O CLUBE VIAJA COM A RESERVA, e nao so com a pelada.

         A pelada so nasce depois de a arena aprovar — e e NA HORA DE APROVAR
         que o dono da quadra precisa saber de quem e o jogo: "Bola Murcha FC,
         toda quinta" e uma decisao diferente de um nome solto que ele nunca
         viu. Mandar so na pelada faria a informacao chegar tarde demais. */
      clubeId: context.clubeId || null
    },
    { headers: { 'Idempotency-Key': key } }
  );
  return { reserva: (data?.reservas || [])[0] || null, key, replay: Boolean(data?.replay) };
}

/* Cria a cobranca e para por ai. Quem confirma e o servidor.

   Antes daqui, quando o provider era o mock, esta funcao postava
   /api/payments/webhook/mock do proprio navegador para destravar a reserva.
   Isso e um callback de pagamento forjado pelo cliente — e parou de funcionar
   sem avisar no dia em que PAYMENT_WEBHOOK_SECRET entrou no .env: o endpoint
   responde 200 com {ok:false, ignored:true}, o front achava que tinha dado
   certo e a reserva ficava presa em "Aguardando pagamento" para sempre.

   A confirmacao do mock agora acontece no backend (services/mock_autoconfirm),
   e o watchReservation abaixo ve a mudanca pelo polling de /events. */
export async function payPlayerReservation(reservaId) {
  if (!API_BASE_URL || !reservaId) return null;
  return api.post(`/api/reservas/${reservaId}/pagar`);
}

/* Estado atual da cobranca. A tela de "aguardando pagamento" precisa
   disto: a pessoa pode fechar o QR, pagar pelo app do banco e voltar —
   sem uma sonda, a tela esperaria para sempre por um evento que ja
   aconteceu. */
/* Recupera uma reserva JA CRIADA. Existe por causa do F5: a tela de
   confirmacao roda o checkout inteiro ao ser montada, e recarregar
   fazia ela tentar criar a MESMA reserva de novo. O horario ja estava
   ocupado pela primeira, a API recusava, e o front lia a recusa como
   "a arena nao aceitou" — mentindo para quem tinha acabado de pagar. */
export async function getReservation(reservaId) {
  if (!API_BASE_URL || !reservaId) return null;
  const data = await api.get(`/api/reservas/${reservaId}`);
  return data?.reserva || null;
}

export async function getPayment(paymentId) {
  if (!API_BASE_URL || !paymentId) return null;
  const data = await api.get(`/api/payments/${paymentId}`);
  return data?.payment || null;
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
