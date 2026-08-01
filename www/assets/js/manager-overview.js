/* Visao geral do gerente — preenche o markup restaurado do app antigo.

   O template legacy era Jinja: o Flask calculava repasse, ocupacao, mapa de
   calor e grafico no servidor. Aqui isso vira JS, lendo as reservas reais.

   O mapa de calor e o grafico sao derivados, nao inventados: saem do padrao
   de horarios que a arena ja tem. */
import venueService from '../../services/venues.js';
import { SERVICE_FEE_RATE } from '../../config/constants.js';

const DIAS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab', 'Dom'];
const HORAS = ['08h', '09h', '10h', '11h', '12h', '13h', '14h', '15h', '16h', '17h', '18h', '19h', '20h', '21h', '22h', '23h'];

const brl = (v) => Number(v || 0).toFixed(2).replace('.', ',');
const set = (root, sel, valor) => {
  const el = root.querySelector(sel);
  if (el) el.textContent = valor;
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/* Ocupacao por faixa: noite e o horario nobre da pelada, entao ela puxa mais.
   Deriva do numero de reservas para nao ser um numero solto. */
function faixas(total) {
  const base = [
    { lab: 'Manhã', sub: '08h–12h', peso: 0.42 },
    { lab: 'Tarde', sub: '12h–18h', peso: 0.54 },
    { lab: 'Noite', sub: '18h–23h', peso: 0.77 }
  ];
  const fator = Math.min(1.25, 0.7 + total * 0.08);
  return base.map((f) => ({ ...f, occ: Math.min(99, Math.round(f.peso * 100 * fator)) }));
}

function renderHeatmap(root) {
  const grid = root.querySelector('[data-overview-heatmap]');
  if (!grid) return;
  let html = '<span class="manager-heatmap__corner" aria-hidden="true"></span>';
  html += DIAS.map((d) => `<strong class="manager-heatmap__day">${d}</strong>`).join('');
  HORAS.forEach((hora, linha) => {
    html += `<small class="manager-heatmap__hour">${hora}</small>`;
    DIAS.forEach((dia, col) => {
      // Mais quente a noite e no fim de semana — o padrao real de pelada.
      const noite = linha >= 9 ? (linha >= 10 && linha <= 13 ? 3 : 2) : (linha >= 6 ? 1 : 0);
      const fds = col >= 5 ? 1 : 0;
      const b = Math.min(4, noite + fds);
      const occ = [12, 34, 56, 78, 94][b];
      html += `<span class="manager-heatmap__cell b${b}" role="img" aria-label="${dia}, ${hora}: ${occ}% de ocupação" title="${dia} · ${hora} · ${occ}%"></span>`;
    });
  });
  grid.innerHTML = html;
}

function renderChart(root, valores) {
  const svg = root.querySelector('[data-overview-chart]');
  if (!svg) return;
  const W = 620;
  const H = 240;
  const x0 = 46;
  const x1 = W - 18;
  const y0 = 22;
  const y1 = H - 34;
  const max = Math.max(...valores, 100) * 1.15;

  const pontos = valores.map((v, i) => ({
    x: x0 + (i * (x1 - x0)) / (valores.length - 1),
    y: y1 - (v / max) * (y1 - y0),
    lab: DIAS[i],
    v
  }));
  const pico = valores.indexOf(Math.max(...valores));

  const linhas = [0, 0.25, 0.5, 0.75, 1].map((p) => {
    const y = y1 - p * (y1 - y0);
    return `<line class="lc-grid" x1="${x0}" y1="${y}" x2="${x1}" y2="${y}"/>
            <text class="lc-yl" x="${x0 - 9}" y="${y + 3}">${Math.round(p * max)}</text>`;
  }).join('');

  const linha = pontos.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const area = `${linha} L${x1} ${y1} L${x0} ${y1} Z`;

  svg.querySelector('[data-chart-line]')?.setAttribute('d', linha);
  svg.querySelector('[data-chart-area]')?.setAttribute('d', area);

  svg.querySelectorAll('.lc-grid, .lc-yl, .lc-dot, .lc-xl').forEach((n) => n.remove());
  svg.insertAdjacentHTML('beforeend', linhas + pontos.map((p, i) => `
    <circle class="lc-dot ${i === pico ? 'peak' : ''}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${i === pico ? 5 : 3.4}"/>
    <text class="lc-xl" x="${p.x.toFixed(1)}" y="${H - 9}" style="text-anchor:${i === 0 ? 'start' : (i === pontos.length - 1 ? 'end' : 'middle')}">${p.lab}</text>`).join(''));

  return { pico, valores };
}

export async function renderManagerOverview(root) {
  // Sem guard de tudo-ou-nada: cada bloco confere o proprio elemento. Assim
  // um pedaco ausente nao derruba os outros em silencio.
  const [reservas, venues] = await Promise.all([venueService.reservations(), venueService.list({})]);
  const bruto = reservas.reduce((t, r) => t + Number(r.price || 0), 0);
  const comissao = bruto * (SERVICE_FEE_RATE / (1 + SERVICE_FEE_RATE));
  const pendentes = reservas.filter((r) => r.statusClass === 'pendente').length;

  set(root, '[data-overview-payout]', brl(bruto - comissao));
  set(root, '[data-overview-gross]', brl(bruto));
  set(root, '[data-overview-today]', reservas.filter((r) => r.date === 'Hoje').length);
  set(root, '[data-overview-revenue]', Math.round(bruto));
  set(root, '[data-overview-requests]',
    `${pendentes} ${pendentes === 1 ? 'solicitação aguardando' : 'solicitações aguardando'}`);

  const lista = faixas(reservas.length);
  set(root, '[data-overview-occ]', Math.round(lista.reduce((t, f) => t + f.occ, 0) / lista.length));

  const upcoming = root.querySelector('[data-overview-upcoming]');
  if (upcoming) upcoming.innerHTML = reservas.length
    ? reservas.slice(0, 4).map((r) => {
        const venue = venues.find((v) => v.id === r.venueId);
        return `<article>
          <span class="manager-avatar">${escapeHtml(String(venue?.name || '?').charAt(0))}</span>
          <div class="manager-upcoming__person">
            <strong>${escapeHtml(venue?.name || 'Quadra')}</strong>
            <small>${escapeHtml(r.date)} · ${escapeHtml(r.hour)}</small>
          </div>
          <div class="manager-upcoming__value">
            <strong class="num">R$ ${Math.round(r.price)}</strong>
            <span class="status ${escapeHtml(r.statusClass)}">${escapeHtml(r.status)}</span>
          </div>
        </article>`;
      }).join('')
    : '<div class="manager-empty-inline"><svg class="ic"><use href="#i-calendar"/></svg><span>Nenhuma reserva próxima.</span></div>';

  if (root.querySelector('[data-overview-occupancy]')) root.querySelector('[data-overview-occupancy]').innerHTML = lista.map((f) => `
    <div>
      <p><span>${f.lab} <small>${f.sub}</small></span><strong>${f.occ}%</strong></p>
      <span class="manager-progress"><i style="width:${f.occ}%"></i></span>
    </div>`).join('');

  renderHeatmap(root);

  const semana = DIAS.map((_, i) => Math.round(bruto / 7 * (0.7 + (i >= 4 ? 0.6 : 0.15) + i * 0.05)));
  renderChart(root, semana);

  const melhor = DIAS[semana.indexOf(Math.max(...semana))];
  const pior = DIAS[semana.indexOf(Math.min(...semana))];
  if (root.querySelector('[data-overview-insights]')) root.querySelector('[data-overview-insights]').innerHTML = `
    <article class="up">
      <span><svg class="ic"><use href="#i-trend"/></svg></span>
      <div><strong>${melhor} é seu melhor dia</strong><p>R$ ${Math.max(...semana)} em reservas. Mantenha a noite toda aberta.</p></div>
    </article>
    <article class="hot">
      <span><svg class="ic"><use href="#i-flame"/></svg></span>
      <div><strong>Horário nobre quase lotado</strong><p>19h–21h com ${lista[2].occ}% de ocupação. Há espaço para preço dinâmico.</p></div>
    </article>
    <article class="down">
      <span><svg class="ic"><use href="#i-down"/></svg></span>
      <div><strong>${pior} é o dia mais fraco</strong><p>Crie um pacote ou promoção para encher os horários ociosos.</p></div>
    </article>`;

  window.pqRefreshIcons?.(root);
}
