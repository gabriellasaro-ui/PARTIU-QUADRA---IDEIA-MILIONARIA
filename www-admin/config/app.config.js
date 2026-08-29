/* Painel do admin — roda local, mas fala com o backend ONLINE.
 
   E o unico dos quatro apps que nao esta hospedado: ele abre da sua maquina.
   Antes apontava para `http://localhost:8000` cravado, o que so funcionava se
   voce tambem estivesse rodando o backend aqui — abrir de outro computador
   dava uma tela vazia sem erro nenhum.
 
   Apontando para a VPS, a triagem de arenas mostra as solicitacoes DE VERDADE,
   que e o unico lugar onde elas existem.
 
   Para depurar contra o backend desta maquina, troque por
   `http://localhost:8000` — o painel roda igual nos dois. */
window.__PQ_CONFIG__ = {
  API_BASE_URL: 'https://api.qadras.com.br',
  STORAGE_PREFIX: 'pq'
};
