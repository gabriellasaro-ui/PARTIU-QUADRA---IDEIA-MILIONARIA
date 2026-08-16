/* Configuracao real do app (jogador). Default: backend de desenvolvimento
   em http://localhost:8000 (o FastAPI serve este frontend no mesmo origin).

   Em producao troque API_BASE_URL por https://api.qadras.com.br e ajuste
   REQUIRE_LOGIN se precisar (por padrao o login vira obrigatorio com a API
   ligada). APP_PUBLIC_URL = base publica do app para links de convite; vazio
   enquanto nao ha dominio publico. */
window.__PQ_CONFIG__ = {
  API_BASE_URL: 'http://localhost:8000',
  STORAGE_PREFIX: 'pq',
  REQUIRE_LOGIN: true,
  APP_PUBLIC_URL: ''
};
