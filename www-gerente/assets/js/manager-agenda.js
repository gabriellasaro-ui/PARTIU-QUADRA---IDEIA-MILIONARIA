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
/* A GRADE SE AJUSTA AO EXPEDIENTE, e nao o contrario.

   Era fixa em 08h-23h, 58px por hora: 928px de altura para caber num monitor
   de 900. O dono nunca via o dia inteiro — rolava para cima e para baixo
   procurando quatro reservas num campo vazio.

   Agora o intervalo sai do expediente real da semana (quem abre so a noite ve
   a noite) e a altura da hora se ajusta para o dia caber na tela. O piso de
   34px existe porque abaixo disso o nome do cliente nao cabe no bloco. */
const HORA_INICIAL_PADRAO = 8;
const HORA_FINAL_PADRAO = 23;
const ALTURA_HORA_MAX = 58;
const ALTURA_HORA_MIN = 34;
const ALTURA_GRADE_ALVO = 620;

let HORA_INICIAL = HORA_INICIAL_PADRAO;
let HORA_FINAL = HORA_FINAL_PADRAO;
let ALTURA_HORA = ALTURA_HORA_MAX;

/* Calcula a janela visivel a partir do expediente da semana + das reservas.

   As reservas entram no calculo porque uma reserva pode existir fora do
   expediente atual (o dono mudou o horario depois de vender). Corta-la da
   grade seria esconder dinheiro ja recebido. */
function ajustarJanela(eventos) {
  const limites = [];
  Object.values(expedienteCarregado).forEach((dias) => {
    Object.values(dias).forEach((faixas) => {
      (faixas || []).forEach(([abre, fecha]) => limites.push(abre, fecha));
    });
  });
  eventos.forEach((e) => limites.push(e.inicio, e.fim));

  if (limites.length) {
    HORA_INICIAL = Math.max(0, Math.floor(Math.min(...limites)));
    HORA_FINAL = Math.min(23, Math.ceil(Math.max(...limites)) - 1);
  } else {
    HORA_INICIAL = HORA_INICIAL_PADRAO;
    HORA_FINAL = HORA_FINAL_PADRAO;
  }
  if (HORA_FINAL < HORA_INICIAL) HORA_FINAL = HORA_INICIAL;

  const linhas = HORA_FINAL - HORA_INICIAL + 1;
  ALTURA_HORA = Math.round(Math.min(
    ALTURA_HORA_MAX,
    Math.max(ALTURA_HORA_MIN, ALTURA_GRADE_ALVO / linhas)
  ));
}

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

/* O RESUMO DA SEMANA SAIU da agenda — os tres numeros vivem no Dashboard.

   Sobrou so o rotulo do mes, que ainda titula a tela. Os `querySelector` dos
   contadores ficariam devolvendo null para sempre; era codigo procurando
   elemento que nao existe mais. */
function atualizarResumo(root, eventos, segunda) {
  const month = root.querySelector('[data-agenda-month]');
  if (month) month.textContent = rotuloMes(segunda);
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

/* RESERVAS SIMULTANEAAS LADO A LADO.

   Uma arena com tres quadras tem, por definicao, tres reservas as 20h de
   sabado. Todas eram desenhadas na mesma posicao, com a mesma largura: a de
   cima tapava as outras, e o dono via UMA reserva onde havia tres. Nao era
   feiura — era a agenda escondendo receita.

   O algoritmo e o mesmo dos calendarios: varre em ordem de inicio, agrupa o
   que se sobrepoe no tempo e divide a largura da coluna entre os membros do
   grupo. Cada evento sai com {col, de} = "sou o 2o de 3".

   Grupo, e nao par a par: A sobrepoe B, B sobrepoe C, mas A pode nao tocar C —
   e mesmo assim os tres precisam caber lado a lado, senao A e C se cobririam. */
function distribuir(eventos) {
  const ordenados = [...eventos].sort((a, b) => a.inicio - b.inicio || a.fim - b.fim);
  const saida = [];
  let grupo = [];
  let fimDoGrupo = -Infinity;

  const fechar = () => {
    if (!grupo.length) return;
    // Dentro do grupo, cada evento vai para a primeira coluna livre.
    const colunas = [];
    grupo.forEach((e) => {
      let alvo = colunas.findIndex((ultima) => ultima <= e.inicio);
      if (alvo === -1) { colunas.push(e.fim); alvo = colunas.length - 1; }
      else colunas[alvo] = e.fim;
      saida.push({ e, col: alvo, de: 0 });
    });
    // `de` e o total de colunas do grupo: todos os membros usam a mesma
    // largura, senao os blocos ficariam com tamanhos diferentes na mesma faixa.
    const total = colunas.length;
    saida.slice(-grupo.length).forEach((item) => { item.de = total; });
    grupo = [];
  };

  ordenados.forEach((e) => {
    if (e.inicio >= fimDoGrupo) { fechar(); fimDoGrupo = e.fim; }
    else fimDoGrupo = Math.max(fimDoGrupo, e.fim);
    grupo.push(e);
  });
  fechar();
  return saida;
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

  /* A LINHA DO AGORA.

     Numa grade de sete colunas, "que horas sao" e a primeira coisa que o dono
     precisa saber para ler o resto: o que ja passou nao pede acao, o que vem a
     seguir pede. Sem a linha, ele compara a regua da esquerda com o relogio do
     canto da tela toda vez.

     So aparece se HOJE estiver na semana visivel e dentro do expediente
     desenhado — no meio de uma semana passada ela nao significa nada. */
  const agora = new Date();
  const horaAgora = agora.getHours() + agora.getMinutes() / 60;
  const colunaHoje = DIAS.findIndex((_, i) => ehHoje(i));
  const mostrarAgora = colunaHoje >= 0
    && horaAgora >= HORA_INICIAL && horaAgora <= HORA_FINAL + 1;
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
      /* TODO bloco fechado leva rotulo, e nao so o dia inteiro.

         Na primeira versao so o dia fechado inteiro dizia "Fechado"; um bloco
         de 08h as 18h aparecia como hachura muda, e o dono ficava adivinhando
         se aquilo era horario fechado, indisponivel ou um defeito da tela.

         O rotulo so entra quando ha altura para ele (>= 46px); num bloco de
         uma hora, texto empilhado polui mais do que informa. */
      const rotular = (altura) => (altura >= 46 ? '<span>Fechado</span>' : '');
      if (!faixas.length) {
        fechados = `<div class="cal-closed is-full" style="top:0;height:${altura}px"><span>Fechado</span></div>`;
      } else {
        const abre = Math.min(...faixas.map((f) => f[0]));
        const fecha = Math.max(...faixas.map((f) => f[1]));
        if (abre > HORA_INICIAL) {
          const h = (abre - HORA_INICIAL) * ALTURA_HORA;
          fechados += `<div class="cal-closed" style="top:0;height:${h}px">${rotular(h)}</div>`;
        }
        if (fecha < HORA_FINAL + 1) {
          const topo = (fecha - HORA_INICIAL) * ALTURA_HORA;
          const h = altura - topo;
          fechados += `<div class="cal-closed" style="top:${topo}px;height:${h}px">${rotular(h)}</div>`;
        }
      }
    }

    const linhaAgora = (mostrarAgora && i === colunaHoje)
      ? `<div class="cal-now" style="top:${(horaAgora - HORA_INICIAL) * ALTURA_HORA}px" aria-hidden="true"><i></i></div>`
      : '';

    return `<div class="cal-col${ehHoje(i) ? ' today' : ''}" data-cal-dia="${escapeHtml(diaISO || '')}"
      data-cal-inicio="${HORA_INICIAL}" data-cal-hourh="${ALTURA_HORA}"
      style="min-height:${altura}px">${fechados}${linhaAgora}${
      distribuir(doDia).map(({ e, col, de }) => {
        const top = (e.inicio - HORA_INICIAL) * ALTURA_HORA;
        const h = Math.max(26, (e.fim - e.inicio) * ALTURA_HORA - 3);
        /* Largura e deslocamento vem da distribuicao: reservas simultaneas
           dividem a coluna do dia em vez de se cobrirem. */
        const larg = 100 / de;
        const esq = larg * col;
        /* O QUE CABE MUDA COM A LARGURA.

           Com tres reservas na mesma hora, a coluna do dia vira tres tiras de
           ~55px. "Sobrepoe Teste" nesse espaco vira "Sobrepo…", que nao
           identifica ninguem — e ocupa a linha que poderia dizer algo util.

           Entao: sozinha, mostra cliente e quadra; a dois, cliente e hora; a
           tres ou mais, so a HORA, grande. A cor ja diz o estado e o clique
           abre o detalhe — numa tira estreita, hora e a unica informacao que
           cabe inteira e que orienta o olho na vertical. */
        const apertado = de >= 3;

        /* O CONTEUDO ACOMPANHA A ALTURA DO BLOCO.

           Uma reserva de 3h desenha um retangulo de ~120px e o bloco mostrava
           duas linhas de texto no topo — nome e hora — deixando dois tercos da
           area em branco. Um bloco grande e vazio parece defeito, e ainda por
           cima desperdica o unico lugar da agenda onde ha espaco de sobra.

           A altura ja e proporcional a duracao, entao ela mesma diz quanto
           cabe: acima de ~78px (reserva de 2h ou mais) entram tambem a quadra
           e o valor, que sao o que o dono confere antes de confirmar por
           telefone. Abaixo disso, nada muda — espremer texto em bloco curto e
           o defeito oposto. */
        const alto = h >= 78;
        const corpo = apertado
          ? `<div class="t so-hora">${escapeHtml(e.horaCurta)}</div>`
          : `<div class="t">${escapeHtml(e.cliente)}</div>
             <div class="h">${escapeHtml(e.hora)}${de > 1 ? '' : ` · ${escapeHtml(e.quadra)}`}</div>
             ${alto && de <= 1 ? `<div class="ev-extra">
               <span>${escapeHtml(e.quadra)}</span>
               <span class="ev-valor">${formatCurrency(e.valor)}</span>
             </div>` : ''}`;

        return `<div class="cal-ev ${e.cls}${apertado ? ' is-tight' : ''}" role="button" tabindex="0"
          style="top:${top}px;height:${h}px;left:calc(${esq}% + 3px);width:calc(${larg}% - 5px)"
          title="${escapeHtml(e.cliente)} · ${escapeHtml(e.quadra)} · ${escapeHtml(e.hora)}" ${atributosEvento(e)}>
          ${corpo}
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
            <i class="ic sm manager-day-booking__chevron" data-lucide="chevron-right"></i>
          </button>`).join('')
        : '<div class="manager-agenda-empty"><span><i class="ic" data-lucide="clock"></i></span><strong>Dia livre</strong><small>Você ainda pode abrir horários para este dia.</small></div>'
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

  // A janela e a altura da hora saem do expediente + das reservas da semana.
  ajustarJanela(eventos);
  renderDesktop(root, eventos, segunda);
  renderMobile(root, eventos, segunda);

  /* O scroll automatico so entra se a grade NAO couber.

     Antes ele rolava sempre ate a primeira reserva — e com a grade agora
     ajustada ao expediente, o dia costuma caber inteiro. Rolar uma grade que
     ja cabe esconde as primeiras horas sem motivo. */
  const body = root.querySelector('[data-agenda-body]');
  if (body && eventos.length) {
    const cabe = body.scrollHeight <= body.clientHeight + 4;
    if (!cabe) {
      const primeira = Math.min(...eventos.map((e) => e.inicio), HORA_FINAL);
      body.scrollTop = Math.max(0, (primeira - HORA_INICIAL - 0.5) * ALTURA_HORA);
    }
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

/* CLICAR NUM HORARIO VAZIO ABRE A NOVA RESERVA JA PREENCHIDA.

   E o gesto que todo calendario tem e que faltava aqui: o dono via um buraco
   as 20h de sabado, e para vender aquele horario tinha de sair da agenda, abrir
   "Nova reserva" e redigitar o dia e a hora que estava vendo na tela.

   Nao vale para horario FECHADO: ali a hachura ja diz que nao ha o que
   vender, e abrir o formulario levaria a uma reserva que o proprio servidor
   recusa (409, "a quadra nao abre neste dia").
*/
function cliqueNoVazio(alvo, event) {
  const col = alvo.closest('.cal-col');
  if (!col) return false;
  // Clique em cima de reserva ou de faixa fechada nao cria nada.
  if (event.target.closest('.cal-ev')) return false;

  const rect = col.getBoundingClientRect();
  const y = event.clientY - rect.top;
  const inicio = Number(col.dataset.calInicio || 8);
  const alturaHora = Number(col.dataset.calHourh || 41);
  const hora = Math.floor(inicio + y / alturaHora);
  const dia = col.dataset.calDia;
  if (!dia || !Number.isFinite(hora)) return false;

  // Dentro de faixa fechada: nao abre.
  const fechado = Array.from(col.querySelectorAll('.cal-closed')).some((f) => {
    const t = parseFloat(f.style.top || '0');
    const h = parseFloat(f.style.height || '0');
    return y >= t && y < t + h;
  });
  if (fechado) {
    window.pqToast?.('A quadra não abre neste horário');
    return true;
  }

  const q = new URLSearchParams({ dia, hora: `${String(hora).padStart(2, '0')}:00` });
  location.hash = `#reserva-nova?${q}`;
  return true;
}

export function initManagerAgenda() {
  document.addEventListener('click', async (event) => {
    const root = document.querySelector('[data-desktop-route-view]');
    if (!root) return;

    /* "Hoje" tem atributo proprio, e nao `data-agenda-week="0"`.

       O passo e SOMADO ao offset (`+=`), entao zero somaria zero e o botao
       nao faria nada — quem estivesse quatro semanas a frente continuaria
       quatro semanas a frente. Voltar para a semana corrente e um destino, e
       nao um passo. */
    if (event.target.closest('[data-agenda-hoje]')) {
      offsetSemana = 0;
      await renderManagerAgenda(root);
      return;
    }

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

    // Por ULTIMO: so cria reserva se o clique nao foi em nada mais da tela.
    const coluna = event.target.closest('.cal-col');
    if (coluna && cliqueNoVazio(coluna, event)) return;

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
