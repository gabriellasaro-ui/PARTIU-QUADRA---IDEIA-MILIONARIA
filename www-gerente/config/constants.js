const runtimeConfig = globalThis.__PQ_CONFIG__ || {};

export const APP_NAME = 'Qadras';
export const APP_VERSION = '0.1.0';
export const API_BASE_URL = runtimeConfig.API_BASE_URL || '';
export const STORAGE_PREFIX = runtimeConfig.STORAGE_PREFIX || 'pq';
/* Vazio = login com Google desligado (o front nem baixa o script do Google).
   Precisa bater com GOOGLE_CLIENT_ID do backend, que e quem valida. */
export const GOOGLE_CLIENT_ID = runtimeConfig.GOOGLE_CLIENT_ID || '';
export const DEFAULT_LOCALE = 'pt-BR';
export const DEFAULT_CURRENCY = 'BRL';
/* Duas taxas, porque a cobranca e dos dois lados.

   PLAYER_FEE_RATE entra POR CIMA do preco da quadra: quadra de R$ 120 vira
   R$ 130,80 no checkout.
   ARENA_FEE_RATE sai POR DENTRO do repasse: dos mesmos R$ 120 a arena
   recebe R$ 116,40.

   SERVICE_FEE_RATE continua exportado apontando para a taxa do jogador —
   e a que o checkout usa, e havia consumidor demais para renomear de uma
   vez sem risco. */
export const PLAYER_FEE_RATE = 0.0989011;
export const ARENA_FEE_RATE = 0.03;
export const SERVICE_FEE_RATE = PLAYER_FEE_RATE;

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
