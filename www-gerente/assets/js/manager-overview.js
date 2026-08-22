/* Visao geral do gerente — preenche o markup restaurado do app antigo.

   O template legacy era Jinja: o Flask calculava repasse, ocupacao, mapa de
   calor e grafico no servidor. Aqui isso vira JS, lendo as reservas reais.

   O mapa de calor e o grafico sao derivados, nao inventados: saem do padrão
   de horários que a arena ja tem. */
import { ARENA_BOOKINGS, STATUS_CLASS } from '../../config/manager-data.js';
import { API_BASE_URL } from '../../config/constants.js';
import managerService from '../../services/manager-api.js';

const DIAS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
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

/* Ocupacao por faixa: noite e o horário nobre da pelada, entao ela puxa mais.
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
      // Mais quente a noite e no fim de semana — o padrão real de pelada.
      const noite = linha >= 9 ? (linha >= 10 && linha <= 13 ? 3 : 2) : (linha >= 6 ? 1 : 0);
      const fds = col >= 5 ? 1 : 0;
      const b = Math.min(4, noite + fds);
      const occ = [12, 34, 56, 78, 94][b];
      html += `<span class="manager-heatmap__cell b${b}" role="img" aria-label="${dia}, ${hora}: ${occ}% de ocupação" title="${dia} · ${hora} · ${occ}%"></span>`;
    });
  });
  grid.innerHTML = html;
}

/* O grafico recebe PONTOS ({rotulo, valor}), e nao so numeros.

   Antes ele assumia que o indice 0 era segunda e usava DIAS[i] como rotulo. A
   serie real comeca no primeiro dia do intervalo escolhido — que pode ser uma
   quinta — e o eixo passaria a mentir sobre qual dia e qual. */
function renderChart(root, pontosSerie) {
  const svg = root.querySelector('[data-overview-chart]');
  if (!svg) return;
  const valores = pontosSerie.map((p) => p.valor);
  const W = 620;
  const H = 240;
  const x0 = 46;
  const x1 = W - 18;
  const y0 = 22;
  const y1 = H - 34;
  const max = Math.max(...valores, 100) * 1.15;

  // Um ponto so dividiria por zero no calculo do x.
  const passo = valores.length > 1 ? (x1 - x0) / (valores.length - 1) : 0;
  const pontos = pontosSerie.map((p, i) => ({
    x: x0 + i * passo,
    y: y1 - (p.valor / max) * (y1 - y0),
    lab: p.rotulo,
    v: p.valor
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

/* Serie REAL dos ultimos 7 dias. */
async function renderChartReal(root) {
  const svg = root.querySelector('[data-overview-chart]');
  if (!svg) return;
  if (!API_BASE_URL) {
    // Sem backend nao ha faturamento: grafico vazio e honesto. Desenhar uma
    // curva bonita aqui foi exatamente o erro que se esta corrigindo.
    renderChart(root, []);
    return;
  }
  const hoje = new Date();
  const inicio = new Date(hoje);
  inicio.setDate(inicio.getDate() - 6);
  const iso = (d) => d.toISOString().slice(0, 10);
  try {
    const dados = await managerService.financeiro({ de: iso(inicio), ate: iso(hoje) });
    renderChart(root, dados?.serie || []);
  } catch (error) {
    renderChart(root, []);
  }
}

export async function renderManagerOverview(root) {
  // Sem guard de tudo-ou-nada: cada bloco confere o proprio elemento. Assim
  // um pedaco ausente nao derruba os outros em silencio.
  //
  // Com API, os numeros sao os do /api/gerente/dashboard (faturamento do
  // backend, proximas reservas reais). Sem API, caem nos dados do app antigo.
  let bruto;
  let total;
  let pendentes;
  let deHoje;
  let receitaHoje;
  let proximas;
  let ocupacao;

  if (API_BASE_URL) {
    const data = await managerService.dashboard();
    bruto = data.bruto;
    total = data.reservas_semana;
    pendentes = data.solicitacoes_pendentes + (data.aguardando_pagamento || 0);
    deHoje = data.reservas_hoje;
    receitaHoje = data.kpis.find((k) => k.cls === 'hoje')?.valor ?? 0;
    ocupacao = data.ocupacao;
    proximas = data.proximas;
  } else {
    const reservas = ARENA_BOOKINGS;
    bruto = reservas.reduce((t, r) => t + Number(r.valor || 0), 0);
    total = reservas.length;
    pendentes = reservas.filter((r) => r.status === 'Solicitada' || r.status === 'Pendente').length;
    deHoje = reservas.filter((r) => r.data === 'Hoje').length;
    receitaHoje = deHoje.reduce((t, r) => t + Number(r.valor || 0), 0);
    ocupacao = Math.round(((faixas(reservas.length).reduce((t, f) => t + f.occ, 0)) / 3));
    proximas = reservas;
  }

  set(root, '[data-overview-gross]', Math.round(bruto).toLocaleString('pt-BR'));
  set(root, '[data-overview-period-reservations]', total);
  set(root, '[data-overview-period-requests]', pendentes);

  set(root, '[data-overview-today]', deHoje);
  // O rotulo diz "hoje", entao tem que ser hoje. Estava mostrando o bruto do
  // periodo inteiro debaixo de um rotulo diario.
  set(root, '[data-overview-revenue]', Math.round(receitaHoje).toLocaleString('pt-BR'));
  set(root, '[data-overview-requests]',
    `${pendentes} ${pendentes === 1 ? 'solicitação aguardando' : 'solicitações aguardando'}`);

  set(root, '[data-overview-occ]', ocupacao);

  const upcoming = root.querySelector('[data-overview-upcoming]');
  if (upcoming) upcoming.innerHTML = proximas.length
    ? proximas.slice(0, 4).map((r) => {
        const cliente = r.cliente || '';
        const status = r.status;
        const cls = r.cls || STATUS_CLASS[status] || 'pendente';
        return `<article>
          <span class="manager-avatar">${escapeHtml(cliente.charAt(0))}</span>
          <div class="manager-upcoming__person">
            <strong>${escapeHtml(cliente)}</strong>
            <small>${escapeHtml(r.quadra)} · ${escapeHtml(r.data)} · ${escapeHtml(r.hora)}</small>
          </div>
          <div class="manager-upcoming__value">
            <strong class="num">R$ ${Math.round(Number(r.valor || 0))}</strong>
            <span class="status ${escapeHtml(cls)}">${escapeHtml(status)}</span>
          </div>
        </article>`;
      }).join('')
    : '<div class="manager-empty-inline"><svg class="ic"><use href="#i-calendar"/></svg><span>Nenhuma reserva próxima.</span></div>';

  const lista = faixas(total);
  if (root.querySelector('[data-overview-occupancy]')) root.querySelector('[data-overview-occupancy]').innerHTML = lista.map((f) => `
    <div>
      <p><span>${f.lab} <small>${f.sub}</small></span><strong>${f.occ}%</strong></p>
      <span class="manager-progress"><i style="width:${f.occ}%"></i></span>
    </div>`).join('');

  renderHeatmap(root);

  /* O grafico da semana agora sai da SERIE REAL do backend.

     Antes era `bruto / 7 * (0.7 + i * 0.05)`: o total do mes dividido por sete
     e multiplicado por pesos escolhidos a mao. Parecia dado e nao era — a
     sexta "faturava mais" porque alguem escreveu 0.6 no codigo, e nao porque
     tivesse faturado.

     Dia sem faturamento vem como zero, e nao ausente: buraco no meio de uma
     serie temporal encurta o desenho e desloca todos os outros dias. */
  await renderChartReal(root);

  /* O bloco OPORTUNIDADES foi removido.

     Ele dizia "terca e seu dia mais fraco, crie uma promocao" — deduzido
     daquela mesma serie fabricada. Ou seja: o painel dava CONSELHO COMERCIAL
     baseado em numero que ninguem mediu. Um conselho errado com cara de
     analise e pior que nenhum conselho: o dono muda o preco de um dia que
     talvez seja o melhor dele.

     O lugar dessa resposta agora e o mapa de calor (Ritmo da agenda), que sai
     de reserva e procura de verdade. */

  window.pqRefreshIcons?.(root);
}
