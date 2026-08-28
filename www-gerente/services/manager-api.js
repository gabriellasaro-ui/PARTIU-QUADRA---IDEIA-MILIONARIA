/* Camada viva do painel do gerente — liga as telas ao /api/gerente/*.

   Toda funcao devolve EXATAMENTE o formato que as views ja consomem
   (manager-data.js / manager-bookings.js), so que vindo do backend real. Com
   API_BASE_URL vazio nada muda: as views caem no mock de sempre.

   O backend ja devolve status em rotulo humano ("Solicitada", "Confirmada",
   ...); aqui esses rotulos sao normalizados para os do mock antigo, que e o
   que o CSS e as condicoes das views conhecem.
 */
import { API_BASE_URL } from '../config/constants.js';
import api from './api.js';

/* Rotulo da API -> rotulo legado das views + classe de cor do CSS.
   Nao ha "Pago" na API: pagamento confirmado vira "Solicitada" (aguarda
   aprovacao) ou "Confirmado" (ja aprovado). O unico que nao existia no mock
   e "Aguardando pagamento", que aqui vira "Pendente" para o gerente saber
   que aquela reserva nao esta pronta para jogar. */
const STATUS_LEGACY = {
  'Aguardando pagamento': 'Pendente',
  'Solicitada': 'Solicitada',
  'Confirmada': 'Confirmado',
  'Concluída': 'Confirmado',
  'Não aceita pela arena': 'Recusada',
  'Tempo expirado': 'Recusada',
  'Cancelada': 'Cancelada',
  'Pagamento falhou': 'Cancelada',
  'Reembolsada': 'Cancelada'
};

const STATUS_CLS = {
  'Solicitada': 'solicitada',
  'Pendente': 'pendente',
  'Confirmado': 'confirmado',
  'Recusada': 'recusada',
  'Cancelada': 'cancelada'
};

export const mapBooking = (b) => {
  const status = STATUS_LEGACY[b.status] || b.status;
  return {
    id: b.id,
    codigo: b.code,
    cliente: b.cliente,
    telefone: b.telefone,
    quadra: b.quadra,
    esporte: b.esporte,
    data: b.data,
    dataValue: b.dataValue,
    hora: b.hora,
    valor: b.valor,
    total: b.total,
    repasse: b.repasse,
    status,
    // `plan` ja existe logo abaixo; aqui entra so o que faltava.
    recorrencia: b.recorrencia,
    sessoes: b.sessoes || [],
    cls: STATUS_CLS[status] || b.statusClass || 'pendente',
    plan: b.plan,
    /* DE QUEM E O JOGO. `null` quando a reserva e de pessoa fisica.

       ⚠️ Este mapa reescreve a reserva CAMPO A CAMPO, e tudo que nao esta
       listado aqui e descartado em silencio. O backend ja mandava `clube`, a
       linha ja sabia desenha-lo, e mesmo assim nao aparecia nada — o dado
       morria nesta funcao, sem erro nenhum. Campo novo no backend precisa
       passar por aqui. */
    clube: b.clube || null,
    source: b.source,
    statusAt: b.statusAt
  };
};

const mapCourt = (c) => ({
  id: c.id,
  label: c.nome,
  sport: c.esporte,
  bairro: c.descricao || '',
  descricao: c.descricao || '',
  price: c.preco,
  priceMonthly: c.precoMensalista ?? c.preco * 4,
  active: c.ativa,
  abre: Number(String(c.abertura).split(':')[0]),
  fecha: Number(String(c.fechamento).split(':')[0]),
  photo: (c.fotos && c.fotos[0]) || '',
  /* Quantas fotos a quadra tem. A vitrine exige cinco, e o catalogo precisa
     dizer quais quadras ainda nao chegaram la — senao o dono so descobre
     quando percebe que aquela quadra nao recebe reserva. */
  fotos: (c.fotos || []).length,
  /* A lista COMPLETA, para a tela de edicao repovoar a galeria. Sem ela,
     editar o preco enviaria fotos: [] e apagaria as existentes. */
  fotosLista: c.fotos || [],
  occupancy: 0,
  amenities: c.comodidades || []
});

const mapMensalista = (m) => ({
  id: m.id,
  name: m.cliente,
  court: m.quadra,
  day: weekdayPt(m.dia),
  time: m.hora,
  price: m.preco,
  status: m.status,
  group_id: m.group_id
});

const mapReview = (a) => ({
  id: a.id,
  cliente: a.cliente,
  nota: a.nota,
  quando: a.quando,
  texto: a.texto,
  resposta: a.resposta,
  /* Qual quadra foi avaliada. Sem isto "o vestiario estava sujo" nao diz QUAL
     vestiario, e o dono nao tem o que fazer com a reclamacao. */
  quadraId: a.quadraId || '',
  quadraNome: a.quadraNome || ''
});

/* Dia da semana do servidor ("Tuesday") -> nome em portugues em minusculo,
   que e o formato do mock e do formulario. */
const WEEKDAYS_PT = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
export function weekdayPt(value) {
  const mapa = {
    Monday: 'segunda', Tuesday: 'terça', Wednesday: 'quarta',
    Thursday: 'quinta', Friday: 'sexta', Saturday: 'sábado', Sunday: 'domingo'
  };
  if (mapa[value]) return mapa[value];
  const numero = Number(value);
  if (Number.isInteger(numero) && numero >= 0 && numero <= 6) return WEEKDAYS_PT[numero];
  return String(value || '').toLowerCase();
}

/* Reserva -> formato que a agenda consome: dia concreto, inicio/fim numericos. */
const horaNumero = (t) => {
  const [h, m] = String(t).split(':').map(Number);
  return h + (m || 0) / 60;
};

export const mapAgendaEvent = (e) => {
  const status = STATUS_LEGACY[e.status] || e.status;
  const inicio = horaNumero(e.inicio);
  const fim = horaNumero(e.fim);
  return {
    ...e,
    dataValue: e.dia,
    data: e.dia,
    codigo: e.code,
    status,
    cls: STATUS_CLS[status] || e.statusClass || 'pendente',
    inicio,
    fim,
    duracao: `${fim - inicio}h`,
    horaCurta: e.inicio
  };
};

export const managerService = {
  async dashboard() {
    return api.get('/api/gerente/dashboard');
  },

  async agenda(semana) {
    const data = await api.get(`/api/gerente/agenda${semana ? `?semana=${encodeURIComponent(semana)}` : ''}`);
    return {
      quadras: (data.quadras || []).map(mapCourt),
      eventos: (data.eventos || []).map(mapAgendaEvent),
      colunas: data.colunas || [],
      /* O expediente por quadra e por dia. Sem ele a grade nao distingue
         horario livre de quadra fechada, e espaco vazio volta a ser ambiguo —
         que era o defeito. Este mapa estava sendo descartado aqui. */
      expediente: data.expediente || {}
    };
  },

  /* Reservas PAGINADAS.

     Devolve o envelope inteiro ({reservas, total, pagina, paginas}) e nao so a
     lista: sem o total, a tela nao tem como numerar as paginas nem dizer
     quantas reservas existem. Antes vinha uma lista cortada em 200 linhas sem
     avisar do corte. */
  async reservas({ pagina = 1, porPagina = 20, status, q, plano, semSessoes, de, ate } = {}) {
    const p = new URLSearchParams({ pagina: String(pagina), porPagina: String(porPagina) });
    if (status) p.set('status', status);
    if (q) p.set('q', q);
    if (plano) p.set('plano', plano);
    /* Esconde as 3 sessoes filhas do mensalista: sao o mesmo compromisso da
       reserva-pai e virariam quatro linhas iguais na fila do dono. */
    if (semSessoes) p.set('semSessoes', 'true');
    if (de) p.set('de', de);
    if (ate) p.set('ate', ate);
    const data = await api.get(`/api/gerente/reservas?${p}`);
    return {
      reservas: (data.reservas || []).map(mapBooking),
      total: data.total || 0,
      pagina: data.pagina || 1,
      paginas: data.paginas || 1,
      porPagina: data.porPagina || porPagina
    };
  },

  async reserva(id) {
    const data = await api.get(`/api/gerente/reservas${id ? `?q=${encodeURIComponent(id)}` : ''}`);
    return (data.reservas || []).find((b) => String(b.id) === String(id)) || null;
  },

  async criarReservaManual(body) {
    const data = await api.post('/api/gerente/reservas', body);
    return mapBooking(data.reserva);
  },

  aprovarReserva(id) {
    return api.post(`/api/reservas/${id}/aprovar`, {});
  },

  recusarReserva(id) {
    return api.post(`/api/reservas/${id}/recusar`, {});
  },

  cancelarReserva(id) {
    return api.post(`/api/reservas/${id}/cancelar`, {});
  },

  async mensalistas() {
    const data = await api.get('/api/gerente/mensalistas');
    return (data.mensalistas || []).map(mapMensalista);
  },

  criarMensalista(body) {
    return api.post('/api/gerente/mensalistas', body);
  },

  cancelarMensalista(id) {
    return api.delete(`/api/gerente/mensalistas/${id}`);
  },

  /* Aceita atalho ('7d', '30d') OU intervalo proprio ({de, ate}).

     Quem fecha o mes precisa de "1 a 31 de julho", e nao de "os ultimos 30
     dias a partir de agora" — os atalhos continuam para o uso do dia a dia. */
  /* Mapa de calor: dia da semana x hora, com reservas E procura. */
  async ritmo({ de, ate } = {}) {
    const q = new URLSearchParams();
    if (de) q.set('de', de);
    if (ate) q.set('ate', ate);
    return api.get(`/api/gerente/ritmo${q.toString() ? '?' + q : ''}`);
  },

  async financeiro(periodo = '7d') {
    const q = new URLSearchParams();
    if (periodo && typeof periodo === 'object') {
      if (periodo.de) q.set('de', periodo.de);
      if (periodo.ate) q.set('ate', periodo.ate);
    } else {
      q.set('periodo', String(periodo));
    }
    return api.get(`/api/gerente/financeiro?${q}`);
  },

  /* Devolve as quadras E os numeros da vitrine.

     A vitrine vinha de constantes escritas a mao no front; agora sai do mesmo
     lugar que as quadras, porque e sobre elas que os numeros falam. */
  async quadras() {
    const data = await api.get('/api/gerente/quadras');
    return {
      quadras: (data.quadras || []).map(mapCourt),
      vitrine: data.vitrine || null
    };
  },

  criarQuadra(body) {
    return api.post('/api/gerente/quadras', body);
  },

  atualizarQuadra(id, body) {
    return api.patch(`/api/gerente/quadras/${id}`, body);
  },

  async avaliacoes(quadra) {
    const q = quadra ? `?quadra=${encodeURIComponent(quadra)}` : '';
    const data = await api.get(`/api/gerente/avaliacoes${q}`);
    return {
      avaliacoes: (data.avaliacoes || []).map(mapReview),
      dist: data.dist || [],
      total: data.total || 0,
      media: data.media || 0,
      /* A quebra POR QUADRA. A media da arena junta tudo: com quatro quadras,
         a que esta com problema dilui nas outras e o dono ve 4,8 concluindo
         que esta tudo bem. */
      quadras: data.quadras || []
    };
  },

  responderAvaliacao(id, resposta) {
    return api.post(`/api/gerente/avaliacoes/${id}/resposta`, { resposta });
  },

  async cupons() {
    const data = await api.get('/api/gerente/cupons');
    return data.cupons || [];
  },

  criarCupom(body) {
    return api.post('/api/gerente/cupons', body);
  },

  excluirCupom(id) {
    return api.delete(`/api/gerente/cupons/${id}`);
  },

  async perfil() {
    return api.get('/api/gerente/perfil');
  },

  atualizarPerfil(body) {
    return api.patch('/api/gerente/perfil', body);
  },

  async configuracoes() {
    return api.get('/api/gerente/configuracoes');
  },

  atualizarConfiguracoes(body) {
    return api.patch('/api/gerente/configuracoes', body);
  },

  /* DESATIVAR A ARENA. A rota existe desde a fase 2 e o painel nunca a chamou:
     o botao mostrava um toast "Arena desativada (demo)" e nao desativava nada.

     Ela nao e so um interruptor de visibilidade — CANCELA todas as reservas
     futuras e devolve quantas foram. Por isso a tela pergunta antes e mostra o
     numero depois: o dono precisa saber quantas pessoas acabaram de perder o
     horario que tinham. */
  /* EXPEDIENTE DA QUADRA — os sete dias.

     PUT e nao PATCH: o editor manda a semana inteira e o servidor reescreve os
     sete dias. PATCH sugeriria que dia omitido fica como estava, e o que
     acontece e o contrario. */
  expediente(quadraId) {
    return api.get(`/api/gerente/quadras/${encodeURIComponent(quadraId)}/expediente`);
  },

  salvarExpediente(quadraId, dias) {
    return api.put(`/api/gerente/quadras/${encodeURIComponent(quadraId)}/expediente`, { dias });
  },

  desativarArena(motivo, periodo) {
    return api.post('/api/gerente/desativacao', { motivo, periodo });
  }
};

export default managerService;
