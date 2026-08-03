const runtimeConfig = globalThis.__PQ_CONFIG__ || {};

export const APP_NAME = 'Qadras';
export const APP_VERSION = '0.1.0';
export const API_BASE_URL = runtimeConfig.API_BASE_URL || '';

/* Base publica do app, usada no link de convite do clube. Fica vazia por
   padrao de proposito: no Capacitor o app roda em file:// e location.origin
   e a string "null" — montar link a partir dali mandaria um endereco
   quebrado para o WhatsApp de alguem. Sem base, o convite compartilha so o
   texto com o codigo. */
export const APP_PUBLIC_URL = runtimeConfig.APP_PUBLIC_URL || '';
export const STORAGE_PREFIX = runtimeConfig.STORAGE_PREFIX || 'pq';
export const DEFAULT_LOCALE = 'pt-BR';
export const DEFAULT_CURRENCY = 'BRL';
export const SERVICE_FEE_RATE = 0.05;

export const HTTP_HEADERS = {
  ACCEPT: 'Accept',
  CONTENT_TYPE: 'Content-Type',
  JSON: 'application/json'
};

export const CAPACITOR_READY = {
  webDir: 'www-usuario',
  usesRelativePaths: true,
  apiLayer: 'services/api.js'
};
