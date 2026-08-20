/* Tela de carregamento: pin de localizacao com bola de futebol, balancando.

   O desenho vem do video de referencia; a cor e a da marca. Feito em SVG e
   nao como video: o mp4 pesa 72 KB, nao acompanha o verde exato e nao escala
   em tela retina. Aqui sao ~2,5 KB e o tom sai de currentColor.

   Toda a geometria e calculada (tangentes do pin, pentagono e costuras da
   bola) — foi o que separou o desenho legivel das tentativas no olho. */

const PIN = "M32.0 66.0 L49.0 38.5 A20.0 20.0 0 1 0 15.0 38.5 Z";

/* A bola e VAZADA: anel grosso, pentagono central so de contorno e costuras
   curtas ate o anel — sao as areas BRANCAS que formam os gomos. Preenchendo
   os pentagonos de preto, no tamanho real (25px) virava um borrao escuro.
   Proporcoes tiradas do proprio video: anel ~10% do diametro, pentagono
   central ~40% do raio da bola. */
const BOLA_CENTRO = "M32.0 22.6 L37.2 26.3 L35.2 32.4 L28.8 32.4 L26.8 26.3Z";
const BOLA_COSTURAS = "M32.0 22.6 L32.0 15.8 M37.2 26.3 L43.7 24.2 M35.2 32.4 L39.2 37.9 M28.8 32.4 L24.8 37.9 M26.8 26.3 L20.3 24.2";

export function loadingHTML(rotulo = 'Carregando') {
  return `<div class="pq-loading" role="status" aria-live="polite" aria-label="${rotulo}">
    <svg class="pq-loading__pin" viewBox="0 0 64 76" aria-hidden="true">
      <!-- O grupo balanca; a origem do giro fica na ponta do pin (definida no
           CSS) para ele pivotar onde encosta no chao. -->
      <g class="pq-loading__balanco">
        <path d="${PIN}" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/>
        <g class="pq-loading__bola" fill="none" stroke="#12261c" stroke-width="2.7" stroke-linejoin="round" stroke-linecap="round">
          <circle cx="32" cy="28" r="13.6" fill="#fff"/>
          <path d="${BOLA_CENTRO}"/>
          <path d="${BOLA_COSTURAS}"/>
        </g>
      </g>
      <path d="M12 72h40" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>
    </svg>
  </div>`;
}

/* Overlay de tela cheia, preso ao <body>.

   Antes o loading era escrito dentro do container da rota: cobria so a area
   de conteudo, deixava o cabecalho de pe e o desenho encostado no topo em
   vez de centrado. Como overlay, ele cobre a tela inteira e sai por remocao
   explicita — quem renderiza nao escreve mais no mesmo no, entao acabou a
   corrida entre os dois. */
const ID_OVERLAY = 'pq-loading-overlay';

export function mostrarLoading() {
  if (typeof document === 'undefined' || document.getElementById(ID_OVERLAY)) return;
  const overlay = document.createElement('div');
  overlay.id = ID_OVERLAY;
  overlay.className = 'pq-loading-overlay';
  overlay.innerHTML = loadingHTML();
  document.body.appendChild(overlay);
}

export function esconderLoading() {
  document.getElementById(ID_OVERLAY)?.remove();
}

export default { loadingHTML, mostrarLoading, esconderLoading };
