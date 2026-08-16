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
    if (!session.ok) return false;
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

  const response = await fetch(buildUrl(path), {
    method,
    headers: requestHeaders,
    body: body instanceof FormData || body === undefined ? body : JSON.stringify(body),
    signal
  });

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
    const message = payload?.message || payload?.detail || 'Falha na comunicacao com a API';
    throw new ApiError(message, response, payload);
  }

  return payload;
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
