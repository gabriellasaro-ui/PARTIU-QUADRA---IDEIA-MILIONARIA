/* Configuracao real do app (jogador) para o webDir do Capacitor.

   No Capacitor o app roda em file://, entao API_BASE_URL precisa ser
   ABSOLUTA (location.origin nao existe). Default: backend de dev na LAN
   (192.168.3.19) — 'localhost' dentro do celular seria o proprio celular.
   Em producao troque por https://api.qadras.com.br. */
window.__PQ_CONFIG__ = {
  API_BASE_URL: 'http://192.168.3.19:8000',
  STORAGE_PREFIX: 'pq',
  REQUIRE_LOGIN: true,
  APP_PUBLIC_URL: ''
};
