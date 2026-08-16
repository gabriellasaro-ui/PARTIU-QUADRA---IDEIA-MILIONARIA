/* Avaliações — porte de _legacy/.../g_avaliacoes.html.

   A tela tinha tres KPIs inventados e dois reviews escritos na mao. Aqui a
   media e a distribuicao sao calculadas de REVIEW_DIST, entao a nota grande
   e as barras nao podem discordar entre si — que era o risco de manter as
   duas como texto fixo. */
import { ARENA_REVIEWS, REVIEW_DIST } from '../../config/manager-data.js';
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
  (_, i) => `<svg class="ic${i < n ? ' on' : ''}"><use href="#i-star"/></svg>`).join('');

export async function renderManagerReviews(root) {
  const lista = root.querySelector('[data-reviews-list]');
  if (!lista) return;

  // Com API a media/distribuicao vêm do backend; sem API, do dado antigo.
  let avaliacoes;
  let dist;
  let total;
  let media;
  if (API_BASE_URL) {
    const data = await managerService.avaliacoes();
    avaliacoes = data.avaliacoes;
    dist = data.dist;
    total = data.total;
    media = data.media;
  } else {
    avaliacoes = ARENA_REVIEWS.map((a, i) => ({ ...a, id: i, resposta: respostas()[i] || '' }));
    dist = REVIEW_DIST;
    total = REVIEW_DIST.reduce((t, d) => t + d.qtd, 0);
    media = REVIEW_DIST.reduce((t, d) => t + d.n * d.qtd, 0) / total;
  }

  const set = (sel, valor) => {
    const el = root.querySelector(sel);
    if (el) el.textContent = valor;
  };
  set('[data-reviews-average]', Number(media).toFixed(1).replace('.', ','));
  set('[data-reviews-total]', total);

  const caixaEstrelas = root.querySelector('[data-reviews-stars]');
  if (caixaEstrelas) caixaEstrelas.innerHTML = estrelas(Math.floor(Number(media)));

  const distBox = root.querySelector('[data-reviews-dist]');
  if (distBox) {
    distBox.innerHTML = dist.map((d) => `<div class="dist-row">
      <span class="dist-n num">${d.n}<svg class="ic sm"><use href="#i-star"/></svg></span>
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
