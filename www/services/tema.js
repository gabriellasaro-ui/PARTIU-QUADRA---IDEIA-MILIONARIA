/* Tema claro/escuro.

   CLARO DE FABRICA, escuro por escolha. Nao ha `prefers-color-scheme` aqui de
   proposito: um app que fica escuro sozinho porque o Android esta escuro nao
   deu escolha nenhuma a pessoa, so herdou uma. Quem quiser escuro liga em
   Configuracoes, e a escolha fica gravada no aparelho.

   A marca no <html> (data-theme="dark") e o que o CSS observa; a ausencia dela
   e o modo claro. Guardar a preferencia em `storage` e nao no atributo importa
   porque o atributo se perde a cada abertura do app. */
import storage from '../storage/storage.js';

const CHAVE = 'tema';
const ESCURO = 'dark';
const CLARO = 'light';

/* Cor da barra de status do Android (e da barra de endereco no navegador).
   Sem trocar isto, o topo do aparelho continuava verde-claro sobre um app
   escuro — a emenda aparecia justamente na borda da tela. */
const BARRA = {
  [CLARO]: '#16a765',
  [ESCURO]: '#0e1613'
};

export function temaAtual() {
  return storage.get(CHAVE, CLARO) === ESCURO ? ESCURO : CLARO;
}

export function escuroLigado() {
  return temaAtual() === ESCURO;
}

function pintarBarra(tema) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', BARRA[tema] || BARRA[CLARO]);
}

/* Aplica sem gravar — usado no boot, quando so se quer refletir o que ja
   estava escolhido. */
export function aplicarTema(tema = temaAtual()) {
  const alvo = tema === ESCURO ? ESCURO : CLARO;
  const raiz = document.documentElement;
  if (alvo === ESCURO) {
    raiz.setAttribute('data-theme', ESCURO);
  } else {
    // Remover, e nao escrever "light": o CSS trata a AUSENCIA como claro, e
    // assim so existe um caminho para o tema padrao.
    raiz.removeAttribute('data-theme');
  }
  pintarBarra(alvo);
  return alvo;
}

export function definirTema(tema) {
  const alvo = tema === ESCURO ? ESCURO : CLARO;
  storage.set(CHAVE, alvo);
  return aplicarTema(alvo);
}

export function alternarTema() {
  return definirTema(escuroLigado() ? CLARO : ESCURO);
}

export default { temaAtual, escuroLigado, aplicarTema, definirTema, alternarTema };
