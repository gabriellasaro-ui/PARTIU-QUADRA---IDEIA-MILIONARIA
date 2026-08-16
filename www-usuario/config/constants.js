const runtimeConfig = globalThis.__PQ_CONFIG__ || {};

export const APP_NAME = 'Qadras';
export const APP_VERSION = '0.1.0';
export const API_BASE_URL = runtimeConfig.API_BASE_URL || '';

/* Base publica do app, usada no link de convite do clube. Fica vazia por
   padrão de proposito: no Capacitor o app roda em file:// e location.origin
   e a string "null" — montar link a partir dali mandaria um endereco
   quebrado para o WhatsApp de alguem. Sem base, o convite compartilha so o
   texto com o codigo. */
export const APP_PUBLIC_URL = runtimeConfig.APP_PUBLIC_URL || '';

/* Exigir conta para reservar, abrir Carteira, Clube etc.

   Liga automaticamente quando a API estiver configurada (API_BASE_URL
   presente) — o backend decide autorizacao, entao sem conta nao ha o que
   reservar de verdade. Para forcar livre mesmo com API, defina
   REQUIRE_LOGIN: false no app.config.js. */
export const REQUIRE_LOGIN = runtimeConfig.REQUIRE_LOGIN ?? Boolean(runtimeConfig.API_BASE_URL);
export const STORAGE_PREFIX = runtimeConfig.STORAGE_PREFIX || 'pq';
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
export const PLAYER_FEE_RATE = 0.09;
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
