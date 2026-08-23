/* Mensagens do painel — conversas REAIS da arena.

   A tela era HTML estatico com tres conversas escritas a mao ("Matheus Rocha",
   "Carol Souza", "Rafael Mendes") e um dialogo inventado. Nao havia render, nao
   havia API, e o botao de enviar nao enviava para lugar nenhum.

   Aqui ela passa a ler /api/mensagens e a fazer as tres coisas que o dono
   precisa: responder, ENCERRAR o atendimento e BLOQUEAR a pessoa.

   Por que encerrar existe: o canal serve para resolver AQUELA reserva —
   combinar chegada, avisar atraso, tirar duvida de acesso. Deixa-lo aberto o
   converte num canal permanente por onde a proxima reserva e combinada por
   fora, sem horario travado e sem pagamento. Quem faz isso quebra a agenda dos
   dois lados.

   Por que bloquear existe: encerrar resolve UM atendimento. Quando o problema
   e a pessoa, a proxima reserva abre outra conversa e a arena volta ao mesmo
   lugar. */
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
     seria oferecer uma acao que o servidor recusa. Bloquear continua
     disponivel: encerrar e bloquear resolvem coisas diferentes, e o dono pode
     querer o segundo depois do primeiro. */
  const btnEncerrar = root.querySelector('[data-conv-encerrar]');
  if (btnEncerrar) btnEncerrar.hidden = Boolean(atual.encerrada);

  const btnBloquear = root.querySelector('[data-conv-bloquear]');
  if (btnBloquear) {
    btnBloquear.hidden = false;
    btnBloquear.dataset.convBloquear = atual.clienteId || '';
    btnBloquear.classList.toggle('is-bloqueado', Boolean(atual.bloqueado));
    btnBloquear.innerHTML = atual.bloqueado
      ? '<i class="ic sm" data-lucide="check"></i> Desbloquear'
      : '<i class="ic sm" data-lucide="ban"></i> Bloquear pessoa';
  }

  const composer = root.querySelector('[data-conv-composer]');
  if (composer) composer.hidden = Boolean(atual.encerrada);
  const aviso = root.querySelector('[data-conv-encerrada-aviso]');
  if (aviso) aviso.hidden = !atual.encerrada;

  window.pqRefreshIcons?.(root);
}

export function initManagerMessages() {
  document.addEventListener('click', async (event) => {
    const root = document.querySelector('[data-desktop-route-view]');
    if (!root || !root.querySelector('[data-conv-list]')) return;

    const linha = event.target.closest('[data-conv]');
    if (linha) {
      abertaId = linha.dataset.conv;
      await renderManagerMessages(root);
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

    const bloquear = event.target.closest('[data-conv-bloquear]');
    if (bloquear) {
      const id = bloquear.dataset.convBloquear;
      if (!id) return;
      const desbloqueando = bloquear.classList.contains('is-bloqueado');
      if (!desbloqueando) {
        if (!window.confirm('Bloquear esta pessoa? Ela não poderá abrir conversa nova com a sua arena. As reservas já pagas continuam valendo.')) return;
      }
      try {
        if (desbloqueando) await venueService.desbloquearPessoa(id);
        else await venueService.bloquearPessoa(id);
        await renderManagerMessages(root);
        window.pqToast?.(desbloqueando ? 'Pessoa desbloqueada' : 'Pessoa bloqueada');
      } catch (error) {
        window.pqToast?.(error.message || 'Não foi possível concluir');
      }
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
