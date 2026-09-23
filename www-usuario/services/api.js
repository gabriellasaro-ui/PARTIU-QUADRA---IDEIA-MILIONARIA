import { API_BASE_URL, HTTP_HEADERS } from '../config/constants.js';
import storage from '../storage/storage.js';

export class ApiError extends Error {
  constructor(message, response, payload) {
    super(message);
    this.name = 'ApiError';
    this.response = response;
    this.payload = payload;
    this.status = response?.status || 0;
  }
}

function buildUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;
  const base = API_BASE_URL.replace(/\/$/, '');
  const cleanPath = String(path || '').replace(/^\//, '');
  return base ? `${base}/${cleanPath}` : `./${cleanPath}`;
}

async function parseResponse(response) {
  const type = response.headers.get('content-type') || '';
  if (response.status === 204) return null;
  if (type.includes('application/json')) return response.json();
  return response.text();
}

/* Uma tentativa de refresh por vez: se duas chamadas tomarem 401 juntas,
   esperam a mesma promessa em vez de disparar refresh duplicados. */
let refreshing = null;

async function tryRefreshToken() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const refreshToken = storage.getAuthRefreshToken();
    if (!refreshToken) return false;
    const session = await fetch(buildUrl('/api/auth/refresh'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken })
    });
    /* So 401/403 querem dizer "esta sessao morreu". Qualquer outro status e
       problema do servidor (502 de proxy reiniciando, 500, 503 em deploy) —
       tratar isso como sessao invalida deslogava todo mundo a cada tropeco
       de infraestrutura. Lancar mantem a sessao no aparelho e deixa a
       chamada original falhar como erro de rede, que e o que ela e. */
    if (session.status === 401 || session.status === 403) return false;
    if (!session.ok) throw new Error('Servidor indisponível');
    const data = await session.json();
    if (!data?.token) return false;
    storage.setAuthToken(data.token);
    storage.setAuthUser(data.user ?? storage.getAuthUser());
    if (data.refreshToken) storage.setAuthRefreshToken(data.refreshToken);
    return true;
  })();
  try {
    return await refreshing;
  } finally {
    refreshing = null;
  }
}

/* PRAZO PARA A RESPOSTA — sem isto o app trava sem dizer nada.

   `fetch` nao tem timeout proprio. Quando o servidor esta inalcancavel — IP
   da LAN que mudou, celular noutra rede, backend parado — a promessa fica
   pendurada por MINUTOS ate o sistema desistir, e nesse tempo quem chamou nao
   recebe nem sucesso nem erro.

   O estrago nao e a espera, e o que ela esconde: a rota mostra a tela de
   carregamento antes de buscar os dados e so a remove quando a busca termina.
   Promessa que nunca resolve = overlay que nunca sai. O app fica preso numa
   tela de carregamento eterna, e de fora parece que "nao abre" — foi
   exatamente o que aconteceu com o APK apontando para o IP velho.

   Oito segundos: acima disso nao ha internet ruim que salve, e e melhor dizer
   "sem resposta" do que fingir que ainda vai chegar. O erro sobe como
   ApiError com status 0, igual a qualquer outra falha de rede, entao quem
   chama nao precisa saber que existe prazo.

   O `signal` de quem chamou continua valendo: quem cancela uma busca porque a
   pessoa digitou outra letra tem que continuar cancelando. Os dois abortam o
   mesmo controlador — o primeiro que chegar vence. */
const PRAZO_MS = 8000;

async function comPrazo(url, init, signalExterno) {
  const controlador = new AbortController();

  /* UMA BANDEIRA, e nao o motivo do abort.

     `controlador.abort('prazo')` faz o fetch rejeitar com a propria string
     'prazo' — nao com um AbortError. Testando, o erro subia cru: sem `name`,
     sem `message`, sem `status`, e a tela mostrava "undefined". Quem decide
     que houve estouro e este escopo, entao ele guarda o fato aqui em vez de
     tentar ler de volta do objeto de erro. */
  let estourouPrazo = false;
  const porPrazo = setTimeout(() => {
    estourouPrazo = true;
    controlador.abort();
  }, PRAZO_MS);

  const repassar = () => controlador.abort(signalExterno?.reason);
  if (signalExterno) {
    if (signalExterno.aborted) repassar();
    else signalExterno.addEventListener('abort', repassar, { once: true });
  }

  try {
    return await fetch(url, { ...init, signal: controlador.signal });
  } catch (erro) {
    /* Cancelamento de quem chamou sobe como estava: quem cancelou sabe o que
       fazer com isso. So o estouro de prazo vira mensagem de rede. */
    if (signalExterno?.aborted) throw erro;
    if (estourouPrazo) {
      throw new ApiError('Sem resposta do servidor. Verifique sua conexão.', null, null);
    }
    throw erro;
  } finally {
    clearTimeout(porPrazo);
    signalExterno?.removeEventListener('abort', repassar);
  }
}

export async function apiRequest(path, options = {}) {
  const {
    method = 'GET',
    body,
    headers = {},
    auth = true,
    signal
  } = options;

  const token = auth ? storage.getAuthToken() : null;
  const requestHeaders = {
    [HTTP_HEADERS.ACCEPT]: HTTP_HEADERS.JSON,
    ...headers
  };

  if (body !== undefined && !(body instanceof FormData)) {
    requestHeaders[HTTP_HEADERS.CONTENT_TYPE] = HTTP_HEADERS.JSON;
  }

  if (token) requestHeaders.Authorization = `Bearer ${token}`;

  const response = await comPrazo(buildUrl(path), {
    method,
    headers: requestHeaders,
    body: body instanceof FormData || body === undefined ? body : JSON.stringify(body)
  }, signal);

  const payload = await parseResponse(response);

  /* Access token vencido (1h): tenta refresh silencioso uma vez e repete a
     chamada original. Falhou o refresh => sessao morre e o app devolve para
     o login. */
  if (response.status === 401 && auth && !path.includes('/auth/refresh')) {
    if (await tryRefreshToken()) {
      return apiRequest(path, options);
    }
    storage.clearSession();
    window.dispatchEvent(new CustomEvent('pq:auth-expired'));
    throw new ApiError('Sessão expirada, faça login novamente', response, payload);
  }

  if (!response.ok) {
    /* O ENDERECO que falhou, no ponto em que a falha nasce.
       Quem captura la em cima so ve a mensagem — e "Field required" sem
       dizer de qual chamada, nem de qual campo, nao permite consertar nada.
       Aqui ainda temos path, status e corpo. */
    try {
      console.error('[api]', method, path, '->', response.status,
        (() => { try { return JSON.stringify(payload); } catch { return '<corpo nao serializavel>'; } })());
    } catch { /* log nunca pode derrubar a chamada */ }
    throw new ApiError(mensagemDoErro(payload), response, payload);
  }

  return payload;
}


/* O `detail` do FastAPI nem sempre e texto.

   Em erro de validacao (422) ele e uma LISTA de objetos
   ({type, loc, msg, input}), e passar isso para `new Error(...)` produz
   literalmente "[object Object]" na tela — foi o que apareceu ao criar uma
   senha fraca, no exato momento em que a pessoa mais precisava ler a regra.

   O prefixo "Value error, " e ruido do Pydantic e sai fora; varias falhas
   viram uma frase so, para nao empilhar toasts. */
function mensagemDoErro(payload) {
  const limpar = (texto) => String(texto).replace(/^Value error,\s*/i, '').trim();

  if (typeof payload?.message === 'string' && payload.message.trim()) {
    return payload.message.trim();
  }

  const detail = payload?.detail;
  if (typeof detail === 'string' && detail.trim()) return limpar(detail);

  if (Array.isArray(detail)) {
    const partes = detail
      .map((item) => (typeof item === 'string' ? item : item?.msg))
      .filter(Boolean)
      .map(limpar);
    if (partes.length) return [...new Set(partes)].join(' ');
  }

  if (detail && typeof detail === 'object' && detail.msg) return limpar(detail.msg);

  return 'Falha na comunicacao com a API';
}

export const api = {
  get(path, options) {
    return apiRequest(path, { ...options, method: 'GET' });
  },
  post(path, body, options) {
    return apiRequest(path, { ...options, method: 'POST', body });
  },
  put(path, body, options) {
    return apiRequest(path, { ...options, method: 'PUT', body });
  },
  patch(path, body, options) {
    return apiRequest(path, { ...options, method: 'PATCH', body });
  },
  delete(path, options) {
    return apiRequest(path, { ...options, method: 'DELETE' });
  }
};

export default api;
