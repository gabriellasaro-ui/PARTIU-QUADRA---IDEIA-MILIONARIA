const runtimeConfig = globalThis.__PQ_CONFIG__ || {};

export const APP_NAME = 'Qadras';
export const APP_VERSION = '0.1.0';
export const API_BASE_URL = runtimeConfig.API_BASE_URL || '';
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
