/* PUXAR PARA ATUALIZAR — o gesto do Instagram.

   Estando no topo da tela, arrastar para baixo recarrega a rota. O gesto ja
   existe na cabeca de quem usa celular: quando a lista parece velha, a mao
   puxa. Sem isso o unico jeito de ver dado novo era trocar de aba e voltar, ou
   fechar e abrir o app.

   O QUE ROLA AQUI E O DOCUMENTO, e nao `.screen`.

   `.screen` tem `overflow-y: auto` no CSS e parece ser o container de rolagem,
   mas ele cresce com o conteudo (scrollHeight == clientHeight) e quem rola de
   verdade e o <html> — medido no navegador: `window.scrollTo(0, 200)` move a
   pagina e `.screen.scrollTop` continua zero. Prender os eventos em `.screen`
   daria um gesto que nunca dispara.

   `touchmove` NAO pode ser passivo: e nele que se chama preventDefault para
   segurar o overscroll nativo do navegador. Sem isso o Chrome do Android puxa
   a propria tela junto e o indicador desliza por cima de um fundo em
   movimento. `touchstart` e `touchend` continuam passivos, que e o barato.
*/

const LIMIAR = 70;        // quanto puxar, ja com resistencia, para disparar
const MAXIMO = 110;       // teto do arrasto: puxar mais nao afunda mais
const ROTAS_FORA = new Set(['mapa']);

/* Resistencia: o dedo anda mais do que o indicador, e cada pixel a mais rende
   menos. E o que da a sensacao de elastico — sem isso o indicador acompanha o
   dedo e o gesto parece um scroll quebrado. */
function comResistencia(distancia) {
  return Math.min(MAXIMO, distancia * 0.5);
}

function podeAgora() {
  // No mapa o arrasto e do proprio mapa; sheet aberto tem a rolagem dele.
  if (ROTAS_FORA.has(document.documentElement.dataset.route)) return false;
  if (document.body.classList.contains('market-sheet-open')) return false;
  return true;
}

function criarIndicador() {
  const el = document.createElement('div');
  el.className = 'puxar-atualizar';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<span class="puxar-atualizar__roda"></span>';
  document.body.appendChild(el);
  return el;
}

export function initPuxarAtualizar(aoAtualizar) {
  if (typeof document === 'undefined') return;
  // Sem toque nao ha gesto: no navegador de mesa a roda do mouse ja rola, e
  // um listener de touch ali seria peso morto.
  if (!window.matchMedia('(pointer: coarse)').matches && !(navigator.maxTouchPoints > 0)) return;

  let indicador = null;
  let inicioY = 0;
  let puxando = false;
  let distancia = 0;
  let ocupado = false;

  const alvo = () => (indicador || (indicador = criarIndicador()));

  const desenhar = (d) => {
    const el = alvo();
    el.style.transform = `translate(-50%, ${d}px)`;
    el.style.opacity = String(Math.min(1, d / LIMIAR));
    el.classList.toggle('is-pronto', d >= LIMIAR);
  };

  const recolher = () => {
    if (!indicador) return;
    indicador.classList.add('is-voltando');
    indicador.classList.remove('is-pronto', 'is-girando');
    indicador.style.transform = 'translate(-50%, 0)';
    indicador.style.opacity = '0';
    setTimeout(() => indicador?.classList.remove('is-voltando'), 240);
  };

  const rodar = async () => {
    ocupado = true;
    const el = alvo();
    el.classList.add('is-girando');
    el.classList.remove('is-pronto');
    el.style.transform = `translate(-50%, ${LIMIAR}px)`;
    el.style.opacity = '1';
    try {
      await aoAtualizar();
    } catch (erro) {
      /* Falhou a atualizacao: o indicador some do mesmo jeito. Quem chamou ja
         mostra o proprio aviso de erro — deixar a roda girando para sempre
         seria trocar um dado velho por uma tela travada. */
    } finally {
      ocupado = false;
      recolher();
    }
  };

  document.addEventListener('touchstart', (ev) => {
    if (ocupado || ev.touches.length !== 1) return;
    if (window.scrollY > 0 || !podeAgora()) return;
    inicioY = ev.touches[0].clientY;
    distancia = 0;
    puxando = true;
  }, { passive: true });

  document.addEventListener('touchmove', (ev) => {
    if (!puxando) return;
    distancia = ev.touches[0].clientY - inicioY;

    /* Subiu, ou a pagina saiu do topo no meio do gesto: nao e mais "puxar para
       atualizar", e rolagem normal. Solta o controle em vez de competir com
       ela. */
    if (distancia <= 0 || window.scrollY > 0) {
      puxando = false;
      recolher();
      return;
    }
    ev.preventDefault();
    desenhar(comResistencia(distancia));
  }, { passive: false });

  const soltar = () => {
    if (!puxando) return;
    puxando = false;
    if (comResistencia(distancia) >= LIMIAR) rodar();
    else recolher();
  };

  document.addEventListener('touchend', soltar, { passive: true });
  // Ligacao encerrada por fora (chamada, notificacao do sistema): sem isto o
  // indicador ficaria parado no meio da tela.
  document.addEventListener('touchcancel', () => { puxando = false; recolher(); }, { passive: true });
}

export default { initPuxarAtualizar };
