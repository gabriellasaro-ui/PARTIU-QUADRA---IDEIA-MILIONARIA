import { API_BASE_URL } from '../config/constants.js';
import storage from '../storage/storage.js';

/* WS autenticado do PAINEL DO GERENTE: /ws?token=<access_token>.

   Copia deliberada do servico do app do jogador. Poderia ser um arquivo unico
   compartilhado, mas as duas arvores ja sao independentes (config, storage e
   prefixo diferentes) e um import cruzando a fronteira faria o painel quebrar
   quando o app mudasse. Se um terceiro consumidor aparecer, ai sim vale
   extrair.

   Aqui ele existe por um motivo especifico: solicitacao de reserva tem de
   aparecer NA HORA na tela do dono. Ele esta no balcao com o cliente na
   frente; descobrir a solicitacao no proximo F5 e tarde demais.

   Eventos chegam como `pq:ws:event` no window. Reconnect com backoff
   exponencial ate 15s; logout ou sessao expirada fecha de vez. */

const MAX_RETRY_MS = 15000;

let socket = null;
let reconnectTimer = null;
let retry = 0;
let closedByUs = false;

function wsUrl() {
  if (!API_BASE_URL) return '';
  const token = storage.getAuthToken();
  if (!token) return '';
  const base = API_BASE_URL.replace(/^http/i, 'ws').replace(/\/$/, '');
  return `${base}/ws?token=${encodeURIComponent(token)}`;
}

function scheduleReconnect() {
  if (reconnectTimer || closedByUs) return;
  const delay = Math.min(MAX_RETRY_MS, 1000 * 2 ** retry);
  retry += 1;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    connectWS();
  }, delay);
}

export function connectWS() {
  const url = wsUrl();
  if (!url || socket) return;
  closedByUs = false;
  try {
    socket = new WebSocket(url);
  } catch (error) {
    scheduleReconnect();
    return;
  }
  socket.onopen = () => {
    retry = 0;
  };
  socket.onmessage = (message) => {
    try {
      const event = JSON.parse(message.data);
      window.dispatchEvent(new CustomEvent('pq:ws:event', { detail: event }));
    } catch (error) {
      // Payload malformado: ignora, nao derruba a sessao.
    }
  };
  socket.onclose = () => {
    socket = null;
    if (!closedByUs) scheduleReconnect();
  };
  socket.onerror = () => {
    socket?.close();
  };
}

export function disconnectWS() {
  closedByUs = true;
  if (reconnectTimer) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (socket) {
    socket.onclose = null;
    socket.close();
    socket = null;
  }
}

export function isWSConnected() {
  return Boolean(socket && socket.readyState === WebSocket.OPEN);
}
