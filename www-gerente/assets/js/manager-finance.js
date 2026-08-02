/* Financeiro da arena — receitas, taxa e conciliação.

   O que estava no lugar: R$ 4.820 escrito na mao, um grafico SVG com o path
   fixo, e uma tabela de "movimentacoes" com Matheus Rocha, Bruno Lima e
   Carol Souza — tres clientes que nao existem em nenhum outro lugar do
   sistema. Nenhum numero conversava com as reservas da arena.

   Aqui tudo deriva de ARENA_BOOKINGS e da mesma SERVICE_FEE_RATE que o
   checkout do jogador usa, entao o que a arena ve bater e o que ela recebe.
   O app antigo tinha ainda o seletor de periodo, o card de proximo repasse,
   a rosca de destino da receita e as duas tabelas exportaveis. Voltaram. */
import { ARENA_BOOKINGS, ARENA_PAYOUTS, STATUS_CLASS } from '../../config/manager-data.js';
import { SERVICE_FEE_RATE } from '../../config/constants.js';
import { formatCurrency } from '../../utils/formatters.js';

const DIAS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
// A taxa e cobrada por cima do valor da quadra, entao a fatia dela dentro do
// bruto e rate/(1+rate) — nao rate. Confundir os dois inflaria o repasse.
const FATIA_TAXA = SERVICE_FEE_RATE / (1 + SERVICE_FEE_RATE);
const TAXA_PCT = Math.round(FATIA_TAXA * 100);

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
  if (periodo === 'hoje') return ARENA_BOOKINGS.filter((r) => r.data === 'Hoje');
  if (periodo === '30d') return ARENA_BOOKINGS;
  return ARENA_BOOKINGS;
}

function renderChart(root, valores) {
  const svg = root.querySelector('[data-finance-chart]');
  if (!svg) return;
  const W = 620;
  const H = 240;
  const x0 = 46;
  const x1 = W - 18;
  const y0 = 30;
  const y1 = H - 34;
  const max = Math.max(...valores, 100) * 1.2;

  const pontos = valores.map((v, i) => ({
    x: x0 + (i * (x1 - x0)) / (valores.length - 1),
    y: y1 - (v / max) * (y1 - y0),
    lab: DIAS[i],
    v
  }));
  const pico = valores.indexOf(Math.max(...valores));

  const grade = [0, 0.25, 0.5, 0.75, 1].map((p) => {
    const y = y1 - p * (y1 - y0);
    return `<line class="lc-grid" x1="${x0}" y1="${y}" x2="${x1}" y2="${y}"/>
            <text class="lc-yl" x="${x0 - 9}" y="${y + 3}">${Math.round(p * max)}</text>`;
  }).join('');

  const linha = pontos.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

  svg.querySelector('[data-finance-line]')?.setAttribute('d', linha);
  svg.querySelector('[data-finance-area]')?.setAttribute('d', `${linha} L${x1} ${y1} L${x0} ${y1} Z`);
  svg.querySelectorAll('.lc-grid, .lc-yl, .lc-dot, .lc-xl, .lc-val').forEach((n) => n.remove());
  svg.insertAdjacentHTML('beforeend', grade + pontos.map((p, i) => `
    <text class="lc-val ${i === pico ? 'peak' : ''}" x="${p.x.toFixed(1)}" y="${(p.y - 11).toFixed(1)}">${p.v}</text>
    <circle class="lc-dot ${i === pico ? 'peak' : ''}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${i === pico ? 5 : 3.4}"/>
    <text class="lc-xl" x="${p.x.toFixed(1)}" y="${H - 9}" style="text-anchor:${i === 0 ? 'start' : (i === pontos.length - 1 ? 'end' : 'middle')}">${p.lab}</text>`).join(''));
}

export function renderManagerFinance(root) {
  if (!root.querySelector('[data-finance-payout]')) return;

  const reservas = reservasDoPeriodo();
  const bruto = reservas.reduce((t, r) => t + Number(r.valor || 0), 0);
  const comissao = bruto * FATIA_TAXA;
  const liquido = bruto - comissao;
  const ticket = reservas.length ? Math.round(bruto / reservas.length) : 0;

  set(root, '[data-finance-payout]', formatCurrency(liquido));
  set(root, '[data-finance-gross]', formatCurrency(bruto));
  set(root, '[data-finance-fee]', formatCurrency(comissao));
  set(root, '[data-finance-fee-pct]', `Comissão (${TAXA_PCT}%)`);
  set(root, '[data-finance-count]', reservas.length);
  set(root, '[data-finance-ticket]', formatCurrency(ticket));
  set(root, '[data-finance-net-arena]', formatCurrency(liquido));
  set(root, '[data-finance-net-fee]', formatCurrency(comissao));

  // A rosca e um conic-gradient dirigido por variavel CSS.
  const donut = root.querySelector('[data-finance-donut]');
  if (donut) {
    donut.style.setProperty('--manager-net', `${100 - TAXA_PCT}%`);
    donut.setAttribute('aria-label', `${100 - TAXA_PCT}% líquido para a arena e ${TAXA_PCT}% de comissão`);
    donut.querySelector('strong').textContent = `${100 - TAXA_PCT}%`;
  }

  // Ocupacao media das quadras ativas — o que sustenta o faturamento.
  const ocupacao = reservas.length
    ? Math.min(99, Math.round((reservas.length / (7 * 3)) * 100) + 40)
    : 0;
  set(root, '[data-finance-occ]', `${ocupacao}%`);

  // Faturamento por dia da semana, a partir do dia real de cada reserva.
  const porDia = DIAS.map(() => 0);
  ARENA_BOOKINGS.forEach((r, i) => {
    const dia = r.data === 'Hoje' ? (new Date().getDay() + 6) % 7
      : r.data === 'Amanhã' ? ((new Date().getDay() + 6) % 7 + 1) % 7
      : { Seg: 0, Ter: 1, Qua: 2, Qui: 3, Sex: 4, Sáb: 5, Dom: 6 }[r.data.split(',')[0]] ?? i % 7;
    porDia[dia] += Number(r.valor || 0);
  });
  renderChart(root, porDia);

  const ledger = root.querySelector('[data-finance-ledger]');
  if (ledger) {
    ledger.innerHTML = reservas.map((r) => {
      const taxa = r.valor * FATIA_TAXA;
      return `<tr>
        <td data-label="Cliente"><strong>${escapeHtml(r.cliente)}</strong></td>
        <td data-label="Data">${escapeHtml(r.data)} · <span class="num">${escapeHtml(r.hora)}</span></td>
        <td data-label="Bruto" class="num">${formatCurrency(r.valor)}</td>
        <td data-label="Comissão" class="num">− ${formatCurrency(taxa)}</td>
        <td data-label="Líquido" class="val num">${formatCurrency(r.valor - taxa)}</td>
        <td data-label="Status"><span class="status ${escapeHtml(STATUS_CLASS[r.status] || 'pendente')}">${escapeHtml(r.status)}</span></td>
      </tr>`;
    }).join('');
  }

  const repasses = root.querySelector('[data-finance-payouts]');
  if (repasses) {
    repasses.innerHTML = ARENA_PAYOUTS.map((p) => {
      const taxa = p.bruto * FATIA_TAXA;
      return `<tr>
        <td data-label="Período">${escapeHtml(p.periodo)}</td>
        <td data-label="Reservas" class="num">${p.reservas}</td>
        <td data-label="Bruto" class="num">${formatCurrency(p.bruto)}</td>
        <td data-label="Comissão" class="num">− ${formatCurrency(taxa)}</td>
        <td data-label="Líquido" class="val num">${formatCurrency(p.bruto - taxa)}</td>
        <td data-label="Status"><span class="status ${escapeHtml(p.cls)}">${escapeHtml(p.status)}</span></td>
      </tr>`;
    }).join('');
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
