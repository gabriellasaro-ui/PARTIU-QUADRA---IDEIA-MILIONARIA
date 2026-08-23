/* Financeiro da arena — receitas, taxa e conciliação.

   O que estava no lugar: R$ 4.820 escrito na mao, um grafico SVG com o path
   fixo, e uma tabela de "movimentacoes" com Matheus Rocha, Bruno Lima e
   Carol Souza — tres clientes que nao existem em nenhum outro lugar do
   sistema. Nenhum numero conversava com as reservas da arena.

   Aqui tudo vem de /api/gerente/financeiro. Comissao nao aparece: por decisao do
   dono, o gerente ve faturamento, nao repasse.
   O app antigo tinha ainda o seletor de periodo, o card de proximo repasse,
   a rosca de destino da receita e as duas tabelas exportaveis. Voltaram. */
import { formatCurrency } from '../../utils/formatters.js';
import { API_BASE_URL } from '../../config/constants.js';
import managerService from '../../services/manager-api.js';

const DIAS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

let periodo = '7d';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

const set = (root, sel, valor) => {
  const el = root.querySelector(sel);
  if (el) el.textContent = valor;
};

function reservasDoPeriodo() {
  /* Sem API nao ha faturamento. Devolver reservas de exemplo faria a tela
     mostrar dinheiro que nao entrou — e financeiro e a ultima tela onde se
     pode inventar numero. */
  return [];
}

/* O GRAFICO RECEBE PONTOS ({rotulo, valor}), e nao um vetor de sete numeros
   indexado por dia da semana.

   Ele montava a serie no proprio front, somando as 100 ultimas reservas por
   `getDay()` — sem filtrar status e sem filtrar periodo. Resultado: a soma dos
   pontos dava R$ 2.928 no mesmo cartao onde "Faturamento bruto" dizia
   R$ 695,52. Dois numeros contraditorios lado a lado, e o grafico e o que o
   dono olha primeiro.

   O backend ja devolve `serie` — um ponto por dia do intervalo, com os dias
   zerados presentes, calculado sobre o MESMO recorte que gerou o bruto. Usar
   outra fonte para o desenho era garantir a divergencia.

   BARRAS, e nao linha: com dois dias de movimento numa semana, a linha ligava
   os pontos e desenhava dois triangulos gigantes subindo do zero. Linha promete
   continuidade, e faturamento diario nao e continuo — cada dia e um valor
   independente. Foi o mesmo conserto ja feito no grafico do dashboard. */
function renderChart(root, pontos) {
  const svg = root.querySelector('[data-finance-chart]');
  if (!svg) return;
  const W = 620;
  const H = 240;
  const x0 = 52;
  const x1 = W - 18;
  const y0 = 26;
  const y1 = H - 34;

  // A linha e a area do desenho antigo saem de cena; as barras as substituem.
  svg.querySelector('[data-finance-line]')?.setAttribute('d', '');
  svg.querySelector('[data-finance-area]')?.setAttribute('d', '');
  svg.querySelectorAll('.lc-grid, .lc-yl, .lc-dot, .lc-xl, .lc-val, .lc-bar, .lc-trilho').forEach((n) => n.remove());

  if (!pontos.length) return;
  const max = Math.max(...pontos.map((p) => p.valor), 0);
  const teto = max > 0 ? max * 1.25 : 100;

  const grade = [0, 0.5, 1].map((p) => {
    const y = y1 - p * (y1 - y0);
    return `<line class="lc-grid" x1="${x0}" y1="${y}" x2="${x1}" y2="${y}"/>
            <text class="lc-yl" x="${x0 - 9}" y="${y + 3}">${Math.round(p * teto)}</text>`;
  }).join('');

  const passo = (x1 - x0) / pontos.length;
  const larg = Math.min(46, passo * 0.62);
  const pico = pontos.reduce((m, p, i) => (p.valor > pontos[m].valor ? i : m), 0);

  const barras = pontos.map((p, i) => {
    const cx = x0 + passo * i + passo / 2;
    const alt = teto > 0 ? (p.valor / teto) * (y1 - y0) : 0;
    /* Dia zerado ganha um trilho fino em vez de nada: sem ele o eixo fica com
       buracos e nao da para contar os dias. */
    const barra = p.valor > 0
      ? `<rect class="lc-bar${i === pico ? ' peak' : ''}" x="${(cx - larg / 2).toFixed(1)}" y="${(y1 - alt).toFixed(1)}" width="${larg.toFixed(1)}" height="${Math.max(2, alt).toFixed(1)}" rx="4"/>`
      : `<rect class="lc-trilho" x="${(cx - larg / 2).toFixed(1)}" y="${(y1 - 3).toFixed(1)}" width="${larg.toFixed(1)}" height="3" rx="1.5"/>`;
    const valor = p.valor > 0
      ? `<text class="lc-val${i === pico ? ' peak' : ''}" x="${cx.toFixed(1)}" y="${(y1 - alt - 8).toFixed(1)}" style="text-anchor:middle">${formatCurrency(p.valor)}</text>`
      : '';
    return `${barra}${valor}
      <text class="lc-xl" x="${cx.toFixed(1)}" y="${H - 9}" style="text-anchor:middle">${escapeHtml(p.rotulo)}</text>`;
  }).join('');

  svg.insertAdjacentHTML('beforeend', grade + barras);
}

export async function renderManagerFinance(root) {
  /* Guard no grafico, nao no card de repasse: aquele elemento saiu junto com
     a comissao, e um guard apontando para no inexistente derrubaria a tela
     inteira sem erro nenhum no console. */
  if (!root.querySelector('[data-finance-chart]')) return;

  const periodoApi = periodo === 'hoje' ? 'today' : periodo;
  const dados = API_BASE_URL ? await managerService.financeiro(periodoApi) : null;
  // Pagina grande de proposito: aqui as reservas alimentam totalizadores, e
  // nao uma lista navegavel — paginar isso daria um total parcial.
  const reservas = API_BASE_URL
    ? (await managerService.reservas({ porPagina: 100 })).reservas
    : reservasDoPeriodo();
  const bruto = API_BASE_URL ? dados.bruto : reservas.reduce((t, r) => t + Number(r.valor || 0), 0);
  const ticket = API_BASE_URL ? dados.ticket_medio : (reservas.length ? Math.round(bruto / reservas.length) : 0);

  set(root, '[data-finance-gross]', formatCurrency(bruto));
  set(root, '[data-finance-count]', API_BASE_URL ? dados.reservas : reservas.length);
  set(root, '[data-finance-ticket]', formatCurrency(ticket));
  set(root, '[data-finance-ticket-top]', formatCurrency(ticket));

  /* OCUPACAO: do servidor, e nao de uma formula.

     Era `min(99, round(reservas / 21 * 100) + 40)` — um "+40" escolhido a mao
     para o numero parecer bom. Com 22 reservas na lista, dava 99%; o dashboard,
     que usa a ocupacao REAL do backend, mostrava 1% na mesma hora. O dono via
     dois numeros com o mesmo nome e valores opostos em duas telas do mesmo
     painel, e nenhum dos dois lhe dizia o que fazer.

     Mesma fonte do dashboard: uma so definicao de ocupacao no produto. */
  const ocupacao = API_BASE_URL ? (await managerService.dashboard()).ocupacao : 0;
  set(root, '[data-finance-occ]', `${ocupacao}%`);
  set(root, '[data-finance-occ-top]', `${ocupacao}%`);

  /* A SERIE do backend, calculada sobre o mesmo recorte que gerou o bruto.
     O calculo que existia aqui somava as 100 ultimas reservas por dia da
     semana, ignorando periodo e status — por isso o grafico contradizia o
     cartao de faturamento logo acima dele. */
  const serie = API_BASE_URL ? (dados.serie || []) : [];
  set(root, '[data-finance-peak]', formatCurrency(Math.max(0, ...serie.map((p) => p.valor))));
  renderChart(root, serie);

  const ledger = root.querySelector('[data-finance-ledger]');
  if (ledger) {
    /* FATURADA quer dizer faturada.

       A tabela listava TODAS as reservas do periodo, recusadas inclusive —
       vinte linhas "Recusada" debaixo do titulo "RECEITAS · Reservas
       faturadas". Reserva recusada nao entrou dinheiro nenhum, e some dos
       totalizadores logo acima, entao a tabela contradizia o proprio cabecalho
       da tela.

       Ela continua em Reservas, com o status, que e onde se pergunta "o que
       aconteceu com aquele pedido". */
    const FATURADAS = new Set(['pago', 'confirmado', 'concluido']);
    const faturadas = reservas.filter((r) => FATURADAS.has(String(r.cls || '').toLowerCase()));
    ledger.innerHTML = faturadas.length ? faturadas.map((r) => {
      return `<tr>
        <td data-label="Cliente"><strong>${escapeHtml(r.cliente)}</strong></td>
        <td data-label="Data">${escapeHtml(r.data)} · <span class="num">${escapeHtml(r.hora)}</span></td>
        <td data-label="Bruto" class="val num">${formatCurrency(r.valor)}</td>
        <td data-label="Status"><span class="status ${escapeHtml(r.cls || 'pendente')}">${escapeHtml(r.status)}</span></td>
      </tr>`;
    }).join('')
      : '<tr><td colspan="4" class="lista-vazia">Nenhuma reserva faturada neste período.</td></tr>';
  }


  root.querySelectorAll('[data-finance-period]').forEach((b) => {
    b.classList.toggle('on', b.dataset.financePeriod === periodo);
  });

  window.pqRefreshIcons?.(root);
}

export function initManagerFinance() {
  document.addEventListener('click', (event) => {
    const botao = event.target.closest('[data-finance-period]');
    if (!botao) return;
    periodo = botao.dataset.financePeriod;
    renderManagerFinance(document.querySelector('[data-desktop-route-view]'));
  });
}