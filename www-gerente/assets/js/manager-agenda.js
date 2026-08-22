/* Agenda da arena — a semana hora a hora.

   A versao refatorada tinha virado uma grade escrita na mao com quatro
   clientes inventados (Matheus Rocha, Bruno Lima, Carol Souza, Rafael
   Mendes) que nao existem em lugar nenhum do sistema, e sem nada do que o
   app antigo tinha: filtro por quadra, navegacao de semana, a lista por dia
   do mobile e o detalhe do agendamento.

   Aqui a grade sai das reservas reais da arena. O CSS de tudo isso ja
   estava em manager-app.css, so nao tinha markup para pintar. */
import { ARENA_BOOKINGS, STATUS_CLASS, bookingDate, bookingHours } from '../../config/manager-data.js';
import { courts } from './manager-courts.js';
import { formatCurrency } from '../../utils/formatters.js';
import { API_BASE_URL } from '../../config/constants.js';
import managerService from '../../services/manager-api.js';

const DIAS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const HORA_INICIAL = 8;
const HORA_FINAL = 23;
const ALTURA_HORA = 58;

// Estado da tela: semana visivel e quadra filtrada. Vive no modulo porque a
// pagina e remontada a cada render e nao pode esquecer onde a pessoa estava.
let offsetSemana = 0;
let quadraFiltro = 'todas';
let quadrasCarregadas = null;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

/* Segunda-feira da semana visivel. */
function segundaDaSemana() {
  const hoje = new Date();
  const d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offsetSemana * 7);
  return d;
}

function rotuloSemana(segunda) {
  const domingo = new Date(segunda);
  domingo.setDate(domingo.getDate() + 6);
  const dia = (d) => String(d.getDate()).padStart(2, '0');
  if (segunda.getMonth() === domingo.getMonth()) {
    return `${dia(segunda)} a ${dia(domingo)} de ${MESES[segunda.getMonth()]}`;
  }
  return `${dia(segunda)} de ${MESES[segunda.getMonth()]} a ${dia(domingo)} de ${MESES[domingo.getMonth()]}`;
}

function rotuloMes(segunda) {
  const quinta = new Date(segunda);
  quinta.setDate(quinta.getDate() + 3);
  return `${MESES[quinta.getMonth()]} ${quinta.getFullYear()}`;
}

function atualizarResumo(root, eventos, segunda) {
  const total = eventos.length;
  const pendentes = eventos.filter((e) => e.status === 'Solicitada' || e.status === 'Pendente').length;
  const receita = eventos.reduce((sum, e) => sum + Number(e.valor || 0), 0);

  const month = root.querySelector('[data-agenda-month]');
  const statTotal = root.querySelector('[data-agenda-stat-total]');
  const statPending = root.querySelector('[data-agenda-stat-pending]');
  const statRevenue = root.querySelector('[data-agenda-stat-revenue]');

  if (month) month.textContent = rotuloMes(segunda);
  if (statTotal) statTotal.textContent = String(total);
  if (statPending) statPending.textContent = String(pendentes);
  if (statRevenue) statRevenue.textContent = formatCurrency(receita);
}

/* Eventos posicionados por DATA, nao por indice de dia da semana. Cada
   reserva cai na coluna cuja data bate; o que fica fora da semana visivel
   simplesmente nao aparece, que e o que torna a navegacao de semana
   honesta. */
function eventosMock(segunda) {
  const dias = DIAS.map((_, i) => {
    const d = new Date(segunda);
    d.setDate(d.getDate() + i);
    return d.toDateString();
  });

  return ARENA_BOOKINGS
    .filter((b) => quadraFiltro === 'todas' || b.quadra === quadraFiltro)
    .map((b) => {
      const { inicio, fim } = bookingHours(b);
      return {
        ...b,
        dow: dias.indexOf(bookingDate(b).toDateString()),
        inicio,
        fim,
        cls: STATUS_CLASS[b.status] || 'pendente',
        duracao: `${fim - inicio}h`,
        horaCurta: b.hora.split(/\s*[–-]\s*/)[0]
      };
    })
    .filter((e) => e.dow >= 0);
}

/* Mesma coisa vinda do backend: /api/gerente/agenda ja devolve eventos
   ancorados em data real (dia YYYY-MM-DD, inicio/fim numericos). */
function eventosApi(quadras) {
  return quadras.map((e) => {
    const d = new Date(`${e.dia}T12:00:00`);
    const dow = (d.getDay() + 6) % 7;
    const inicio = Number(e.inicio);
    const fim = Number(e.fim);
    return {
      ...e,
      dow,
      inicio,
      fim,
      cls: e.cls || 'pendente',
      duracao: `${fim - inicio}h`,
      horaCurta: e.horaCurta || String(e.inicio),
      hora: e.hora || `${String(e.inicio)} – ${String(e.fim)}`
    };
  });
}

/* Expediente da semana: {quadraId: {dia: [[abre, fecha], ...]}}.

   Guardado no modulo porque a grade e desenhada em dois lugares (desktop e
   mobile) e refazer a chamada para cada um dobraria o trafego para o mesmo
   dado. */
let expedienteCarregado = {};
let colunasCarregadas = [];

async function eventosDaSemana(segunda) {
  if (API_BASE_URL) {
    const data = await managerService.agenda(segunda.toISOString().slice(0, 10));
    quadrasCarregadas = data.quadras;
    expedienteCarregado = data.expediente || {};
    colunasCarregadas = data.colunas || [];
    return eventosApi(data.eventos);
  }
  expedienteCarregado = {};
  colunasCarregadas = [];
  return eventosMock(segunda);
}

/* Faixas de funcionamento de UMA coluna (dia) da grade.

   Sem quadra escolhida, a grade mostra a arena inteira: uma hora conta como
   aberta se QUALQUER quadra abre nela. Fechar a coluna porque a quadra 2 nao
   abre esconderia a 1, que abre.

   Sem expediente conhecido (mock, ou backend antigo), devolve null — e a grade
   nao pinta nada, em vez de inventar que esta tudo aberto ou tudo fechado. */
function faixasDoDia(diaISO, quadraId) {
  const ids = Object.keys(expedienteCarregado);
  if (!ids.length) return null;
  const alvos = quadraId && expedienteCarregado[quadraId] ? [quadraId] : ids;
  const faixas = [];
  alvos.forEach((id) => {
    (expedienteCarregado[id]?.[diaISO] || []).forEach((f) => faixas.push(f));
  });
  return faixas;
}

function atributosEvento(e) {
  return `data-ev
    data-cli="${escapeHtml(e.cliente)}" data-tel="${escapeHtml(e.telefone)}"
    data-quadra="${escapeHtml(e.quadra)}" data-dia="${escapeHtml(e.data)}"
    data-hora="${escapeHtml(e.hora)}" data-dur="${escapeHtml(e.duracao)}"
    data-valor="${escapeHtml(formatCurrency(e.valor))}" data-codigo="${escapeHtml(e.codigo)}"
    data-status="${escapeHtml(e.status)}" data-cls="${escapeHtml(e.cls)}"`;
}

function renderDesktop(root, eventos, segunda) {
  const head = root.querySelector('[data-agenda-head]');
  const body = root.querySelector('[data-agenda-body]');
  if (!head || !body) return;

  const hoje = new Date();
  const ehHoje = (i) => {
    const d = new Date(segunda);
    d.setDate(d.getDate() + i);
    return d.toDateString() === hoje.toDateString();
  };
  const numero = (i) => {
    const d = new Date(segunda);
    d.setDate(d.getDate() + i);
    return String(d.getDate()).padStart(2, '0');
  };

  head.innerHTML = '<div class="ch-gut"></div>' + DIAS.map((dia, i) =>
    `<div class="ch-day${ehHoje(i) ? ' today' : ''}"><div class="d">${dia}</div><div class="n">${numero(i)}</div></div>`
  ).join('');

  const horas = [];
  for (let h = HORA_INICIAL; h <= HORA_FINAL; h += 1) horas.push(h);
  const altura = horas.length * ALTURA_HORA;

  body.style.setProperty('--hourh', `${ALTURA_HORA}px`);
  /* A quadra escolhida no filtro, quando ha uma. O filtro guarda o ROTULO
     (nome da quadra), e o expediente e indexado por id — a ponte e aqui. */
  const quadraAtual = quadraFiltro && quadraFiltro !== 'todas'
    ? (quadrasCarregadas.find((c) => c.label === quadraFiltro)?.id || null)
    : null;

  body.innerHTML = `<div class="cal-gutter">${
    horas.map((h) => `<div class="hr"><span>${String(h).padStart(2, '0')}:00</span></div>`).join('')
  }</div>` + DIAS.map((_, i) => {
    const doDia = eventos.filter((e) => e.dow === i);

    /* FECHADO DESENHADO, e nao deixado em branco.

       A grade so mostrava reservas: espaco vazio podia ser horario livre
       esperando cliente OU quadra fechada. As duas coisas pedem acoes opostas
       do dono — uma diz "baixe o preco", a outra diz "abra o dia" — e ele nao
       tinha como distinguir olhando.

       As faixas fechadas viram blocos hachurados por cima da coluna. Sem
       expediente conhecido nao desenha nada: inventar "tudo aberto" seria
       repetir o problema com outra cara. */
    const diaISO = colunasCarregadas[i]?.dia;
    const faixas = diaISO ? faixasDoDia(diaISO, quadraAtual) : null;
    let fechados = '';
    if (faixas) {
      if (!faixas.length) {
        fechados = `<div class="cal-closed" style="top:0;height:${altura}px"><span>Fechado</span></div>`;
      } else {
        const abre = Math.min(...faixas.map((f) => f[0]));
        const fecha = Math.max(...faixas.map((f) => f[1]));
        if (abre > HORA_INICIAL) {
          fechados += `<div class="cal-closed" style="top:0;height:${(abre - HORA_INICIAL) * ALTURA_HORA}px"></div>`;
        }
        if (fecha < HORA_FINAL + 1) {
          const topo = (fecha - HORA_INICIAL) * ALTURA_HORA;
          fechados += `<div class="cal-closed" style="top:${topo}px;height:${altura - topo}px"></div>`;
        }
      }
    }

    return `<div class="cal-col${ehHoje(i) ? ' today' : ''}" style="min-height:${altura}px">${fechados}${
      doDia.map((e) => {
        const top = (e.inicio - HORA_INICIAL) * ALTURA_HORA;
        const h = Math.max(34, (e.fim - e.inicio) * ALTURA_HORA - 4);
        return `<div class="cal-ev ${e.cls}" style="top:${top}px;height:${h}px" role="button" tabindex="0"
          title="${escapeHtml(e.cliente)} · ${escapeHtml(e.hora)}" ${atributosEvento(e)}>
          <div class="t">${escapeHtml(e.cliente)}</div>
          <div class="h">${escapeHtml(e.horaCurta)} <span>${escapeHtml(e.status)}</span></div>
        </div>`;
      }).join('')
    }</div>`;
  }).join('');
}

function renderMobile(root, eventos, segunda) {
  const wrap = root.querySelector('[data-agenda-mobile]');
  if (!wrap) return;

  const hoje = new Date();
  const diaDe = (i) => {
    const d = new Date(segunda);
    d.setDate(d.getDate() + i);
    return d;
  };
  const indiceHoje = DIAS.findIndex((_, i) => diaDe(i).toDateString() === hoje.toDateString());
  const ativo = indiceHoje >= 0 ? indiceHoje : 0;

  const abas = DIAS.map((dia, i) => {
    const total = eventos.filter((e) => e.dow === i).length;
    const on = i === ativo;
    return `<button class="${on ? 'on' : ''}" type="button" role="tab" id="agenda-tab-${i}"
      data-agenda-tab="${i}" aria-controls="agenda-panel-${i}" aria-selected="${on}">
      <small>${dia}</small><strong>${String(diaDe(i).getDate()).padStart(2, '0')}</strong><span>${total}</span>
    </button>`;
  }).join('');

  const paineis = DIAS.map((dia, i) => {
    const doDia = eventos.filter((e) => e.dow === i);
    const receitaDia = doDia.reduce((sum, e) => sum + Number(e.valor || 0), 0);
    return `<section class="manager-agenda-day-panel" id="agenda-panel-${i}" data-agenda-panel="${i}"
      role="tabpanel" aria-labelledby="agenda-tab-${i}" ${i === ativo ? '' : 'hidden'}>
      <header>
        <div><span>${dia}, dia ${String(diaDe(i).getDate()).padStart(2, '0')}</span><strong>Agenda do dia</strong></div>
        <span>${doDia.length} ${doDia.length === 1 ? 'reserva' : 'reservas'} - ${escapeHtml(formatCurrency(receitaDia))}</span>
      </header>
      <div class="manager-day-bookings">${
        doDia.length ? doDia.map((e) => `<button class="manager-day-booking ${e.cls}" type="button" ${atributosEvento(e)}>
            <span class="num">${escapeHtml(e.horaCurta)}</span>
            <div><strong>${escapeHtml(e.cliente)}</strong><small>${escapeHtml(e.quadra)} · ${escapeHtml(e.duracao)}</small></div>
            <span class="status ${e.cls}">${escapeHtml(e.status)}</span>
            <svg class="ic sm manager-day-booking__chevron"><use href="#i-right"/></svg>
          </button>`).join('')
        : '<div class="manager-agenda-empty"><span><svg class="ic"><use href="#i-clock"/></svg></span><strong>Dia livre</strong><small>Você ainda pode abrir horários para este dia.</small></div>'
      }</div>
    </section>`;
  }).join('');

  wrap.innerHTML = `<div class="manager-agenda-days" role="tablist" aria-label="Dias da semana">${abas}</div>${paineis}`;
}

export async function renderManagerAgenda(root) {
  if (!root.querySelector('[data-agenda-body]')) return;

  const segunda = segundaDaSemana();
  const eventos = await eventosDaSemana(segunda);

  const rotulo = root.querySelector('[data-agenda-range]');
  if (rotulo) rotulo.textContent = rotuloSemana(segunda);
  atualizarResumo(root, eventos, segunda);

  // O filtro sai das quadras da arena, nao de uma lista escrita a mao. Existe
  // uma unica barra responsiva para evitar estados duplicados na agenda.
  const opcoes = [{ label: 'todas', texto: 'Todas as quadras' },
    ...(API_BASE_URL ? quadrasCarregadas : courts()).map((c) => ({ label: c.label, texto: c.label }))];
  root.querySelectorAll('[data-agenda-courts]').forEach((filtro) => {
    filtro.innerHTML = opcoes
      .map((o) => `<button type="button" class="${o.label === quadraFiltro ? 'on' : ''}" data-agenda-court="${escapeHtml(o.label)}">${escapeHtml(o.texto)}</button>`)
      .join('');
  });

  renderDesktop(root, eventos, segunda);
  renderMobile(root, eventos, segunda);

  // A grade abre as 08h, mas a arena enche a noite. Sem isto o gerente
  // encontra o calendario vazio e precisa rolar para achar o movimento.
  const body = root.querySelector('[data-agenda-body]');
  const primeira = Math.min(...eventos.map((e) => e.inicio), HORA_FINAL);
  if (body && eventos.length) {
    body.scrollTop = Math.max(0, (primeira - HORA_INICIAL - 0.5) * ALTURA_HORA);
  }

  window.pqRefreshIcons?.(root);
}

function abrirDetalhe(root, el) {
  const modal = root.querySelector('[data-agenda-event-modal]');
  if (!modal) return;
  const put = (sel, attr) => {
    const alvo = modal.querySelector(sel);
    if (alvo) alvo.textContent = el.getAttribute(attr) || '—';
  };
  const cliente = el.getAttribute('data-cli') || '';
  modal.querySelector('[data-ev-ini]').textContent = cliente.charAt(0) || '?';
  put('[data-ev-cli]', 'data-cli');
  put('[data-ev-tel]', 'data-tel');
  put('[data-ev-quadra]', 'data-quadra');
  put('[data-ev-dia]', 'data-dia');
  put('[data-ev-hora]', 'data-hora');
  put('[data-ev-dur]', 'data-dur');
  put('[data-ev-valor]', 'data-valor');
  put('[data-ev-codigo]', 'data-codigo');
  const status = modal.querySelector('[data-ev-status]');
  if (status) {
    status.textContent = el.getAttribute('data-status');
    status.className = `status ${el.getAttribute('data-cls')}`;
  }
  modal.hidden = false;
}

export function initManagerAgenda() {
  document.addEventListener('click', async (event) => {
    const root = document.querySelector('[data-desktop-route-view]');
    if (!root) return;

    const passo = event.target.closest('[data-agenda-week]');
    if (passo) {
      offsetSemana += Number(passo.dataset.agendaWeek);
      await renderManagerAgenda(root);
      return;
    }

    const quadra = event.target.closest('[data-agenda-court]');
    if (quadra) {
      quadraFiltro = quadra.dataset.agendaCourt;
      await renderManagerAgenda(root);
      return;
    }

    const aba = event.target.closest('[data-agenda-tab]');
    if (aba) {
      const alvo = aba.dataset.agendaTab;
      root.querySelectorAll('[data-agenda-tab]').forEach((b) => {
        const on = b === aba;
        b.classList.toggle('on', on);
        b.setAttribute('aria-selected', String(on));
      });
      root.querySelectorAll('[data-agenda-panel]').forEach((p) => {
        p.hidden = p.dataset.agendaPanel !== alvo;
      });
      return;
    }

    if (event.target.closest('[data-agenda-event-close]')) {
      root.querySelector('[data-agenda-event-modal]').hidden = true;
      return;
    }

    const ev = event.target.closest('[data-ev]');
    if (ev) abrirDetalhe(root, ev);
  });

  // O evento do desktop e uma div com role=button: teclado nao vem de graca.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const ev = event.target.closest?.('[data-ev]');
    if (!ev) return;
    event.preventDefault();
    abrirDetalhe(document.querySelector('[data-desktop-route-view]'), ev);
  });
}
