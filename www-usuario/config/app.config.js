/* Configuracao real do app (jogador) para o webDir do Capacitor.

   No Capacitor o app roda em file://, entao API_BASE_URL precisa ser
   ABSOLUTA (location.origin nao existe). Default: backend de dev na LAN
   (192.168.0.19 — CONFIRA com ipconfig, o IP da LAN muda) — 'localhost' dentro do celular seria o proprio celular.
   Em producao troque por https://api.qadras.com.br. */
window.__PQ_CONFIG__ = {
  API_BASE_URL: 'http://192.168.0.19:8000',
  STORAGE_PREFIX: 'pq',
  REQUIRE_LOGIN: true,
  APP_PUBLIC_URL: '',
  /* Client ID web do Google (Cloud Console > APIs e servicos > Credenciais).
     Vazio = botao "Entrar com Google" nao aparece e nenhum script do Google
     e baixado. Precisa bater com GOOGLE_CLIENT_ID do backend. */
  GOOGLE_CLIENT_ID: '784118699391-qa8qouo0o9lkurjsum3medpq0hpsdkp8.apps.googleusercontent.com'
};
