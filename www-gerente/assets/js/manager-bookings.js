/* Reservas da arena — o estado compartilhado e as acoes.

   As quatro rotas POST do app antigo (aprovar / recusar / pagar / cancelar)
   viram funcoes aqui, e as tres telas que mexem em reserva — a lista, o
   detalhe e a agenda — leem do mesmo lugar. Sem isto o gerente aprovava numa
   tela e a outra continuava mostrando "Solicitada".

   Com API_BASE_URL as acoes falam com /api/reservas/{id}/aprovar|recusar|cancelar
   e a lista vem de /api/gerente/reservas (mapBooking normaliza rotulo/classe).
   Sem API, o override fica em storage por id como sempre. */
import { ARENA_BOOKINGS, STATUS_CLASS } from '../../config/manager-data.js';
import storage from '../../storage/storage.js';
import { API_BASE_URL } from '../../config/constants.js';
import managerService from '../services/manager-api.js';

const KEY = 'manager-booking-status';
const NOVAS = 'manager-bookings-novas';

const overrides = () => storage.get(KEY, {});

/* Reservas base + as que o gerente criou na mao, com o status corrente. */
export function bookings() {
  const over = overrides();
  const manuais = storage.get(NOVAS, []);
  return [...ARENA_BOOKINGS, ...manuais].map((b) => ({
    ...b,
    status: over[b.id] || b.status,
    cls: STATUS_CLASS[over[b.id] || b.status] || 'pendente'
  }));
}

export const getBooking = (id) => bookings().find((b) => String(b.id) === String(id));

/* Lista viva: do backend quando houver API, do mock caso contrario. */
export async function loadBookings() {
  if (!API_BASE_URL) return bookings();
  return managerService.reservas();
}

export async function loadBooking(id) {
  if (!API_BASE_URL) return getBooking(id);
  return managerService.reserva(id);
}

export function setBookingStatus(id, status) {
  storage.set(KEY, { ...overrides(), [id]: status });
}

export function addBooking(booking) {
  const manuais = storage.get(NOVAS, []);
  storage.set(NOVAS, [...manuais, booking]);
}

/* Aprovar/recusar/cancelar: backend quando houver API, storage no mock. */
export async function applyBookingAction(id, action) {
  if (!API_BASE_URL) {
    setBookingStatus(id, action);
    return;
  }
  if (action === 'Confirmado') await managerService.aprovarReserva(id);
  else if (action === 'Recusada') await managerService.recusarReserva(id);
  else if (action === 'Cancelada') await managerService.cancelarReserva(id);
}

/* Status que ainda pedem uma decisao do gerente. */
export const pedeAcao = (b) => b.status === 'Solicitada' || b.status === 'Pendente';

/* Uma reserva encerrada nao volta atras. */
export const encerrada = (b) => b.status === 'Cancelada' || b.status === 'Recusada';

/* Titulo da rota com parametro. "Cadastrar quadra" e "Editar Society 2" sao
   a mesma rota; so o render sabe qual dos dois e. */
export function setPageMeta(heading, sub) {
  const title = document.querySelector('[data-page-title]');
  const s = document.querySelector('[data-page-sub]');
  if (title) title.textContent = heading;
  if (s) s.textContent = sub;
  document.title = `${heading} - Qadras`;
}
