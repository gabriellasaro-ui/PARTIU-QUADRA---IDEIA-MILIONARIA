/* Painel do dono da plataforma.

   A diferenca para o painel do gerente e o ponto de vista: o gerente ve a
   arena DELE e decide operacao; aqui se ve a plataforma inteira e o que ela
   ganha. Por isso o numero que abre a tela nao e o faturamento das quadras,
   e sim a taxa de servico — o dinheiro que de fato entra no negocio.

   Le o mesmo armazenamento do app (chaves pq:*) e a mesma semente. Sem
   backend, isso significa que cada navegador enxerga o proprio dado; o
   painel diz isso na lateral em vez de fingir ser producao. */
import { VENUES, CLUBS, PELADAS, INITIAL_RESERVATIONS } from '../../config/mock-data.js';
import { SERVICE_FEE_RATE } from '../../config/constants.js';
import storage from '../../storage/storage.js';
import { formatCurrency } from '../../utils/formatters.js';

const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

const TITLES = {
  visao: ['Visão geral', 'A plataforma inteira num lugar só'],
  arenas: ['Arenas', 'Quem oferece quadra na plataforma'],
  reservas: ['Reservas', 'Todo volume que passou pelo app'],
  clubes: ['Clubes', 'Os grupos que organizam pelada recorrente']
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

function kpi(label, valor, nota, destaque) {
  return `<article class="kpi${destaque ? ' kpi--strong' : ''}">
    <small>${escapeHtml(label)}</small>
    <strong>${valor}</strong>
    ${nota ? `<em>${escapeHtml(nota)}</em>` : ''}
  </article>`;
}

function viewVisao() {
  const res = reservations();
  const lista = venues();
  const gmv = res.reduce((total, r) => total + Number(r.price || 0), 0);
  const receita = Math.round(corteDaPlataforma(gmv) * 100) / 100;
  const ativas = lista.filter((v) => v.active !== false).length;

  return `<div class="kpi-grid">
    ${kpi('Receita da plataforma', formatCurrency(receita), `taxa de ${Math.round(SERVICE_FEE_RATE * 100)}% sobre as reservas`, true)}
    ${kpi('Volume transacionado', formatCurrency(gmv), `${res.length} reservas`)}
    ${kpi('Arenas ativas', ativas, `de ${lista.length} cadastradas`)}
    ${kpi('Planos mensalistas', planos().size, 'receita recorrente')}
  </div>

  <section class="panel">
    <h2>Últimas reservas</h2>
    <table class="tbl">
      <thead><tr><th>Código</th><th>Arena</th><th>Quando</th><th>Valor</th><th>Plataforma</th><th>Status</th></tr></thead>
      <tbody>
        ${res.slice(0, 8).map((r) => {
          const venue = lista.find((v) => v.id === r.venueId);
          return `<tr>
            <td class="mono">${escapeHtml(r.code)}</td>
            <td>${escapeHtml(venue?.name || '-')}</td>
            <td>${escapeHtml(r.date)} · ${escapeHtml(r.hour)}</td>
            <td class="num">${formatCurrency(r.price)}</td>
            <td class="num strong">${formatCurrency(corteDaPlataforma(r.price))}</td>
            <td><span class="tag tag--${escapeHtml(r.statusClass)}">${escapeHtml(r.status)}</span></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </section>`;
}

function viewArenas() {
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

function viewReservas() {
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

function viewClubes() {
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

const VIEWS = { visao: viewVisao, arenas: viewArenas, reservas: viewReservas, clubes: viewClubes };

function render() {
  const pedido = location.hash.replace('#', '') || 'visao';
  const chave = VIEWS[pedido] ? pedido : 'visao';
  const [titulo, sub] = TITLES[chave];

  document.querySelector('[data-admin-title]').textContent = titulo;
  document.querySelector('[data-admin-sub]').textContent = sub;
  document.querySelector('[data-admin-view]').innerHTML = VIEWS[chave]();
  document.querySelectorAll('[data-admin-nav]').forEach((link) => {
    link.classList.toggle('on', link.dataset.adminNav === chave);
  });
  window.lucide?.createIcons?.({ icons: window.lucide.icons });
}

window.addEventListener('hashchange', render);
window.addEventListener('load', render);
render();
