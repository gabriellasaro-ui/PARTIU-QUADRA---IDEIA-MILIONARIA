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
function faixas(ritmo) {
  /* AS TRES FAIXAS saem do mapa de calor REAL.

     Eram pesos escritos a mao (0.42 manha, 0.54 tarde, 0.77 noite) vezes um
     fator que crescia com o total: um desenho da forma que se ESPERA ver, e
     nao do que a arena tem. Uma arena vazia mostrava "noite 66%", e o dono
     concluiria que a noite dele enche.

     Agora e a proporcao de reservas + procura de cada faixa sobre o total da
     semana. Sem movimento nenhum, todas em 0% — que e a resposta certa. */
  const faixas = [
    { lab: 'Manhã', sub: '08h–12h', de: 8, ate: 12 },
    { lab: 'Tarde', sub: '12h–18h', de: 12, ate: 18 },
    { lab: 'Noite', sub: '18h–23h', de: 18, ate: 24 }
  ];
  if (!ritmo) return faixas.map((f) => ({ ...f, occ: 0 }));

  const somar = (de, ate) => {
    let t = 0;
    for (let d = 0; d < 7; d += 1) {
      for (let h = de; h < ate; h += 1) {
        t += (ritmo.reservas[d]?.[h] || 0) + (ritmo.procura[d]?.[h] || 0);
      }
    }
    return t;
  };
  const totais = faixas.map((f) => somar(f.de, f.ate));
  const geral = totais.reduce((a, b) => a + b, 0);
  return faixas.map((f, i) => ({
    ...f,
    occ: geral ? Math.round((totais[i] / geral) * 100) : 0
  }));
}

/* MAPA DE CALOR — do /api/gerente/ritmo, e nao de um padrao escrito a mao.

   A versao anterior desenhava `linha >= 9 ? 3 : 2` com um comentario dizendo
   "o padrao real de pelada": uma figura inventada, com a forma que se espera
   ver, apresentada como medicao. Uma arena com cinco reservas via o mesmo
   degrade de uma arena lotada — e o dono concluiria que a noite dele enche.

   Duas camadas, e elas nao sao a mesma coisa: RESERVA e o que aconteceu;
   PROCURA e quem escolheu aquele horario e nao reservou. A segunda e a unica
   que sugere acao (abrir horario, rever preco), e sem ela um quadrado vazio e
   ambiguo — ninguem quer, ou ninguem conseguiu? */
async function renderHeatmap(root, dados) {
  const grid = root.querySelector('[data-overview-heatmap]');
  if (!grid) return;

  if (!dados) {
    // Sem dado nao ha mapa. Desenhar a grade cinza e honesto; desenhar um
    // degrade bonito seria repetir o problema.
    grid.innerHTML = '<p class="manager-heatmap__vazio">Sem dados de procura ainda.</p>';
    return;
  }

  // A escala e RELATIVA ao maior valor da propria arena: 4 reservas numa
  // quinta podem ser o pico de uma quadra e ruido de outra. Escala fixa
  // pintaria toda arena pequena de frio.
  const pico = Math.max(
    1,
    ...dados.reservas.flat(),
    ...dados.procura.flat()
  );
  const faixa = (v) => (v <= 0 ? 0 : Math.min(4, Math.ceil((v / pico) * 4)));

  const DIAS_MAPA = dados.dias;
  let html = '<span class="manager-heatmap__corner" aria-hidden="true"></span>';
  html += DIAS_MAPA.map((d) => `<strong class="manager-heatmap__day">${d}</strong>`).join('');

  for (let h = 8; h <= 23; h += 1) {
    html += `<small class="manager-heatmap__hour">${String(h).padStart(2, '0')}h</small>`;
    DIAS_MAPA.forEach((dia, col) => {
      const res = dados.reservas[col]?.[h] || 0;
      const pro = dados.procura[col]?.[h] || 0;
      const b = faixa(res + pro);
      const titulo = `${dia} · ${String(h).padStart(2, '0')}h · ${res} ${res === 1 ? 'reserva' : 'reservas'}`
        + (pro ? ` · ${pro} ${pro === 1 ? 'procura' : 'procuras'} sem reservar` : '');
      html += `<span class="manager-heatmap__cell b${b}" role="img" aria-label="${titulo}" title="${titulo}"></span>`;
    });
  }
  grid.innerHTML = html;
}

/* O grafico recebe PONTOS ({rotulo, valor}), e nao so numeros.

   Antes ele assumia que o indice 0 era segunda e usava DIAS[i] como rotulo. A
   serie real comeca no primeiro dia do intervalo escolhido — que pode ser uma
   quinta — e o eixo passaria a mentir sobre qual dia e qual. */
/* BARRAS, e nao linha.

   A linha ligava os pontos: numa semana com faturamento em UM dia e zero nos
   outros seis, isso desenhava um TRIANGULO gigante subindo de zero a 150 e
   voltando. A linha sugere continuidade — "veio subindo, vai descendo" — e
   faturamento diario nao e continuo: cada dia e um valor independente.

   Barra nao promete transicao entre os dias. Com dado esparso ela mostra
   exatamente o que ha: um dia com movimento e seis vazios, sem inventar a
   rampa entre eles.

   Dia zerado ganha um trilho fino em vez de nada: sem ele, o eixo fica com
   buracos e nao da para contar os dias. */
/* DINHEIRO COM CENTAVOS, sempre.

   O painel mostrava "R$ 696" para R$ 695,52 porque usava Math.round(). Meio
   real perdido num numero nao muda decisao nenhuma — mas o dono confere o
   caixa dele por esta tela, e um valor que nao bate com o extrato faz ele
   parar de confiar no painel inteiro. Centavo e o que separa "o sistema
   mostra" de "o sistema sabe". */
function dinheiro(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function renderChart(root, pontosSerie) {
  const svg = root.querySelector('[data-overview-chart]');
  if (!svg) return;

  const W = 620;
  const H = 240;
  const x0 = 52;
  const x1 = W - 14;
  const y0 = 20;
  const y1 = H - 34;

  svg.innerHTML = '';
  if (!pontosSerie.length) {
    svg.insertAdjacentHTML('beforeend',
      `<text class="lc-vazio" x="${W / 2}" y="${H / 2}" text-anchor="middle">Sem faturamento no período</text>`);
    return;
  }

  const valores = pontosSerie.map((p) => Number(p.valor) || 0);
  const maior = Math.max(...valores);
  // Teto arredondado para cima, para o rotulo do topo ser um numero redondo.
  const max = maior > 0 ? Math.ceil(maior * 1.2 / 10) * 10 : 100;

  const vao = (x1 - x0) / pontosSerie.length;
  const largura = Math.min(46, vao * 0.56);

  // Grade: quatro linhas, com o valor em reais na esquerda.
  const grade = [0, 0.5, 1].map((f) => {
    const y = y1 - f * (y1 - y0);
    return `<line class="lc-grid" x1="${x0}" y1="${y}" x2="${x1}" y2="${y}"/>
            <!-- O EIXO fica redondo de proposito: e escala de leitura, e nao
                 valor a conferir. Centavo no eixo so polui. -->
            <text class="lc-yl" x="${x0 - 10}" y="${y + 3.5}">${Math.round(f * max)}</text>`;
  }).join('');

  const barras = pontosSerie.map((p, i) => {
    const v = Number(p.valor) || 0;
    const cx = x0 + vao * i + vao / 2;
    const alt = v > 0 ? Math.max(3, (v / max) * (y1 - y0)) : 0;
    const y = y1 - alt;
    const destaque = v > 0 && v === maior;
    const trilho = `<rect class="lc-trilho" x="${cx - largura / 2}" y="${y0}" width="${largura}" height="${y1 - y0}" rx="4"/>`;
    const barra = v > 0
      ? `<rect class="lc-bar${destaque ? ' peak' : ''}" x="${cx - largura / 2}" y="${y}" width="${largura}" height="${alt}" rx="4">
           <title>${p.rotulo}: R$ ${v.toFixed(2).replace('.', ',')}</title>
         </rect>`
      : '';
    // O valor so aparece no dia de maior movimento: em sete rotulos, o numero
    // vira ruido e ninguem le nenhum.
    const rotuloValor = destaque
      ? `<text class="lc-val" x="${cx}" y="${y - 7}" text-anchor="middle">R$ ${v.toFixed(2).replace('.', ',')}</text>`
      : '';
    return `${trilho}${barra}${rotuloValor}
      <text class="lc-xl" x="${cx}" y="${H - 10}" text-anchor="middle">${p.rotulo}</text>`;
  }).join('');

  svg.insertAdjacentHTML('beforeend', grade + barras);
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
    ocupacao = 0;  // sem API nao ha ocupacao a calcular
    proximas = reservas;
  }

  set(root, '[data-overview-gross]', dinheiro(bruto));
  set(root, '[data-overview-period-reservations]', total);
  set(root, '[data-overview-period-requests]', pendentes);

  set(root, '[data-overview-today]', deHoje);
  // O rotulo diz "hoje", entao tem que ser hoje. Estava mostrando o bruto do
  // periodo inteiro debaixo de um rotulo diario.
  set(root, '[data-overview-revenue]', dinheiro(receitaHoje));
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
            <strong class="num">R$ ${dinheiro(r.valor)}</strong>
            <span class="status ${escapeHtml(cls)}">${escapeHtml(status)}</span>
          </div>
        </article>`;
      }).join('')
    : '<div class="manager-empty-inline"><svg class="ic"><use href="#i-calendar"/></svg><span>Nenhuma reserva próxima.</span></div>';

  /* O ritmo e buscado UMA vez e serve aos dois blocos: as tres faixas e o
     mapa de calor. Duas chamadas para o mesmo dado dobrariam o trafego e
     poderiam mostrar numeros diferentes na mesma tela. */
  let ritmo = null;
  if (API_BASE_URL) {
    try { ritmo = await managerService.ritmo(); } catch (error) { ritmo = null; }
  }

  const lista = faixas(ritmo);
  if (root.querySelector('[data-overview-occupancy]')) root.querySelector('[data-overview-occupancy]').innerHTML = lista.map((f) => `
    <div>
      <p><span>${f.lab} <small>${f.sub}</small></span><strong>${f.occ}%</strong></p>
      <span class="manager-progress"><i style="width:${f.occ}%"></i></span>
    </div>`).join('');

  await renderHeatmap(root, ritmo);

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
