/* Avaliações — porte de _legacy/.../g_avaliacoes.html.

   A tela tinha tres KPIs inventados e dois reviews escritos na mao. Aqui a
   media e a distribuicao vem do backend, entao a nota grande
   e as barras nao podem discordar entre si — que era o risco de manter as
   duas como texto fixo. */
import storage from '../../storage/storage.js';
import { API_BASE_URL } from '../../config/constants.js';
import managerService from '../../services/manager-api.js';

const KEY = 'manager-review-replies';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

const respostas = () => storage.get(KEY, {});
const estrelas = (n) => Array.from({ length: 5 },
  (_, i) => `<i class="ic${i < n ? ' on' : ''}" data-lucide="star"></i>`).join('');

/* Quadra escolhida no filtro. Modulo e nao DOM: a tela e remontada a cada
   troca de rota, e guardar no elemento perderia a escolha ao responder uma
   avaliacao. */
let quadraFiltro = '';

export async function renderManagerReviews(root) {
  const lista = root.querySelector('[data-reviews-list]');
  if (!lista) return;

  // Com API a media/distribuicao vêm do backend; sem API, do dado antigo.
  let avaliacoes;
  let dist;
  let total;
  let media;
  let porQuadra = [];
  if (API_BASE_URL) {
    const data = await managerService.avaliacoes(quadraFiltro || undefined);
    avaliacoes = data.avaliacoes;
    dist = data.dist;
    total = data.total;
    media = data.media;
    porQuadra = data.quadras || [];
  } else {
    /* Sem API nao ha avaliacao nenhuma — e o painel nem chega aqui, porque o
       login recusa sem backend. Mostrar as de exemplo (Matheus Rocha, Carol
       Souza) era pior que mostrar nada: sao clientes que nao existem, com
       notas que ninguem deu, e o dono tiraria conclusoes sobre a reputacao
       dele a partir disso. */
    avaliacoes = [];
    dist = [5, 4, 3, 2, 1].map((n) => ({ n, qtd: 0 }));
    total = 0;
    media = 0;
  }

  const set = (sel, valor) => {
    const el = root.querySelector(sel);
    if (el) el.textContent = valor;
  };

  /* NOTA POR QUADRA — da pior para a melhor.

     A media da arena junta tudo: com quatro quadras, a que esta com problema
     dilui nas outras e o dono ve 4,8 concluindo que esta tudo bem. Aqui cada
     quadra tem a propria nota, e a que precisa de atencao fica em cima. */
  const caixa = root.querySelector('[data-reviews-courts]');
  if (caixa) {
    caixa.innerHTML = porQuadra.length > 1
      ? [`<button type="button" class="rev-quadra${quadraFiltro ? '' : ' on'}" data-rev-quadra="">
           <span class="rev-quadra__nome">Todas as quadras</span>
           <span class="rev-quadra__nota num">${String(media).replace('.', ',')}</span>
         </button>`]
        .concat(porQuadra.map((q) => `
          <button type="button" class="rev-quadra${quadraFiltro === q.quadraId ? ' on' : ''}" data-rev-quadra="${q.quadraId}">
            <span class="rev-quadra__nome">${escapeHtml(q.quadraNome)}<small>${q.total} ${q.total === 1 ? 'avaliação' : 'avaliações'}</small></span>
            <span class="rev-quadra__nota num${q.media < 4 ? ' baixa' : ''}">${String(q.media).replace('.', ',')}</span>
          </button>`))
        .join('')
      : '';
  }
  set('[data-reviews-average]', Number(media).toFixed(1).replace('.', ','));
  set('[data-reviews-total]', total);

  const caixaEstrelas = root.querySelector('[data-reviews-stars]');
  if (caixaEstrelas) caixaEstrelas.innerHTML = estrelas(Math.floor(Number(media)));

  const distBox = root.querySelector('[data-reviews-dist]');
  if (distBox) {
    distBox.innerHTML = dist.map((d) => `<div class="dist-row">
      <span class="dist-n num">${d.n}<i class="ic sm" data-lucide="star"></i></span>
      <div class="faixa-bar"><span style="width:${total ? Math.round(d.qtd / total * 100) : 0}%"></span></div>
      <span class="dist-q num">${d.qtd}</span>
    </div>`).join('');
  }

  lista.innerHTML = avaliacoes.map((a) => {
    const id = a.id ?? a.cliente;
    const resposta = a.resposta;
    return `<div class="review" data-review="${escapeHtml(id)}">
      <div class="review-top">
        <span class="av">${escapeHtml(String(a.cliente).charAt(0))}</span>
        <div>
          <strong>${escapeHtml(a.cliente)}</strong>
          <div class="review-stars">${estrelas(Number(a.nota))}<span class="review-when">${escapeHtml(a.quando)}</span></div>
          <!-- QUAL QUADRA. Sem isto, "o vestiario estava sujo" nao diz qual
               vestiario, e o dono nao tem o que fazer com a reclamacao. -->
          ${a.quadraId ? `<div class="review-quadra"><i class="ic sm" data-lucide="layout-grid"></i>${escapeHtml(a.quadraNome)}</div>` : ''}
        </div>
      </div>
      <p>${escapeHtml(a.texto)}</p>
      ${resposta
        ? `<div class="review-answer"><strong>Resposta do dono:</strong> ${escapeHtml(resposta)}</div>`
        : `<button type="button" class="review-reply" data-reply-toggle="${escapeHtml(id)}">Responder</button>
           <div class="review-reply-box" data-reply-box="${escapeHtml(id)}" hidden>
             <textarea placeholder="Escreva sua resposta ao cliente..."></textarea>
             <button type="button" class="btn btn-primary btn-xs" data-reply-send="${escapeHtml(id)}">Enviar resposta</button>
           </div>`}
    </div>`;
  }).join('');

  window.pqRefreshIcons?.(root);
}

export function initManagerReviews() {
  document.addEventListener('click', async (event) => {
    const root = document.querySelector('[data-desktop-route-view]');
    if (!root) return;

    const filtroQuadra = event.target.closest('[data-rev-quadra]');
    if (filtroQuadra) {
      quadraFiltro = filtroQuadra.dataset.revQuadra;
      await renderManagerReviews(root);
      return;
    }

    const abrir = event.target.closest('[data-reply-toggle]');
    if (abrir) {
      const caixa = root.querySelector(`[data-reply-box="${CSS.escape(abrir.dataset.replyToggle)}"]`);
      if (caixa) {
        caixa.hidden = !caixa.hidden;
        caixa.querySelector('textarea')?.focus();
      }
      return;
    }

    const enviar = event.target.closest('[data-reply-send]');
    if (!enviar) return;
    const id = enviar.dataset.replySend;
    const caixa = root.querySelector(`[data-reply-box="${CSS.escape(id)}"]`);
    const texto = caixa?.querySelector('textarea')?.value.trim();
    if (!texto) return;
    if (API_BASE_URL) {
      try {
        await managerService.responderAvaliacao(id, texto);
      } catch (error) {
        window.pqToast?.(error.message || 'Não foi possível enviar');
        return;
      }
    } else {
      storage.set(KEY, { ...respostas(), [id]: texto });
    }
    await renderManagerReviews(root);
    window.pqToast?.('Resposta enviada');
  });
}
