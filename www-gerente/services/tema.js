/* Tema do painel do gerente.

   ESCURO DE FABRICA — o inverso do app do jogador, e de proposito.

   O painel e ferramenta de trabalho: fica aberto por horas, muitas vezes na
   arena a noite, num monitor de balcao. O app do jogador se abre por dois
   minutos, na rua, no sol. Os dois tem o mesmo dono e a mesma marca, mas nao
   o mesmo uso — e o padrao segue o uso, nao a simetria.

   Como no app, nao ha `prefers-color-scheme`: herdar o tema do sistema nao e
   escolha, e o CSS aqui trata a AUSENCIA do atributo como escuro, entao so
   existe um caminho para o padrao. */
import storage from '../storage/storage.js';

const CHAVE = 'tema';
const CLARO = 'light';
const ESCURO = 'dark';

/* Cor da barra do navegador / status do Android. Sem trocar, o topo do
   aparelho fica verde-claro sobre um painel escuro e a emenda aparece
   exatamente na borda da tela. */
const BARRA = {
  [ESCURO]: '#0e1613',
  [CLARO]: '#1b7a3e'
};

export function temaAtual() {
  return storage.get(CHAVE, ESCURO) === CLARO ? CLARO : ESCURO;
}

export function claroLigado() {
  return temaAtual() === CLARO;
}

function pintarBarra(tema) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', BARRA[tema] || BARRA[ESCURO]);
}

/* Aplica sem gravar — o boot so reflete o que ja estava escolhido. */
export function aplicarTema(tema = temaAtual()) {
  const alvo = tema === CLARO ? CLARO : ESCURO;
  const raiz = document.documentElement;
  if (alvo === CLARO) {
    raiz.setAttribute('data-theme', CLARO);
  } else {
    // Remover, e nao escrever "dark": o CSS trata a ausencia como escuro, e
    // assim so existe um caminho para o padrao.
    raiz.removeAttribute('data-theme');
  }
  pintarBarra(alvo);
  return alvo;
}

export function definirTema(tema) {
  const alvo = tema === CLARO ? CLARO : ESCURO;
  storage.set(CHAVE, alvo);
  return aplicarTema(alvo);
}

export function alternarTema() {
  return definirTema(claroLigado() ? ESCURO : CLARO);
}

export default { temaAtual, claroLigado, aplicarTema, definirTema, alternarTema };
