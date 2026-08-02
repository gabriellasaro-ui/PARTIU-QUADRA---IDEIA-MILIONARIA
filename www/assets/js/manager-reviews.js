/* Avaliações — porte de _legacy/.../g_avaliacoes.html.

   A tela tinha tres KPIs inventados e dois reviews escritos na mao. Aqui a
   media e a distribuicao sao calculadas de REVIEW_DIST, entao a nota grande
   e as barras nao podem discordar entre si — que era o risco de manter as
   duas como texto fixo. */
import { ARENA_REVIEWS, REVIEW_DIST } from '../../config/manager-data.js';
import storage from '../../storage/storage.js';

const KEY = 'manager-review-replies';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

const respostas = () => storage.get(KEY, {});
const estrelas = (n) => Array.from({ length: 5 },
  (_, i) => `<svg class="ic${i < n ? ' on' : ''}"><use href="#i-star"/></svg>`).join('');

export function renderManagerReviews(root) {
  const lista = root.querySelector('[data-reviews-list]');
  if (!lista) return;

  const total = REVIEW_DIST.reduce((t, d) => t + d.qtd, 0);
  const media = REVIEW_DIST.reduce((t, d) => t + d.n * d.qtd, 0) / total;

  const set = (sel, valor) => {
    const el = root.querySelector(sel);
    if (el) el.textContent = valor;
  };
  set('[data-reviews-average]', media.toFixed(1).replace('.', ','));
  set('[data-reviews-total]', total);

  const caixaEstrelas = root.querySelector('[data-reviews-stars]');
  if (caixaEstrelas) caixaEstrelas.innerHTML = estrelas(Math.floor(media));

  const dist = root.querySelector('[data-reviews-dist]');
  if (dist) {
    dist.innerHTML = REVIEW_DIST.map((d) => `<div class="dist-row">
      <span class="dist-n num">${d.n}<svg class="ic sm"><use href="#i-star"/></svg></span>
      <div class="faixa-bar"><span style="width:${Math.round(d.qtd / total * 100)}%"></span></div>
      <span class="dist-q num">${d.qtd}</span>
    </div>`).join('');
  }

  const salvas = respostas();
  lista.innerHTML = ARENA_REVIEWS.map((a, i) => {
    const resposta = salvas[i];
    return `<div class="review" data-review="${i}">
      <div class="review-top">
        <span class="av">${escapeHtml(a.cliente.charAt(0))}</span>
        <div>
          <strong>${escapeHtml(a.cliente)}</strong>
          <div class="review-stars">${estrelas(a.nota)}<span class="review-when">${escapeHtml(a.quando)}</span></div>
        </div>
      </div>
      <p>${escapeHtml(a.texto)}</p>
      ${resposta
        ? `<div class="review-answer"><strong>Resposta do dono:</strong> ${escapeHtml(resposta)}</div>`
        : `<button type="button" class="review-reply" data-reply-toggle="${i}">Responder</button>
           <div class="review-reply-box" data-reply-box="${i}" hidden>
             <textarea placeholder="Escreva sua resposta ao cliente..."></textarea>
             <button type="button" class="btn btn-primary btn-xs" data-reply-send="${i}">Enviar resposta</button>
           </div>`}
    </div>`;
  }).join('');

  window.pqRefreshIcons?.(root);
}

export function initManagerReviews() {
  document.addEventListener('click', (event) => {
    const root = document.querySelector('[data-desktop-route-view]');
    if (!root) return;

    const abrir = event.target.closest('[data-reply-toggle]');
    if (abrir) {
      const caixa = root.querySelector(`[data-reply-box="${abrir.dataset.replyToggle}"]`);
      if (caixa) {
        caixa.hidden = !caixa.hidden;
        caixa.querySelector('textarea')?.focus();
      }
      return;
    }

    const enviar = event.target.closest('[data-reply-send]');
    if (!enviar) return;
    const i = enviar.dataset.replySend;
    const texto = root.querySelector(`[data-reply-box="${i}"] textarea`)?.value.trim();
    if (!texto) return;
    storage.set(KEY, { ...respostas(), [i]: texto });
    renderManagerReviews(root);
    window.pqToast?.('Resposta enviada');
  });
}
