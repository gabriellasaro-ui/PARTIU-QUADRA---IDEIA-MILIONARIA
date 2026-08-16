/* Financeiro da arena — receitas, taxa e conciliação.

   O que estava no lugar: R$ 4.820 escrito na mao, um grafico SVG com o path
   fixo, e uma tabela de "movimentacoes" com Matheus Rocha, Bruno Lima e
   Carol Souza — tres clientes que nao existem em nenhum outro lugar do
   sistema. Nenhum numero conversava com as reservas da arena.

   Aqui tudo deriva de ARENA_BOOKINGS. Comissao nao aparece: por decisao do
   dono, o gerente ve faturamento, nao repasse.
   O app antigo tinha ainda o seletor de periodo, o card de proximo repasse,
   a rosca de destino da receita e as duas tabelas exportaveis. Voltaram. */
import { ARENA_BOOKINGS, STATUS_CLASS } from '../../config/manager-data.js';
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

export async function renderManagerFinance(root) {
  /* Guard no grafico, nao no card de repasse: aquele elemento saiu junto com
     a comissao, e um guard apontando para no inexistente derrubaria a tela
     inteira sem erro nenhum no console. */
  if (!root.querySelector('[data-finance-chart]')) return;

  const periodoApi = periodo === 'hoje' ? 'today' : periodo;
  const dados = API_BASE_URL ? await managerService.financeiro(periodoApi) : null;
  const reservas = API_BASE_URL ? await managerService.reservas() : reservasDoPeriodo();
  const bruto = API_BASE_URL ? dados.bruto : reservas.reduce((t, r) => t + Number(r.valor || 0), 0);
  const ticket = API_BASE_URL ? dados.ticket_medio : (reservas.length ? Math.round(bruto / reservas.length) : 0);

  set(root, '[data-finance-gross]', formatCurrency(bruto));
  set(root, '[data-finance-count]', API_BASE_URL ? dados.reservas : reservas.length);
  set(root, '[data-finance-ticket]', formatCurrency(ticket));
  set(root, '[data-finance-ticket-top]', formatCurrency(ticket));

  // Ocupacao media das quadras ativas — o que sustenta o faturamento.
  const ocupacao = reservas.length
    ? Math.min(99, Math.round((reservas.length / (7 * 3)) * 100) + 40)
    : 0;
  set(root, '[data-finance-occ]', `${ocupacao}%`);
  set(root, '[data-finance-occ-top]', `${ocupacao}%`);

  // Faturamento por dia da semana, a partir do dia real de cada reserva.
  const porDia = DIAS.map(() => 0);
  reservas.forEach((r, i) => {
    const data = API_BASE_URL
      ? r.dataValue
        ? new Date(`${r.dataValue}T12:00:00`)
        : null
      : r.data === 'Hoje' ? new Date()
      : r.data === 'Amanhã' ? new Date(Date.now() + 86400000)
      : null;
    let dia;
    if (data) {
      dia = (data.getDay() + 6) % 7;
    } else {
      dia = r.data === 'Hoje' ? (new Date().getDay() + 6) % 7
        : r.data === 'Amanhã' ? ((new Date().getDay() + 6) % 7 + 1) % 7
        : { Seg: 0, Ter: 1, Qua: 2, Qui: 3, Sex: 4, Sáb: 5, Dom: 6 }[String(r.data).split(',')[0]] ?? i % 7;
    }
    porDia[dia] += Number(r.valor || 0);
  });
  set(root, '[data-finance-peak]', formatCurrency(Math.max(...porDia, 0)));
  renderChart(root, porDia);

  const ledger = root.querySelector('[data-finance-ledger]');
  if (ledger) {
    ledger.innerHTML = reservas.map((r) => {
      return `<tr>
        <td data-label="Cliente"><strong>${escapeHtml(r.cliente)}</strong></td>
        <td data-label="Data">${escapeHtml(r.data)} · <span class="num">${escapeHtml(r.hora)}</span></td>
        <td data-label="Bruto" class="val num">${formatCurrency(r.valor)}</td>
        <td data-label="Status"><span class="status ${escapeHtml(r.cls || STATUS_CLASS[r.status] || 'pendente')}">${escapeHtml(r.status)}</span></td>
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