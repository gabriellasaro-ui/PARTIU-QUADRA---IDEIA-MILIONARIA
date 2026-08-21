/* Voltar que volta.

   O PROBLEMA. Cada tela trazia o destino do "voltar" escrito no HTML:
   carteira.html apontava para #home, clube.html para #home, config.html para
   #home. Entao abrir a carteira a partir do perfil e tocar em voltar levava
   para a home — nunca para o perfil. A testadora resumiu bem: "toda aba que
   abre, quando volta, vai pra home".

   A CORRECAO. Voltar passa a usar o HISTORICO, e o href do HTML vira apenas o
   destino de emergencia: quando nao ha para onde voltar (a pessoa abriu o app
   direto naquela tela, por link ou notificacao), o fallback e o que evita uma
   tela sem saida.

   COMO SABER SE HA HISTORICO. `history.length` nao serve: ele conta a aba
   inteira do navegador, incluindo o que veio antes do app, e no WebView do
   Capacitor comeca em valores imprevisiveis. Entao guardamos a profundidade
   dentro do proprio `history.state` — cada entrada nova sabe em que degrau
   esta, e degrau 0 significa "cheguei aqui direto".

   CUIDADO COM O STATE. app.js chama history.replaceState nos desvios de rota.
   Se essa chamada apagar o state, a profundidade some e todo voltar vira
   fallback. Por isso marcarProfundidade() MESCLA em vez de sobrescrever, e
   roda depois do desvio. */

const CHAVE = 'pqDepth';

let ultimaProfundidade = null;
let fecharSobreposicao = null;
let ouvinteNativo = null;

/* mobile.js registra aqui como fechar um sheet aberto. Fica por injecao, e nao
   por import, porque mobile.js ja importa este modulo — importar de volta
   fecharia um ciclo. */
export function registrarFecharSobreposicao(fn) {
  fecharSobreposicao = typeof fn === 'function' ? fn : null;
}

function estadoAtual() {
  return (typeof history !== 'undefined' && history.state) || null;
}

/* Chamada a cada rota desenhada. Tres casos:
     - primeira pintura da sessao          -> degrau 0
     - entrada que ja tem degrau (voltar)  -> respeita o que esta la
     - entrada nova (navegou para frente)  -> degrau anterior + 1 */
export function marcarProfundidade() {
  if (typeof history === 'undefined') return;
  const estado = estadoAtual();
  const gravado = estado && typeof estado[CHAVE] === 'number' ? estado[CHAVE] : null;

  let profundidade;
  if (gravado !== null) {
    profundidade = gravado;
  } else if (ultimaProfundidade === null) {
    profundidade = 0;
  } else {
    profundidade = ultimaProfundidade + 1;
  }

  ultimaProfundidade = profundidade;
  if (gravado === profundidade) return;
  // Mescla: outros trechos podem ter posto coisas no state.
  history.replaceState({ ...(estado || {}), [CHAVE]: profundidade }, '');
}

export function podeVoltar() {
  const estado = estadoAtual();
  const profundidade = estado && typeof estado[CHAVE] === 'number' ? estado[CHAVE] : 0;
  return profundidade > 0;
}

/* Ordem importa:
     1. sheet aberto engole o voltar — quem esta com o formulario de clube na
        tela espera fechar o formulario, nao sair da tela;
     2. havendo historico, volta de verdade;
     3. sem historico, cai no destino de emergencia com replace, para nao
        empilhar mais uma entrada e deixar o proximo voltar preso num laco. */
export function voltar(fallback = '#home') {
  if (fecharSobreposicao && fecharSobreposicao()) return true;
  if (podeVoltar()) {
    history.back();
    return true;
  }
  const destino = fallback && fallback.startsWith('#') ? fallback : `#${fallback || 'home'}`;
  location.replace(destino);
  return false;
}

/* Botao fisico do Android. Sem ele, o sistema fecha o app a qualquer toque —
   inclusive com um sheet aberto, o que parece travamento.

   O plugin @capacitor/app pode nao estar instalado (no navegador nunca esta):
   nesse caso a funcao simplesmente nao faz nada, e o app segue igual. */
export async function registrarVoltarNativo({ aoSairDaRaiz } = {}) {
  const plugin = typeof window !== 'undefined' && window.Capacitor?.Plugins?.App;
  if (!plugin?.addListener || ouvinteNativo) return null;

  ouvinteNativo = await plugin.addListener('backButton', () => {
    if (fecharSobreposicao && fecharSobreposicao()) return;
    if (podeVoltar()) {
      history.back();
      return;
    }
    // Na raiz: quem decide e quem chamou. Sem decisao, minimiza em vez de
    // fechar — fechar apaga a sessao de navegacao inteira sem aviso.
    if (typeof aoSairDaRaiz === 'function') {
      aoSairDaRaiz(plugin);
      return;
    }
    plugin.minimizeApp?.();
  });
  return ouvinteNativo;
}

export function encerrarVoltarNativo() {
  ouvinteNativo?.remove?.();
  ouvinteNativo = null;
}

export default {
  marcarProfundidade,
  podeVoltar,
  voltar,
  registrarFecharSobreposicao,
  registrarVoltarNativo,
  encerrarVoltarNativo
};
