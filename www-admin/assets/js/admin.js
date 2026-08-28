/* Painel do dono da plataforma.

   A diferenca para o painel do gerente e o ponto de vista: o gerente ve a
   arena DELE e decide operacao; aqui se ve a plataforma inteira e o que ela
   ganha. Por isso o numero que abre a tela nao e o faturamento das quadras,
   e sim a taxa de servico — o dinheiro que de fato entra no negocio.

   Le o mesmo armazenamento do app (chaves pq:*) e a mesma semente. Sem
   backend, isso significa que cada navegador enxerga o proprio dado; o
   painel diz isso na lateral em vez de fingir ser producao. */
import { VENUES, CLUBS, PELADAS, INITIAL_RESERVATIONS, USERS, PLATFORM_BOOKINGS } from '../../config/mock-data.js';
import { API_BASE_URL, ARENA_FEE_RATE, SERVICE_FEE_RATE } from '../../config/constants.js';
import storage from '../../storage/storage.js';
import { formatCurrency } from '../../utils/formatters.js';
/* ⚠️ ../../ e nao ../ — este arquivo esta em assets/js/, e os servicos na
   RAIZ do www-admin. Com um nivel a menos os dois caem em
   /assets/services/*.js, que nao existe: o modulo inteiro falha ao carregar e
   o painel nao desenha NADA. Nao havia erro visivel porque o que sobra na tela
   e o HTML estatico do index.html, que ja tem titulo e menu — dava para abrir
   o painel e achar que ele so estava vazio. */
import adminService from '../../services/admin-api.js';
import authService from '../../services/auth.js';

/* Com API_BASE_URL preenchido as telas consomem o /api/admin/* (visao geral,
   arenas, reservas, clubes e pessoas) e o painel exige login de admin. Sem
   backend, segue o mock de sempre. */
const viaApi = Boolean(API_BASE_URL);
const TAXA_PLATAFORMA = SERVICE_FEE_RATE + ARENA_FEE_RATE;

const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/* '2026-07-28' -> '28/07'. O ano so importa no filtro, nao na linha. */
function dataCurta(iso) {
  const [, m, d] = String(iso).split('-');
  return d ? `${d}/${m}` : iso;
}

const TITLES = {
  visao: ['Visão geral', 'A plataforma inteira num lugar só'],
  arenas: ['Arenas', 'Quem oferece quadra na plataforma'],
  reservas: ['Reservas', 'Todo volume que passou pelo app'],
  clubes: ['Clubes', 'Os grupos que organizam pelada recorrente'],
  pessoas: ['Pessoas', 'Quem se cadastrou e quem anda sumido'],
  solicitacoes: ['Solicitações', 'Quem quer entrar — e o que dá para conferir']
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

/* Overrides de preco vem do painel do gerente; aplicar aqui garante que o
   dono ve o preco que a arena realmente pratica, nao o da semente. */
function venues() {
  const overrides = storage.get('venue_overrides', {});
  return VENUES.map((venue) => ({ ...venue, ...(overrides[venue.id] || {}) }));
}

const reservations = () => storage.get('reservations', INITIAL_RESERVATIONS);
const peladas = () => storage.get('peladas', PELADAS);
const clubs = () => storage.get('clubs', CLUBS);

/* Um plano e o conjunto de sessoes nascidas da mesma reserva. */
function planos() {
  const mapa = new Map();
  peladas().filter((p) => p.plan === 'mensalista' && p.reservationCode).forEach((p) => {
    const atual = mapa.get(p.reservationCode)
      || { venueName: p.venueName, startTime: p.startTime, sessoes: [] };
    atual.sessoes.push(p);
    mapa.set(p.reservationCode, atual);
  });
  return mapa;
}

/* O preco que o jogador paga ja inclui a taxa, entao a parte da plataforma
   sai de dentro do total — nao por cima dele. */
function corteDaPlataforma(valor) {
  return Number(valor || 0) * (SERVICE_FEE_RATE / (1 + SERVICE_FEE_RATE));
}

/* Dias desde a ultima atividade — e o unico numero que decide quem entra na
   fila de reativacao, entao vive num lugar so. */
function diasSemUsar(user, campo = 'lastActiveAt') {
  return Math.floor((Date.now() - new Date(user[campo]).getTime()) / 86400000);
}

/* ═══════════════ Filtros ═══════════════

   O painel nao tinha um unico input. Cada view era uma template string
   reconstruida do zero a cada hashchange, entao o estado de filtro precisa
   viver fora do render — senao a pessoa digita e o proximo render apaga.

   O padrao e o mesmo que ja funciona em manager-reservations.js: estado em
   variavel de modulo, delegacao de evento no document, re-render inteiro. */
const filtros = {
  periodo: '30d',      // visao geral e reservas
  inatividade: '7',    // faixa da fila de reativacao
  busca: '',           // nome da pessoa
  cidade: '',
  estado: ''
};

const PERIODOS = [
  { id: '7d', label: '7 dias', dias: 7 },
  { id: '30d', label: '30 dias', dias: 30 },
  { id: '90d', label: '90 dias', dias: 90 },
  { id: 'tudo', label: 'Tudo', dias: Infinity }
];

const FAIXAS_INATIVIDADE = [
  { id: '7', label: '+7d' },
  { id: '14', label: '+14d' },
  { id: '21', label: '+21d' },
  { id: '30', label: '+30d' },
  { id: '60', label: '+1 mês' }
];

/* As reservas da plataforma tem dateISO de verdade; as do jogador tem
   rotulo ('Hoje', 'Sex, 12/06'), que nao da para comparar. Por isso o
   filtro por data so existe sobre PLATFORM_BOOKINGS. */
function reservasNoPeriodo() {
  const faixa = PERIODOS.find((p) => p.id === filtros.periodo) || PERIODOS[1];
  if (faixa.dias === Infinity) return PLATFORM_BOOKINGS;
  const corte = Date.now() - faixa.dias * 86400000;
  return PLATFORM_BOOKINGS.filter((r) => new Date(`${r.dateISO}T12:00`).getTime() >= corte);
}

function pessoasFiltradas() {
  const termo = filtros.busca.trim().toLowerCase();
  return USERS.filter((u) => (!termo || u.name.toLowerCase().includes(termo))
    && (!filtros.cidade || u.city === filtros.cidade)
    && (!filtros.estado || u.state === filtros.estado));
}

const distintos = (campo) => [...new Set(USERS.map((u) => u[campo]).filter(Boolean))].sort();

/* Quanto cada pessoa gastou. Antes era impossivel: as reservas nao tinham
   dono. */
function gastoPor(userId, lista = PLATFORM_BOOKINGS) {
  return lista.filter((r) => r.userId === userId).reduce((t, r) => t + Number(r.price || 0), 0);
}

function segmento(nome, opcoes, atual) {
  return `<div class="admin-seg" role="group">${opcoes.map((o) => `
    <button type="button" data-admin-filter="${nome}" data-valor="${escapeHtml(o.id)}"
            class="${o.id === atual ? 'on' : ''}">${escapeHtml(o.label)}</button>`).join('')}</div>`;
}

function kpi(label, valor, nota, destaque) {
  return `<article class="kpi${destaque ? ' kpi--strong' : ''}">
    <small>${escapeHtml(label)}</small>
    <strong>${valor}</strong>
    ${nota ? `<em>${escapeHtml(nota)}</em>` : ''}
  </article>`;
}

/* Dias desde uma data ISO (ou ISO datetime). Usado so no modo API, onde o
   backend ja calcula os numeros; aqui vira legenda humana. */
function diasAtras(value) {
  if (!value) return '—';
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? `${value}T12:00` : value;
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return dias <= 0 ? 'hoje' : `${dias} dias atrás`;
}

/* A API devolve "19:00 – 20:00"; o painel mostra so o inicio. */
function horaInicio(hora) {
  return String(hora || '').split(/[–-]/)[0].trim();
}

function viewVisaoMock() {
  const lista = venues();
  // O periodo vale sobre o historico da plataforma, que tem data real.
  const res = reservasNoPeriodo();
  const gmv = res.reduce((total, r) => total + Number(r.price || 0), 0);
  const receita = Math.round(corteDaPlataforma(gmv) * 100) / 100;
  const ativas = lista.filter((v) => v.active !== false).length;

  const jogadores = USERS.filter((u) => u.role === 'jogador');
  const donos = USERS.filter((u) => u.role === 'dono');
  const corte = Number(filtros.inatividade);
  const inativos = USERS.filter((u) => diasSemUsar(u) > corte);
  const ativos = USERS.length - inativos.length;

  /* RPU sobre quem de fato reservou, nao sobre a base inteira: dividir por
     todo mundo cadastrado mistura quem nunca usou, e o numero deixa de
     dizer alguma coisa quando a base cresce. O ticket medio vem junto
     porque ele nao engana. */
  const compradores = new Set(res.map((r) => r.userId)).size;
  const rpu = compradores ? receita / compradores : 0;
  const ticket = res.length ? gmv / res.length : 0;

  return `<div class="admin-toolbar">
    <span class="admin-toolbar__label">Período</span>
    ${segmento('periodo', PERIODOS, filtros.periodo)}
  </div>

  <div class="kpi-grid">
    ${kpi('Receita da plataforma', formatCurrency(receita), `taxa de ${Math.round(SERVICE_FEE_RATE * 100)}% sobre as reservas`, true)}
    ${kpi('Volume transacionado', formatCurrency(gmv), `${res.length} reservas`)}
    ${kpi('Jogos marcados', peladas().length, 'peladas nascidas de reservas')}
    ${kpi('Planos mensalistas', planos().size, 'receita recorrente')}
  </div>

  <div class="kpi-grid">
    ${kpi('Cadastrados', USERS.length, `${jogadores.length} jogadores · ${donos.length} donos de quadra`)}
    ${kpi('Ativos', ativos, 'usaram nos últimos 7 dias')}
    ${kpi(`Inativos há +${corte} dias`, inativos.length, inativos.length ? 'candidatos a notificação' : 'ninguém sumido')}
    ${kpi('Arenas ativas', ativas, `de ${lista.length} cadastradas`)}
  </div>

  <div class="kpi-grid">
    ${kpi('RPU', formatCurrency(rpu), `receita ÷ ${compradores} ${compradores === 1 ? 'pessoa que reservou' : 'pessoas que reservaram'}`, true)}
    ${kpi('Ticket médio', formatCurrency(ticket), 'por reserva')}
    ${kpi('Reservas no período', res.length, 'com data real')}
    ${kpi('Volume no período', formatCurrency(gmv), 'transacionado')}
  </div>

  <div class="admin-toolbar">
    <span class="admin-toolbar__label">Sem usar há</span>
    ${segmento('inatividade', FAIXAS_INATIVIDADE, filtros.inatividade)}
  </div>

  ${inativos.length ? `<section class="panel">
    <h2>Fila de reativação</h2>
    <p class="muted" style="margin-bottom:14px">Quem não abre o app há mais de ${corte} dias. É esta lista que alimenta o disparo de notificação.</p>
    <table class="tbl">
      <thead><tr><th>Pessoa</th><th>Papel</th><th>Cidade</th><th>Sem usar</th><th>Cadastro</th></tr></thead>
      <tbody>
        ${inativos.sort((a, b) => diasSemUsar(b) - diasSemUsar(a)).map((u) => `<tr>
          <td><strong>${escapeHtml(u.name)}</strong></td>
          <td>${u.role === 'dono' ? 'Dono de quadra' : 'Jogador'}</td>
          <td>${escapeHtml(u.city)}</td>
          <td class="num"><span class="tag tag--pendente">${diasSemUsar(u)} dias</span></td>
          <td class="num">${diasSemUsar(u, 'createdAt')} dias atrás</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </section>` : ''}

  <section class="panel">
    <h2>Últimas reservas</h2>
    <table class="tbl">
      <thead><tr><th>Código</th><th>Pessoa</th><th>Arena</th><th>Quando</th><th>Valor</th><th>Plataforma</th></tr></thead>
      <tbody>
        ${[...res].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 10).map((r) => {
          const venue = lista.find((v) => v.id === r.venueId);
          const pessoa = USERS.find((u) => u.id === r.userId);
          return `<tr>
            <td class="mono">${escapeHtml(r.code)}</td>
            <td>${escapeHtml(pessoa?.name || '-')}</td>
            <td>${escapeHtml(venue?.name || '-')}</td>
            <td>${escapeHtml(dataCurta(r.dateISO))} · ${escapeHtml(r.hour)}</td>
            <td class="num">${formatCurrency(r.price)}</td>
            <td class="num strong">${formatCurrency(corteDaPlataforma(r.price))}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </section>`;
}


function viewArenasMock() {
  const res = reservations();
  return `<section class="panel">
    <h2>Arenas na plataforma</h2>
    <table class="tbl">
      <thead><tr><th>Arena</th><th>Esporte</th><th>Avulso</th><th>Mensalista</th><th>Reservas</th><th>Status</th></tr></thead>
      <tbody>
        ${venues().map((v) => `<tr>
          <td><strong>${escapeHtml(v.name)}</strong><br><small>${escapeHtml(v.neighborhood)}</small></td>
          <td>${escapeHtml(v.sport)}</td>
          <td class="num">${formatCurrency(v.price)}</td>
          <td class="num">${formatCurrency(v.priceMonthly || v.price * 4)}</td>
          <td class="num">${res.filter((r) => r.venueId === v.id).length}</td>
          <td><span class="tag tag--${v.active === false ? 'pendente' : 'pago'}">${v.active === false ? 'Pausada' : 'Ativa'}</span></td>
        </tr>`).join('')}
      </tbody>
    </table>
  </section>`;
}

function viewReservasMock() {
  const mensais = planos();
  const res = reservations();
  const avulsas = res.filter((r) => !mensais.has(r.code));

  return `<div class="kpi-grid">
    ${kpi('Mensalistas', mensais.size, 'cobrança recorrente')}
    ${kpi('Avulsas', avulsas.length, 'cobrança única')}
    ${kpi('Sessões agendadas', peladas().length, 'peladas nascidas de reservas')}
  </div>

  <section class="panel">
    <h2>Planos mensalistas</h2>
    ${mensais.size ? `<table class="tbl">
      <thead><tr><th>Reserva</th><th>Arena</th><th>Compromisso</th><th>Sessões</th></tr></thead>
      <tbody>
        ${[...mensais.entries()].map(([code, plano]) => `<tr>
          <td class="mono">${escapeHtml(code)}</td>
          <td>${escapeHtml(plano.venueName)}</td>
          <td>Toda ${WEEKDAYS[new Date(`${plano.sessoes[0].dateISO}T12:00`).getDay()]} às ${escapeHtml(plano.startTime)}</td>
          <td class="num">${plano.sessoes.length}</td>
        </tr>`).join('')}
      </tbody>
    </table>` : '<p class="muted">Nenhum plano mensalista ainda. Eles aparecem aqui assim que alguém assinar.</p>'}
  </section>`;
}

function viewClubesMock() {
  const lista = clubs();
  const todas = peladas();
  return `<section class="panel">
    <h2>Clubes</h2>
    ${lista.length ? `<div class="club-grid">
      ${lista.map((club) => `<article class="club-tile">
        <span class="club-tile__mark">${escapeHtml(club.name.charAt(0))}</span>
        <strong>${escapeHtml(club.name)}</strong>
        <small>${escapeHtml(club.sport)} · ${escapeHtml(club.city)}</small>
        <div class="club-tile__nums">
          <span><b>${club.members.length}</b> membros</span>
          <span><b>${todas.filter((p) => p.clubId === club.id).length}</b> peladas</span>
        </div>
      </article>`).join('')}
    </div>` : '<p class="muted">Nenhum clube criado ainda.</p>'}
  </section>`;
}

function viewPessoasMock() {
  const noPeriodo = reservasNoPeriodo();
  const ordenados = pessoasFiltradas()
    .map((u) => ({ ...u, gasto: gastoPor(u.id, noPeriodo) }))
    .sort((a, b) => b.gasto - a.gasto || new Date(b.createdAt) - new Date(a.createdAt));
  const corte = Number(filtros.inatividade);

  return `<div class="admin-toolbar admin-toolbar--wrap">
    <input type="search" class="admin-input" placeholder="Buscar pessoa"
           data-admin-search value="${escapeHtml(filtros.busca)}">
    <select class="admin-select" data-admin-filter="cidade">
      <option value="">Todas as cidades</option>
      ${distintos('city').map((c) => `<option${c === filtros.cidade ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('')}
    </select>
    <select class="admin-select" data-admin-filter="estado">
      <option value="">Todos os estados</option>
      ${distintos('state').map((e) => `<option${e === filtros.estado ? ' selected' : ''}>${escapeHtml(e)}</option>`).join('')}
    </select>
    ${segmento('periodo', PERIODOS, filtros.periodo)}
  </div>

  <section class="panel">
    <h2>Todo mundo na plataforma <span class="muted">· ${ordenados.length}</span></h2>
    ${ordenados.length ? `<table class="tbl">
      <thead><tr><th>Pessoa</th><th>Papel</th><th>Cidade</th><th>Gastou</th><th>Cadastro</th><th>Última atividade</th><th>Situação</th></tr></thead>
      <tbody>
        ${ordenados.map((u) => {
          const dias = diasSemUsar(u);
          const inativo = dias > corte;
          return `<tr>
            <td><strong>${escapeHtml(u.name)}</strong></td>
            <td>${u.role === 'dono' ? 'Dono de quadra' : 'Jogador'}</td>
            <td>${escapeHtml(u.city)}${u.state ? ` · ${escapeHtml(u.state)}` : ''}</td>
            <td class="num strong">${u.gasto ? formatCurrency(u.gasto) : '—'}</td>
            <td class="num">${diasSemUsar(u, 'createdAt')} dias atrás</td>
            <td class="num">${dias === 0 ? 'hoje' : `${dias} dias atrás`}</td>
            <td><span class="tag tag--${inativo ? 'pendente' : 'pago'}">${inativo ? 'Inativo' : 'Ativo'}</span></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>` : '<p class="muted">Ninguém com esses filtros.</p>'}
  </section>`;
}

/* ═══════════════ Views no modo API ═══════════════

   O backend ja devolve camelCase com valores em reais; aqui os campos vao
   direto para o template. A receita da plataforma sai do ledger de pagamentos
   confirmados (12% do subtotal). */

async function viewVisaoApi() {
  const [d, audit] = await Promise.all([
    adminService.overview(filtros.periodo, filtros.inatividade),
    adminService.auditoria().catch(() => ({ acoes: [] }))
  ]);
  const corte = Number(filtros.inatividade) || 7;
  const fila = d.filaReativacao || [];
  const res = d.ultimasReservas || [];
  const acoes = audit.acoes || [];

  const compradores = d.compradores || 0;
  const filaLinhas = fila.map((u) => `<tr>
    <td><strong>${escapeHtml(u.nome)}</strong></td>
    <td>${escapeHtml(u.papel)}</td>
    <td>${escapeHtml(u.cidade)}</td>
    <td class="num"><span class="tag tag--pendente">${u.diasInativo} dias</span></td>
    <td class="num">${diasAtras(u.cadastro)}</td>
  </tr>`).join('');

  const resLinhas = res.map((r) => `<tr>
    <td class="mono">${escapeHtml(r.code)}</td>
    <td>${escapeHtml(r.cliente)}</td>
    <td>${escapeHtml(r.arena)}</td>
    <td>${escapeHtml(r.data)} · ${escapeHtml(horaInicio(r.hora))}</td>
    <td class="num">${formatCurrency(r.valor)}</td>
    <td class="num strong">${formatCurrency(r.plataforma)}</td>
  </tr>`).join('');

  const auditoria = acoes.length ? `<section class="panel">
    <h2>Auditoria recente</h2>
    <ul class="auditoria">
      ${acoes.map((a) => `<li>
        <strong>${escapeHtml(a.acao)}</strong>
        <span>${escapeHtml(a.dados?.arena || a.entidadeId || '')} · ${escapeHtml(a.admin)}</span>
        <small>${escapeHtml(diasAtras(a.quando))}</small>
      </li>`).join('')}
    </ul>
  </section>` : '';

  return `<div class="admin-toolbar">
    <span class="admin-toolbar__label">Período</span>
    ${segmento('periodo', PERIODOS, filtros.periodo)}
  </div>

  <div class="kpi-grid">
    ${kpi('Receita da plataforma', formatCurrency(d.receitaPlataforma), `taxa de ${Math.round(TAXA_PLATAFORMA * 100)}% sobre o subtotal`, true)}
    ${kpi('Volume transacionado', formatCurrency(d.volume), `${d.reservas} reservas`)}
    ${kpi('Jogos marcados', d.jogosMarcados, 'peladas nascidas de reservas')}
    ${kpi('Planos mensalistas', d.planosMensalistas, 'receita recorrente')}
  </div>

  <div class="kpi-grid">
    ${kpi('Cadastrados', d.cadastrados, `${d.jogadores} jogadores · ${d.donos} donos de quadra`)}
    ${kpi('Ativos', d.ativos, `usaram nos últimos ${corte} dias`)}
    ${kpi(`Inativos há +${corte} dias`, d.inativos, d.inativos ? 'candidatos a notificação' : 'ninguém sumido')}
    ${kpi('Arenas ativas', d.arenasAtivas, `de ${d.arenasTotal} cadastradas`)}
  </div>

  <div class="kpi-grid">
    ${kpi('RPU', formatCurrency(d.rpu), `receita ÷ ${compradores} ${compradores === 1 ? 'pessoa que reservou' : 'pessoas que reservaram'}`, true)}
    ${kpi('Ticket médio', formatCurrency(d.ticketMedio), 'por reserva')}
    ${kpi('Reservas no período', d.reservas, 'com data real')}
    ${kpi('Volume no período', formatCurrency(d.volume), 'transacionado')}
  </div>

  <div class="admin-toolbar">
    <span class="admin-toolbar__label">Sem usar há</span>
    ${segmento('inatividade', FAIXAS_INATIVIDADE, filtros.inatividade)}
  </div>

  ${fila.length ? `<section class="panel">
    <h2>Fila de reativação</h2>
    <p class="muted" style="margin-bottom:14px">Quem não abre o app há mais de ${corte} dias. É esta lista que alimenta o disparo de notificação.</p>
    <table class="tbl">
      <thead><tr><th>Pessoa</th><th>Papel</th><th>Cidade</th><th>Sem usar</th><th>Cadastro</th></tr></thead>
      <tbody>${filaLinhas}</tbody>
    </table>
  </section>` : ''}

  <section class="panel">
    <h2>Últimas reservas</h2>
    <table class="tbl">
      <thead><tr><th>Código</th><th>Pessoa</th><th>Arena</th><th>Quando</th><th>Valor</th><th>Plataforma</th></tr></thead>
      <tbody>${resLinhas}</tbody>
    </table>
  </section>

  ${auditoria}`;
}

async function viewArenasApi() {
  const data = await adminService.arenas();
  const arenas = data.arenas || [];
  return `<section class="panel">
    <h2>Arenas na plataforma <span class="muted">· ${data.total}</span></h2>
    <table class="tbl">
      <thead><tr><th>Arena</th><th>Esporte</th><th>Avulso</th><th>Mensalista</th><th>Reservas</th><th>Status</th><th></th></tr></thead>
      <tbody>
        ${arenas.map((v) => `<tr>
          <td><strong>${escapeHtml(v.nome)}</strong><br><small>${escapeHtml(v.bairro)} · ${escapeHtml(v.cidade)}</small></td>
          <td>${escapeHtml(v.esporte)}</td>
          <td class="num">${formatCurrency(v.avulso)}</td>
          <td class="num">${formatCurrency(v.mensalista)}</td>
          <td class="num">${v.reservas}</td>
          <td><span class="tag tag--${v.ativa ? 'pago' : 'pendente'}">${v.ativa ? 'Ativa' : 'Pausada'}</span></td>
          <td><div class="admin-actions">
            ${v.ativa
              ? `<button type="button" class="admin-action--pause" data-admin-arena-action="pause" data-id="${escapeHtml(v.id)}">Pausar</button>`
              : `<button type="button" class="admin-action--reactivate" data-admin-arena-action="reactivate" data-id="${escapeHtml(v.id)}">Reativar</button>`}
          </div></td>
        </tr>`).join('')}
      </tbody>
    </table>
  </section>`;
}

async function viewReservasApi() {
  const data = await adminService.reservas();
  const planos = data.planos || [];
  return `<div class="kpi-grid">
    ${kpi('Mensalistas', data.mensalistas, 'cobrança recorrente')}
    ${kpi('Avulsas', data.avulsas, 'cobrança única')}
    ${kpi('Sessões agendadas', data.sessoesAgendadas, 'peladas nascidas de reservas')}
  </div>

  <section class="panel">
    <h2>Planos mensalistas</h2>
    ${planos.length ? `<table class="tbl">
      <thead><tr><th>Reserva</th><th>Arena</th><th>Compromisso</th><th>Sessões</th></tr></thead>
      <tbody>
        ${planos.map((p) => `<tr>
          <td class="mono">${escapeHtml(p.code)}</td>
          <td>${escapeHtml(p.arena)}</td>
          <td>${escapeHtml(p.compromisso)}</td>
          <td class="num">${p.sessoes}</td>
        </tr>`).join('')}
      </tbody>
    </table>` : '<p class="muted">Nenhum plano mensalista ainda. Eles aparecem aqui assim que alguém assinar.</p>'}
  </section>`;
}

async function viewClubesApi() {
  const data = await adminService.clubes();
  const lista = data.clubes || [];
  return `<section class="panel">
    <h2>Clubes</h2>
    ${lista.length ? `<div class="club-grid">
      ${lista.map((club) => `<article class="club-tile">
        <span class="club-tile__mark">${escapeHtml(club.nome.charAt(0))}</span>
        <strong>${escapeHtml(club.nome)}</strong>
        <small>${escapeHtml(club.esporte)} · ${escapeHtml(club.cidade)}</small>
        <div class="club-tile__nums">
          <span><b>${club.membros}</b> membros</span>
          <span><b>${club.peladas}</b> peladas</span>
        </div>
      </article>`).join('')}
    </div>` : '<p class="muted">Nenhum clube criado ainda.</p>'}
  </section>`;
}

async function viewPessoasApi() {
  const data = await adminService.pessoas({
    q: filtros.busca,
    cidade: filtros.cidade,
    estado: filtros.estado,
    periodo: filtros.periodo,
    inatividade: filtros.inatividade
  });
  const pessoas = data.pessoas || [];

  return `<div class="admin-toolbar admin-toolbar--wrap">
    <input type="search" class="admin-input" placeholder="Buscar pessoa"
           data-admin-search value="${escapeHtml(filtros.busca)}">
    <select class="admin-select" data-admin-filter="cidade">
      <option value="">Todas as cidades</option>
      ${(data.cidades || []).map((c) => `<option${c === filtros.cidade ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('')}
    </select>
    <select class="admin-select" data-admin-filter="estado">
      <option value="">Todos os estados</option>
      ${(data.estados || []).map((e) => `<option${e === filtros.estado ? ' selected' : ''}>${escapeHtml(e)}</option>`).join('')}
    </select>
    ${segmento('periodo', PERIODOS, filtros.periodo)}
  </div>

  <section class="panel">
    <h2>Todo mundo na plataforma <span class="muted">· ${data.total}</span></h2>
    ${pessoas.length ? `<table class="tbl">
      <thead><tr><th>Pessoa</th><th>Papel</th><th>Cidade</th><th>Gastou</th><th>Cadastro</th><th>Última atividade</th><th>Situação</th></tr></thead>
      <tbody>
        ${pessoas.map((u) => `<tr>
          <td><strong>${escapeHtml(u.nome)}</strong></td>
          <td>${escapeHtml(u.papel)}</td>
          <td>${escapeHtml(u.cidade)}${u.estado ? ` · ${escapeHtml(u.estado)}` : ''}</td>
          <td class="num strong">${u.gastou ? formatCurrency(u.gastou) : '—'}</td>
          <td class="num">${diasAtras(u.cadastro)}</td>
          <td class="num">${diasAtras(u.ultimaAtividade)}</td>
          <td><span class="tag tag--${u.ativo ? 'pago' : 'pendente'}">${u.ativo ? 'Ativo' : 'Inativo'}</span></td>
        </tr>`).join('')}
      </tbody>
    </table>` : '<p class="muted">Ninguém com esses filtros.</p>'}
  </section>`;
}

/* ══════════ SOLICITACOES DE ARENA ═══════════════════════════════════════

   A fila que decide quem entra no Qadras. Cada ficha traz o que dá para
   CONFERIR sem sair da tela: CNPJ com situacao e CNAE, endereco, quantas
   quadras, e a dor declarada.

   O CNAE e o sinal mais barato de que aquilo e mesmo uma quadra — 9311-5/00 e
   "gestao de instalacoes esportivas". Ele aparece destacado quando bate, mas
   NAO decide sozinho: quadra registrada no CNPJ do restaurante da familia e
   comum demais para virar recusa automatica. Quem decide e quem le. */

function cnpjBonito(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length !== 14) return v || '—';
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

const DORES_ROTULO = {
  horarios_vagos: 'Horários vagos',
  sem_previsao: 'Não sabe quem vem',
  calote: 'Calote / desmarque',
  caderno: 'Controle no caderno',
  divulgacao: 'Pouca divulgação',
  cobranca: 'Perde tempo cobrando'
};

async function viewSolicitacoes() {
  const data = await adminService.solicitacoes();
  const fila = data.solicitacoes || [];
  atualizarContadorFila(fila.length);

  if (!fila.length) {
    return `<section class="panel">
      <h2>Solicitações</h2>
      <p class="muted">Nenhuma solicitação esperando. Quando uma arena se cadastrar, ela aparece aqui.</p>
    </section>`;
  }

  return `<section class="panel">
    <h2>Esperando análise <span class="muted">· ${fila.length}</span></h2>
    ${fila.map((s) => `
      <article class="sol">
        <header class="sol__topo">
          <div>
            <strong>${escapeHtml(s.arenaNome || 'Sem nome')}</strong>
            <small>${escapeHtml(s.bairro || '')}${s.bairro && s.cidade ? ' · ' : ''}${escapeHtml(s.cidade || '')}${s.estado ? '/' + escapeHtml(s.estado) : ''}</small>
          </div>
          <span class="tag tag--pendente">${escapeHtml(s.status)}</span>
        </header>

        <dl class="sol__grade">
          <div><dt>CNPJ</dt><dd>${escapeHtml(cnpjBonito(s.cnpj))}</dd></div>
          <div><dt>Razão social</dt><dd>${escapeHtml(s.razaoSocial || '—')}</dd></div>
          <div><dt>Situação</dt><dd>${escapeHtml(s.cnpjSituacao || '—')}</dd></div>
          <div class="sol__cnae ${/9311/.test(s.cnpjCnae || '') ? 'is-bom' : ''}">
            <dt>Atividade (CNAE)</dt><dd>${escapeHtml(s.cnpjCnae || 'não consultada')}</dd>
          </div>
          <div><dt>Endereço</dt><dd>${escapeHtml([s.endereco, s.numero].filter(Boolean).join(', ') || '—')}<br><small>CEP ${escapeHtml(s.cep || '—')}</small></dd></div>
          <div><dt>Contato</dt><dd>${escapeHtml(s.contatoNome || '—')}<br><small>${escapeHtml(s.contatoTelefone || '')} · ${escapeHtml(s.contatoEmail || '')}</small></dd></div>
          <div><dt>Quadras</dt><dd>${s.quantasQuadras ?? '—'}${(s.esportes || []).length ? ' · ' + escapeHtml((s.esportes || []).join(', ')) : ''}</dd></div>
          <div><dt>Faturamento</dt><dd>${escapeHtml(s.faturamento || 'não informado')}</dd></div>
        </dl>

        ${(s.dores || []).length ? `<p class="sol__dores">${(s.dores || [])
          .map((d) => `<span>${escapeHtml(DORES_ROTULO[d] || d)}</span>`).join('')}</p>` : ''}

        ${(s.fotos || []).length ? `<div class="sol__fotos">${(s.fotos || [])
          .map((src) => `<img src="${escapeHtml(src)}" alt="" loading="lazy">`).join('')}</div>`
          : '<p class="muted sol__semfoto">Sem fotos enviadas.</p>'}

        <footer class="sol__acoes admin-actions">
          <button type="button" class="admin-action--reactivate" data-sol="aprovar" data-id="${escapeHtml(s.id)}">Aprovar</button>
          <button type="button" class="admin-action--pause" data-sol="recusar" data-id="${escapeHtml(s.id)}">Recusar…</button>
        </footer>
      </article>`).join('')}
  </section>`;
}

/* O numero de pendentes no MENU. Carregado no boot e refeito a cada acao —
   sem ele a fila so e vista por quem lembra de clicar. */
async function atualizarContadorFila(quantos) {
  const alvo = document.querySelector('[data-fila-num]');
  if (!alvo) return;
  if (quantos === undefined) {
    if (!viaApi) return;
    try {
      quantos = ((await adminService.solicitacoes()).solicitacoes || []).length;
    } catch { return; }
  }
  alvo.textContent = String(quantos);
  alvo.hidden = !quantos;
}

const VIEWS = {
  visao: () => (viaApi ? viewVisaoApi() : viewVisaoMock()),
  arenas: () => (viaApi ? viewArenasApi() : viewArenasMock()),
  reservas: () => (viaApi ? viewReservasApi() : viewReservasMock()),
  clubes: () => (viaApi ? viewClubesApi() : viewClubesMock()),
  pessoas: () => (viaApi ? viewPessoasApi() : viewPessoasMock()),
  /* Sem versao mock: solicitacao so existe com backend. Com o mock ligado, a
     tela diz isso em vez de fingir uma fila vazia — que se leria como "ninguem
     se cadastrou ainda". */
  solicitacoes: () => (viaApi
    ? viewSolicitacoes()
    : '<section class="panel"><h2>Solicitações</h2><p class="muted">Esta tela precisa do backend conectado.</p></section>')
};

/* Token de render: dois renders em sequencia (ex.: digitar e clicar num
   filtro) nao deixam a resposta mais antiga sobrescrever a mais nova. */
let renderToken = 0;

async function render() {
  const token = ++renderToken;
  const pedido = location.hash.replace('#', '') || 'visao';
  const chave = VIEWS[pedido] ? pedido : 'visao';
  const [titulo, sub] = TITLES[chave];

  document.querySelector('[data-admin-title]').textContent = titulo;
  document.querySelector('[data-admin-sub]').textContent = sub;
  const viewEl = document.querySelector('[data-admin-view]');
  viewEl.innerHTML = viaApi ? '<p class="muted">Carregando…</p>' : '';
  document.querySelectorAll('[data-admin-nav]').forEach((link) => {
    link.classList.toggle('on', link.dataset.adminNav === chave);
  });
  window.lucide?.createIcons?.({ icons: window.lucide.icons });

  try {
    const html = await VIEWS[chave]();
    if (token !== renderToken) return;
    viewEl.innerHTML = html;
    window.lucide?.createIcons?.({ icons: window.lucide.icons });
  } catch (error) {
    if (token !== renderToken) return;
    viewEl.innerHTML = `<p class="muted">Erro ao carregar: ${escapeHtml(error.message)}</p>`;
  }
}

/* Delegacao no document porque cada render substitui o innerHTML inteiro:
   um listener preso ao elemento morreria no primeiro clique. */
document.addEventListener('click', (event) => {
  const botao = event.target.closest('button[data-admin-filter][data-valor]');
  if (botao) {
    filtros[botao.dataset.adminFilter] = botao.dataset.valor;
    render();
    return;
  }

  const arena = event.target.closest('button[data-admin-arena-action]');
  if (arena) {
    const acao = arena.dataset.adminArenaAction;
    const motivo = prompt(acao === 'pause' ? 'Motivo da pausa (opcional)' : 'Motivo da reativação (opcional)');
    if (motivo === null) return;
    arena.setAttribute('disabled', 'disabled');
    (acao === 'pause'
      ? adminService.pausarArena(arena.dataset.id, motivo || 'Pausa administrativa')
      : adminService.reativarArena(arena.dataset.id, motivo)
    )
      .then(() => render())
      .catch((error) => {
        alert(error.message || 'Não foi possível concluir a ação');
        render();
      });
    return;
  }

  const sol = event.target.closest('button[data-sol]');
  if (sol) {
    const acao = sol.dataset.sol;
    let motivo = '';
    if (acao === 'recusar') {
      /* Motivo OBRIGATORIO na recusa — o backend tambem cobra, mas pedir aqui
         evita a viagem so para levar um 422. O texto vai inteiro para o dono
         da quadra: recusa sem motivo vira uma ligacao que ninguem sabe
         responder. */
      motivo = prompt('Por que esta solicitação não passou? O dono da quadra vai ler exatamente este texto.') || '';
      if (!motivo.trim()) return;
    } else if (!confirm('Aprovar? A arena passa a existir e o dono recebe acesso ao painel.')) {
      return;
    }
    sol.setAttribute('disabled', 'disabled');
    (acao === 'aprovar'
      ? adminService.aprovarSolicitacao(sol.dataset.id)
      : adminService.recusarSolicitacao(sol.dataset.id, motivo)
    )
      .then(() => { atualizarContadorFila(); render(); })
      .catch((error) => {
        alert(error.message || 'Não foi possível concluir');
        render();
      });
    return;
  }

  const logout = event.target.closest('[data-auth-logout]');
  if (logout) {
    logout.setAttribute('disabled', 'disabled');
    authService.logout()
      .catch(() => {})
      .finally(() => location.assign('./login.html'));
  }
});

document.addEventListener('change', (event) => {
  const campo = event.target.closest('select[data-admin-filter]');
  if (!campo) return;
  filtros[campo.dataset.adminFilter] = campo.value;
  render();
});

/* Busca com debounce no modo API (cada tecla batia no backend). O render
   recria o input, entao foco e cursor voltam depois que a resposta chega. */
let buscaDebounce = null;
document.addEventListener('input', (event) => {
  const campo = event.target.closest('[data-admin-search]');
  if (!campo) return;
  filtros.busca = campo.value;
  clearTimeout(buscaDebounce);
  buscaDebounce = setTimeout(async () => {
    await render();
    const novo = document.querySelector('[data-admin-search]');
    if (novo) {
      novo.focus();
      novo.setSelectionRange(novo.value.length, novo.value.length);
    }
  }, viaApi ? 250 : 0);
});

window.addEventListener('hashchange', render);
window.addEventListener('load', render);

/* Modo API: painel exige sessao de admin e avisa na lateral de onde vem o
   dado. Token expirado (pq:auth-expired) volta para o login. */
if (viaApi) {
  const usuario = authService.currentUser();
  if (!authService.hasSession() || usuario?.role !== 'admin') {
    storage.clearSession();
    location.replace('./login.html');
  } else {
    const rotulo = document.querySelector('[data-admin-badge-label]');
    if (rotulo) rotulo.textContent = 'API · Qadras';
    const icone = document.querySelector('[data-admin-badge] .ic');
    if (icone) icone.setAttribute('data-lucide', 'cloud');
    window.lucide?.createIcons?.({ icons: window.lucide.icons });
    const fonte = document.querySelector('[data-admin-source]');
    if (fonte) fonte.textContent = 'Dados vivos do backend.';
    const sair = document.querySelector('[data-auth-logout]');
    if (sair) sair.hidden = false;
  }
  window.addEventListener('pq:auth-expired', () => location.replace('./login.html'));
}

render();
/* O contador da fila e carregado FORA do render: ele precisa aparecer mesmo
   quando a tela aberta e outra — a graca do numero no menu e justamente
   avisar quem nao estava olhando para la. */
atualizarContadorFila();
