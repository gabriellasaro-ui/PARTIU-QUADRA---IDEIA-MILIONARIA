/* Camada viva do painel do admin — liga as telas ao /api/admin/*.

   O backend ja devolve camelCase e valores em reais; as views consomem os
   campos diretamente. Com API_BASE_URL vazio nada muda: o painel usa o mock.
 */
import api from './api.js';

export const adminService = {
  async overview(periodo = '30d', inatividade = 7) {
    return api.get(`/api/admin/overview?periodo=${encodeURIComponent(periodo)}&inatividade=${Number(inatividade) || 0}`);
  },

  async arenas() {
    return api.get('/api/admin/arenas');
  },

  async reservas() {
    return api.get('/api/admin/reservas');
  },

  async clubes() {
    return api.get('/api/admin/clubes');
  },

  async pessoas({ q = '', cidade = '', estado = '', periodo = '30d', inatividade = 7 } = {}) {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (cidade) params.set('cidade', cidade);
    if (estado) params.set('estado', estado);
    params.set('periodo', periodo);
    params.set('inatividade', String(Number(inatividade) || 0));
    return api.get(`/api/admin/pessoas?${params.toString()}`);
  },

  pausarArena(id, motivo) {
    return api.post(`/api/admin/arenas/${encodeURIComponent(id)}/pause`, { motivo: motivo || '' });
  },

  reativarArena(id, motivo) {
    return api.post(`/api/admin/arenas/${encodeURIComponent(id)}/reactivate`, { motivo: motivo || '' });
  },

  /* Sem `situacao`, o backend devolve so as ABERTAS — que e a fila de
     trabalho. Listar tudo por padrao afogaria a tela em fichas ja decididas
     assim que o primeiro mes passasse. */
  async solicitacoes(situacao = '') {
    const q = situacao ? `?situacao=${encodeURIComponent(situacao)}` : '';
    return api.get(`/api/admin/solicitacoes${q}`);
  },

  async aprovarSolicitacao(id) {
    return api.post(`/api/admin/solicitacoes/${encodeURIComponent(id)}/aprovar`, {});
  },

  async recusarSolicitacao(id, motivo) {
    return api.post(`/api/admin/solicitacoes/${encodeURIComponent(id)}/recusar`, { motivo });
  },

  async auditoria() {
    return api.get('/api/admin/auditoria?limit=50');
  }
};

export default adminService;
