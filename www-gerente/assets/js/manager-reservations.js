/* Lista de reservas da arena — porte de _legacy/.../g_reservas.html.

   Refeita como linha (manager-booking-row), nao como tabela: cada reserva
   traz cliente, telefone, quadra, data, valor, status e as acoes. A tabela
   anterior nao deixava aprovar nem abrir a reserva, que sao as duas unicas
   coisas que o gerente vem fazer aqui.

   Banner, resumo e filtros vem junto porque sao o que responde "o que
   precisa de mim agora". */
import { loadBookings, applyBookingAction } from './manager-bookings.js';
import { formatCurrency } from '../../utils/formatters.js';
import { API_BASE_URL } from '../../config/constants.js';
import managerService from '../../services/manager-api.js';


let filtro = '';
let busca = '';

/* Estado da tela. Modulo e nao DOM porque a tela e remontada a cada troca de
   rota: guardar no elemento faria a pagina voltar para a 1 toda vez que o dono
   abrisse uma reserva e voltasse. */
let pagina = 1;
let de = '';
let ate = '';
const POR_PAGINA = 20;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

const inicial = (nome) => String(nome || '?').charAt(0).toUpperCase();

/* Icone inline: o sprite do Lucide so e resolvido depois, por pqRefreshIcons,
   e a linha e reescrita a cada filtro. */
const icone = (nome) => `<i class="ic sm" data-lucide="${nome}"></i>`;

function linha(r) {
  const acoes = r.status === 'Solicitada'
    ? `<button type="button" class="btn btn-danger btn-xs" data-booking-refuse="${r.id}">Recusar</button>
       <button type="button" class="btn btn-primary btn-xs" data-booking-approve="${r.id}"><i class="ic sm" data-lucide="check"></i> Aprovar</button>`
    : `<a href="./dashboard.html#reserva/${r.id}" class="btn btn-soft btn-xs">Ver detalhes</a>`;

  return `<article class="manager-booking-row${r.status === 'Solicitada' ? ' is-request' : ''}" data-status="${escapeHtml(r.cls)}">
    <!-- DE QUEM E O JOGO.

         Um nome de pessoa nao diz nada ao dono da quadra — "Gabriel Lasaro" e
         so mais um. Quando a reserva e de um clube, e o CLUBE que passa a
         encabecar a linha, com a pessoa logo abaixo como quem responde por
         ele. Num mensalista isso muda a decisao: ceder quatro quintas para um
         clube que ja joga ali e outra coisa. -->
    <div class="manager-booking-person">
      <span class="manager-avatar${r.clube ? ' is-clube' : ''}">${r.clube
        ? icone('users')
        : escapeHtml(inicial(r.cliente))}</span>
      <div>
        <strong>${escapeHtml(r.clube ? r.clube.nome : r.cliente)}</strong>
        <small>${r.clube
          ? `${escapeHtml(r.cliente)} · ${escapeHtml(r.telefone)}`
          : escapeHtml(r.telefone)}</small>
      </div>
    </div>
    <div class="manager-booking-fact"><span>Quadra</span><strong>${escapeHtml(r.quadra)}</strong></div>
    <!-- MENSALISTA E AVULSO PRECISAM SE DISTINGUIR AQUI.

         A linha mostrava so a data, entao um mensalista de toda quinta era
         igual a um avulso de um dia. O dono aprovava sem saber que estava
         cedendo o horario por quatro semanas.

         E "toda quinta" diz o PADRAO, nao o compromisso: quem aprova esta
         cedendo quatro datas concretas, entao elas vem logo abaixo. -->
    <div class="manager-booking-fact manager-booking-fact--data">
      <span>Data e horário</span>
      <strong>${escapeHtml(r.data)} · <span class="num">${escapeHtml(r.hora)}</span></strong>
      ${r.plan === 'mensalista'
        ? `<em class="manager-booking-plano">${icone('repeat')}<span>Mensalista${r.recorrencia ? ` · ${escapeHtml(r.recorrencia)}` : ''}</span></em>
           ${(r.sessoes || []).length ? `<span class="manager-booking-datas">${r.sessoes.map((d) => `<b>${escapeHtml(d)}</b>`).join('')}</span>` : ''}`
        : '<em class="manager-booking-plano is-avulso">Avulsa · 1 dia</em>'}
    </div>
    <div class="manager-booking-fact"><span>Valor</span><strong class="num">${formatCurrency(r.valor)}</strong></div>
    <div class="manager-booking-status"><span class="status ${escapeHtml(r.cls)}">${escapeHtml(r.status)}</span></div>
    <div class="manager-booking-actions">${acoes}</div>
  </article>`;
}

export async function renderManagerReservations(root) {
  const lista = root.querySelector('[data-manager-reservation-list]');
  if (!lista) return;

  /* A busca e o filtro de status vao para o SERVIDOR junto da pagina.

     Filtrar no cliente sobre uma pagina de 20 daria um resultado ridiculo:
     "nenhuma reserva" porque o que se procura esta na pagina 4. Quem pagina
     tem de filtrar do mesmo lado. */
  /* MENSALISTA TAMBEM ENTRA NESTA FILA.

     O filtro era `plano: 'avulso'`, entao uma solicitacao de mensalista nao
     aparecia aqui — nem em "Pendentes". Ela chegava so como notificacao, e a
     tela onde o dono APROVA nao a mostrava: o pedido ficava esperando uma
     decisao que nao tinha onde ser tomada.

     `semSessoes` corta as 3 sessoes filhas: elas sao o mesmo compromisso da
     reserva-pai e virariam quatro linhas iguais na fila. */
  const resposta = await loadBookings({
    pagina,
    porPagina: POR_PAGINA,
    semSessoes: true,
    status: filtro || undefined,
    q: busca.trim() || undefined,
    de: de || undefined,
    ate: ate || undefined
  });
  const todas = resposta.reservas;
  const solicitadas = todas.filter((r) => r.status === 'Solicitada');

  // O banner some quando nao ha o que responder — um aviso permanente vira
  // decoração e para de ser lido.
  const banner = root.querySelector('[data-booking-banner]');
  if (banner) {
    banner.hidden = solicitadas.length === 0;
    // (a contagem completa e ajustada abaixo, depois do resumo)
    const texto = root.querySelector('[data-booking-banner-count]');
    if (texto) {
      texto.textContent = solicitadas.length === 1
        ? '1 solicitação precisa da sua resposta'
        : `${solicitadas.length} solicitações precisam da sua resposta`;
    }
  }

  const set = (sel, valor) => {
    const el = root.querySelector(sel);
    if (el) el.textContent = valor;
  };
  // O TOTAL do conjunto, e nao o tamanho da pagina: "20 reservas no periodo"
  // quando existem 148 seria simplesmente falso.
  set('[data-booking-total]', resposta.total);
  /* Valor e pendencias tambem sao do CONJUNTO, e nao da pagina.

     Somar a pagina daria "R$ 2.400 movimentados" numa arena que movimentou 18
     mil — e o dono confere o proprio caixa por esse numero. Vem de uma consulta
     separada, sem paginar, porque totalizador nao pagina. */
  const resumo = await loadBookings({
    porPagina: 100, semSessoes: true,
    de: de || undefined, ate: ate || undefined
  });
  set('[data-booking-volume]', formatCurrency(
    resumo.reservas.reduce((t, r) => t + Number(r.valor || 0), 0)
  ));
  const pendentesTotal = resumo.reservas.filter((r) => r.status === 'Solicitada').length;
  set('[data-booking-pending]', pendentesTotal);
  root.querySelector('[data-booking-pending-card]')?.classList.toggle('has-pending', pendentesTotal > 0);

  lista.innerHTML = todas.map(linha).join('');
  const vazio = root.querySelector('[data-booking-empty]');
  if (vazio) vazio.hidden = todas.length > 0;

  /* Paginador: o TOTAL em texto, e nao so as setas.

     "1-20 de 148" e o que responde "ja vi tudo?" — com setas apenas, o dono
     clica ate acabar sem nunca saber o tamanho do que esta olhando. */
  const pager = root.querySelector('[data-booking-pager]');
  if (pager) {
    // Aparece sempre que ha reserva: o TOTAL e a informacao que responde "ja
    // vi tudo?", e ela sumia junto com o paginador quando cabia numa pagina.
    pager.hidden = resposta.total === 0;
    const primeiro = todas.length ? (resposta.pagina - 1) * resposta.porPagina + 1 : 0;
    const ultimo = (resposta.pagina - 1) * resposta.porPagina + todas.length;
    const info = pager.querySelector('[data-pager-info]');
    if (info) info.textContent = `${primeiro}-${ultimo} de ${resposta.total}`;
    pager.querySelector('[data-pager-prev]').disabled = resposta.pagina <= 1;
    pager.querySelector('[data-pager-next]').disabled = resposta.pagina >= resposta.paginas;
  }

  root.querySelectorAll('[data-booking-filter]').forEach((b) => {
    b.classList.toggle('on', b.dataset.bookingFilter === filtro);
  });

  /* A LISTA DE MENSALISTAS SAIU DAQUI junto com a aba.

     Ela custava uma chamada a /api/gerente/mensalistas em toda abertura de
     Reservas — para preencher um painel que a tela nao tem mais. */


  const campoDe = root.querySelector('[data-booking-de]');
  const campoAte = root.querySelector('[data-booking-ate]');
  if (campoDe) campoDe.value = de;
  if (campoAte) campoAte.value = ate;
  const limpar = root.querySelector('[data-periodo-limpar]');
  if (limpar) limpar.hidden = !(de || ate);

  window.pqRefreshIcons?.(root);
}

export function initManagerReservations() {
  document.addEventListener('click', async (event) => {
    const root = document.querySelector('[data-desktop-route-view]');
    if (!root) return;

    const aprovar = event.target.closest('[data-booking-approve]');
    if (aprovar) {
      try {
        await applyBookingAction(aprovar.dataset.bookingApprove, 'Confirmado');
        await renderManagerReservations(root);
        window.pqToast?.('Reserva aprovada');
      } catch (error) {
        window.pqToast?.(error.message || 'Não foi possível aprovar');
      }
      return;
    }

    const recusar = event.target.closest('[data-booking-refuse]');
    if (recusar) {
      try {
        await applyBookingAction(recusar.dataset.bookingRefuse, 'Recusada');
        await renderManagerReservations(root);
        window.pqToast?.('Reserva recusada');
      } catch (error) {
        window.pqToast?.(error.message || 'Não foi possível recusar');
      }
      return;
    }

    const aba = event.target.closest('[data-booking-filter]');
    if (aba) {
      filtro = aba.dataset.bookingFilter;
      // Trocar o filtro VOLTA para a pagina 1: continuar na 4 mostraria
      // "nenhuma reserva" para um filtro que tem tres.
      pagina = 1;
      await renderManagerReservations(root);
      return;
    }

    /* ATALHOS DE PERIODO: preenchem os dois campos de data.

       Nao sao um modo separado — escrevem em `de`/`ate` como se a pessoa
       tivesse digitado. Dois estados paralelos ("atalho" e "intervalo") sempre
       divergem: o dono clica em 7 dias, ajusta a data final e nao sabe mais
       qual dos dois vale. */
    const atalho = event.target.closest('[data-periodo]');
    if (atalho) {
      /* O ATALHO OLHA PARA A FRENTE, e nao para tras.

         Ele fazia `hoje - N dias`, e nesta tela isso esta errado duas vezes.
         Primeiro porque reserva e compromisso FUTURO: as da arena estao em
         setembro, e "ultimos 30 dias" devolvia quase nada — o dono clicava em
         "30 dias" e a lista esvaziava. Segundo porque quem abre Reservas quer
         saber o que vem, nao o que passou; olhar para tras e o Financeiro.

         E a data e montada em HORA LOCAL. `toISOString()` converte para UTC, e
         em Brasilia (UTC-3) qualquer clique depois das 21h ja caia no dia
         seguinte — o intervalo inteiro deslocado em um dia. */
      const dias = Number(atalho.dataset.periodo);
      if (!dias) { de = ''; ate = ''; }
      else {
        const local = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const hoje = new Date();
        const fim = new Date(hoje);
        fim.setDate(fim.getDate() + (dias - 1));
        de = local(hoje);
        ate = local(fim);
      }
      root.querySelectorAll('[data-periodo]').forEach((b) => {
        b.classList.toggle('on', b === atalho);
      });
      pagina = 1;
      await renderManagerReservations(root);
      return;
    }

    if (event.target.closest('[data-periodo-limpar]')) {
      de = ''; ate = ''; pagina = 1;
      root.querySelectorAll('[data-periodo]').forEach((b) => {
        b.classList.toggle('on', b.dataset.periodo === '');
      });
      await renderManagerReservations(root);
      return;
    }


    const anterior = event.target.closest('[data-pager-prev]');
    if (anterior && !anterior.disabled) {
      pagina = Math.max(1, pagina - 1);
      await renderManagerReservations(root);
      // Voltar ao topo da lista: paginar e ficar no rodape faz a pessoa achar
      // que nada mudou.
      root.querySelector('#solicitacoes')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    const proxima = event.target.closest('[data-pager-next]');
    if (proxima && !proxima.disabled) {
      pagina += 1;
      await renderManagerReservations(root);
      root.querySelector('#solicitacoes')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  /* Digitar a data aplica na hora. Sem "aplicar": um botao a mais entre a
     escolha e o resultado, para um campo que ja tem valor completo. */
  document.addEventListener('change', async (event) => {
    const campo = event.target.closest('[data-booking-de], [data-booking-ate]');
    if (!campo) return;
    const root = document.querySelector('[data-desktop-route-view]');
    if (!root) return;
    if (campo.hasAttribute('data-booking-de')) de = campo.value;
    else ate = campo.value;
    // Digitou data: nenhum atalho esta ativo, porque o intervalo agora e outro.
    root.querySelectorAll('[data-periodo]').forEach((b) => b.classList.remove('on'));
    pagina = 1;
    await renderManagerReservations(root);
  });

  /* A busca vai para o SERVIDOR, entao nao pode ir a cada tecla: sao 20
     requisicoes para escrever "Matheus". Espera 300ms depois da ultima tecla,
     que e menos do que se leva para digitar a proxima letra. */
  let esperaBusca = null;
  document.addEventListener('input', (event) => {
    const campo = event.target.closest('[data-booking-search]');
    if (!campo) return;
    busca = campo.value;
    pagina = 1;
    clearTimeout(esperaBusca);
    esperaBusca = setTimeout(() => {
      renderManagerReservations(document.querySelector('[data-desktop-route-view]'));
    }, 300);
  });

  /* SOLICITACAO CHEGANDO: toast na hora.

     O dono esta no balcao com o cliente na frente. Descobrir a solicitacao no
     proximo F5 e tarde: a reserva expira sozinha em 15 minutos. O evento vem
     pelo WebSocket; se a tela de reservas estiver aberta, ela se redesenha
     junto — ver o toast e a lista continuar velha seria pior que nao avisar. */
  window.addEventListener('pq:ws:event', async (evento) => {
    const dado = evento.detail || {};
    if (dado.type !== 'reserva.solicitada') return;
    window.pqToast?.(dado.titulo || 'Nova solicitação de reserva', {
      persistente: true,
      texto: dado.texto
    });
    const root = document.querySelector('[data-desktop-route-view]');
    if (root?.querySelector('[data-manager-reservation-list]')) {
      await renderManagerReservations(root);
    }
  });
}
