/* Mensagens do painel — conversas REAIS da arena.

   A tela era HTML estatico com tres conversas escritas a mao ("Matheus Rocha",
   "Carol Souza", "Rafael Mendes") e um dialogo inventado. Nao havia render, nao
   havia API, e o botao de enviar nao enviava para lugar nenhum.

   Aqui ela passa a ler /api/mensagens e a fazer as duas coisas que o dono
   precisa: responder e ENCERRAR o atendimento.

   Por que encerrar existe: o canal serve para resolver AQUELA reserva —
   combinar chegada, avisar atraso, tirar duvida de acesso. Deixa-lo aberto o
   converte num canal permanente por onde a proxima reserva e combinada por
   fora, sem horario travado e sem pagamento. Quem faz isso quebra a agenda dos
   dois lados.

   NAO existe bloquear pessoa: o Gabriel decidiu que o produto nao bane
   cliente. Encerrar e a unica acao, e resolve o caso que importava. */
import managerService from '../../services/manager-api.js';
import venueService from '../../services/venues.js';
import { API_BASE_URL } from '../../config/constants.js';

/* Conversa aberta. Modulo e nao DOM: a tela e remontada a cada envio, e
   guardar no elemento faria a conversa fechar sozinha a cada mensagem. */
let abertaId = '';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

const inicial = (nome) => String(nome || '?').charAt(0).toUpperCase();

function linhaConversa(c, ativa) {
  const ultima = c.messages?.[c.messages.length - 1];
  return `<button type="button" class="conv-row${ativa ? ' on' : ''}${c.encerrada ? ' encerrada' : ''}"
      data-conv="${escapeHtml(c.id)}">
    <span class="conv-av">${escapeHtml(inicial(c.cliente))}</span>
    <span class="conv-body">
      <span class="conv-top">
        <strong>${escapeHtml(c.cliente)}</strong>
        <small>${escapeHtml(ultima?.time || '')}</small>
      </span>
      <!-- O ASSUNTO e o codigo da reserva: e como o dono liga a conversa ao
           jogo de que ela trata. Sem isso, tres conversas do mesmo cliente em
           semanas diferentes ficariam indistinguiveis. -->
      <span class="conv-sub">${escapeHtml(ultima?.text || c.subject || 'Sem mensagens')}</span>
    </span>
    ${c.unread ? '<span class="conv-dot" aria-label="Não lida"></span>' : ''}
  </button>`;
}

function bolha(m) {
  // `from` vem relativo a quem olha: 'player' e quem escreveu, 'venue' sou eu.
  const minha = m.from === 'venue';
  return `<div class="bubble ${minha ? 'me' : 'them'}">${escapeHtml(m.text)}<div class="bub-time">${escapeHtml(m.time || '')}</div></div>`;
}

export async function renderManagerMessages(root) {
  const listaEl = root.querySelector('[data-conv-list]');
  if (!listaEl) return;

  let conversas = [];
  if (API_BASE_URL) {
    try {
      conversas = await venueService.conversations();
    } catch (error) {
      conversas = [];
    }
  }

  /* Encerradas por ULTIMO, e nao escondidas: o dono ainda precisa reler o que
     foi combinado num atendimento que ele mesmo fechou. Mas elas nao podem
     empurrar para baixo a conversa que ainda espera resposta. */
  conversas.sort((a, b) => Number(a.encerrada) - Number(b.encerrada));

  if (!conversas.length) {
    listaEl.innerHTML = `<div class="conv-vazio">
      <strong>Nenhuma conversa ainda</strong>
      <span>O canal abre sozinho quando uma reserva e paga.</span>
    </div>`;
    const painel = root.querySelector('[data-conv-thread]');
    if (painel) painel.hidden = true;
    const vazio = root.querySelector('[data-conv-empty]');
    if (vazio) vazio.hidden = false;
    return;
  }

  if (!conversas.some((c) => c.id === abertaId)) abertaId = conversas[0].id;
  const atual = conversas.find((c) => c.id === abertaId);

  listaEl.innerHTML = conversas.map((c) => linhaConversa(c, c.id === abertaId)).join('');

  const painel = root.querySelector('[data-conv-thread]');
  const vazio = root.querySelector('[data-conv-empty]');
  if (painel) painel.hidden = false;
  if (vazio) vazio.hidden = true;

  const set = (sel, valor) => {
    const el = root.querySelector(sel);
    if (el) el.textContent = valor;
  };
  set('[data-conv-nome]', atual.cliente);
  set('[data-conv-sub]', atual.subject || '');
  set('[data-conv-ini]', inicial(atual.cliente));

  /* CONTEXTO DA RESERVA.

     Lido de forma defensiva (`atual.reserva?`): o campo e novo no backend e um
     servidor ainda nao reiniciado nao o manda. Sem a guarda, a tela inteira
     quebraria em vez de so nao mostrar a faixa. */
  const res = atual.reserva;
  const faixa = root.querySelector('[data-conv-reserva]');
  if (faixa) {
    faixa.hidden = !res;
    if (res) {
      set('[data-conv-quadra]', res.quadra || '—');
      set('[data-conv-dia]', res.dia || '—');
      set('[data-conv-hora]', res.hora || '—');
      set('[data-conv-valor]', typeof res.valor === 'number'
        ? res.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
        : '—');
      const st = root.querySelector('[data-conv-status]');
      if (st) {
        st.textContent = res.status || '';
        st.className = `status ${res.statusClass || 'pendente'}`;
      }
    }
  }

  const bolhas = root.querySelector('[data-conv-msgs]');
  if (bolhas) {
    bolhas.innerHTML = atual.messages?.length
      ? atual.messages.map(bolha).join('')
      : '<p class="conv-sem-msg">Nenhuma mensagem ainda.</p>';
    // Sempre no fim: conversa se le de baixo para cima.
    bolhas.scrollTop = bolhas.scrollHeight;
  }

  /* AS ACOES MUDAM COM O ESTADO.

     Encerrada, a conversa nao aceita mensagem — deixar o campo de escrever ali
     seria oferecer uma acao que o servidor recusa. */
  const btnEncerrar = root.querySelector('[data-conv-encerrar]');
  if (btnEncerrar) btnEncerrar.hidden = Boolean(atual.encerrada);

  const composer = root.querySelector('[data-conv-composer]');
  if (composer) composer.hidden = Boolean(atual.encerrada);
  const aviso = root.querySelector('[data-conv-encerrada-aviso]');
  if (aviso) aviso.hidden = !atual.encerrada;

  window.pqRefreshIcons?.(root);
}

/* ══════════ AVISO DE MENSAGEM NOVA ═══════════════════════════════════════

   O backend publica `message.new` no WebSocket desde a fase 18, e o painel
   escutava so `reserva.solicitada`. Ou seja: o cliente escrevia "cheguei, o
   portao esta fechado" e o dono so descobria abrindo Mensagens por acaso.

   Tres avisos, porque respondem coisas diferentes:

     TOAST     — algo aconteceu AGORA. Persistente: se ele sumisse em 2,6s, uma
                 mensagem que chega enquanto o dono atende alguem no balcao
                 estaria perdida.
     BADGE     — quantas esperam resposta, visivel de qualquer tela.
     SINO      — o ponto no header, que e onde o olho procura aviso.

   A contagem vem de /api/mensagens/nav/badges, e nao de somar no cliente: a
   tela de mensagens pode nem estar montada quando o evento chega. */
async function atualizarAvisos() {
  if (!API_BASE_URL) return;
  let badges;
  try {
    badges = await venueService.badges('gerente');
  } catch (error) {
    return;
  }
  const naoLidas = Number(badges?.msg_ger || 0);

  const item = document.querySelector('[data-nav-page="mensagens"]');
  if (item) {
    let selo = item.querySelector('.badge');
    if (naoLidas > 0) {
      if (!selo) {
        selo = document.createElement('span');
        selo.className = 'badge';
        item.appendChild(selo);
      }
      selo.textContent = String(naoLidas);
    } else if (selo) {
      selo.remove();
    }
  }

  /* O MESMO contador na folha de menu do celular. Ali a sidebar nao existe, e
     Mensagens so aparece dentro da folha — sem o numero, a unica pista de que
     alguem escreveu seria abrir o menu e entrar na tela. */
  const seloFolha = document.querySelector('[data-menu-badge]');
  if (seloFolha) {
    seloFolha.hidden = naoLidas === 0;
    seloFolha.textContent = String(naoLidas);
  }

  // O ponto do sino soma tudo o que espera o dono, e nao so mensagem.
  const pendencias = naoLidas + Number(badges?.solicitacoes || 0);
  document.querySelector('.ndot')?.classList.toggle('on', pendencias > 0);
}

export function initManagerMessages() {
  atualizarAvisos();

  window.addEventListener('pq:ws:event', async (evento) => {
    const dado = evento.detail || {};
    if (dado.type !== 'message.new') return;

    const conversa = dado.conversation || {};
    const ultima = conversa.messages?.[conversa.messages.length - 1];
    window.pqToast?.(`Nova mensagem de ${conversa.cliente || 'um cliente'}`, {
      persistente: true,
      texto: ultima?.text || conversa.subject || ''
    });

    await atualizarAvisos();

    /* Se a tela de mensagens estiver aberta, ela se redesenha junto: ver o
       toast e a lista continuar velha e pior do que nao avisar. */
    const root = document.querySelector('[data-desktop-route-view]');
    if (root?.querySelector('[data-conv-list]')) await renderManagerMessages(root);
  });

  document.addEventListener('click', async (event) => {
    const root = document.querySelector('[data-desktop-route-view]');
    if (!root || !root.querySelector('[data-conv-list]')) return;

    const linha = event.target.closest('[data-conv]');
    if (linha) {
      abertaId = linha.dataset.conv;
      await renderManagerMessages(root);
      // Abrir a conversa e o gesto que zera o aviso — o dono ja viu.
      try { await venueService.marcarLida?.(abertaId); } catch (error) {}
      await atualizarAvisos();
      return;
    }

    const enviar = event.target.closest('[data-conv-enviar]');
    if (enviar) {
      const campo = root.querySelector('[data-conv-texto]');
      const texto = (campo?.value || '').trim();
      if (!texto) return;
      enviar.disabled = true;
      try {
        await venueService.sendMessage(abertaId, texto);
        if (campo) campo.value = '';
        await renderManagerMessages(root);
      } catch (error) {
        window.pqToast?.(error.message || 'Não foi possível enviar');
      } finally {
        enviar.disabled = false;
      }
      return;
    }

    const encerrar = event.target.closest('[data-conv-encerrar]');
    if (encerrar) {
      /* Confirmacao porque nao ha volta: encerrada, a conversa nao reabre. O
         cliente perde o canal daquela reserva, e ele nao fez nada de errado —
         so acabou o assunto. */
      if (!window.confirm('Encerrar este atendimento? O cliente não poderá mais escrever nesta conversa.')) return;
      try {
        await venueService.encerrarConversa(abertaId);
        await renderManagerMessages(root);
        window.pqToast?.('Atendimento encerrado');
      } catch (error) {
        window.pqToast?.(error.message || 'Não foi possível encerrar');
      }
      return;
    }

  });

  /* Enter envia; Shift+Enter quebra linha. Sem isso, responder exige tirar a
     mao do teclado para clicar — num atendimento de balcao isso e atrito
     suficiente para a pessoa preferir o WhatsApp. */
  document.addEventListener('keydown', (event) => {
    const campo = event.target.closest('[data-conv-texto]');
    if (!campo || event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    document.querySelector('[data-conv-enviar]')?.click();
  });
}
