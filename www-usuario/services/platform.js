/* Plataforma: onde o app esta rodando e o que isso libera.

   Decisao de produto: no NAVEGADOR (PC ou celular) o Qadras entrega so o
   funil curto — buscar, ver a quadra e reservar. Todo o resto (minhas
   reservas, favoritos, mensagens, perfil, carteira, clube, game day) existe
   apenas no APP NATIVO, que continua completo.

   Duas perguntas diferentes, que nao devem ser confundidas:

     isNative()      -> estou dentro do app instalado (Capacitor)?
                        Decide QUAIS FUNCOES existem.
     isTouchDevice() -> o aparelho e de toque?
                        Decide QUAL LAYOUT usar (mobile ou desktop).

   O layout NAO pode depender da largura da janela: dar zoom no navegador
   encolhe a viewport CSS, cruza os breakpoints e o desktop se refluia no
   layout estreito, parecendo que "abriu a versao mobile". Aparelho de
   ponteiro continua desktop em qualquer zoom. */

const ESCAPE_LAYOUT = 'layout';

export function isNative() {
  return typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();
}

export function isTouchDevice() {
  if (typeof window === 'undefined') return false;
  if (isNative()) return true;
  if (window.matchMedia?.('(any-pointer: fine)')?.matches) return false;
  const grosseiro = window.matchMedia?.('(pointer: coarse)')?.matches;
  const semHover = window.matchMedia?.('(hover: none)')?.matches;
  const toques = navigator.maxTouchPoints || 0;
  return Boolean(grosseiro && semHover) || toques > 1;
}

/* Navegador com funcoes limitadas. No app instalado, sempre false. */
export function isWebLimited() {
  return !isNative();
}

/* Rotas que o navegador libera. Tudo que nao esta aqui e exclusivo do app.
   `login` e `cadastro` entram porque reservar exige conta: POST /api/reservas
   responde 401 sem token. `confirmado` entra porque e o desfecho da propria
   reserva — mandar o sujeito para o app antes de saber se a arena aceitou
   seria cruel. */
export const ROTAS_WEB = new Set([
  // o funil: achar, olhar, reservar
  'quadras', 'quadra', 'mapa', 'home', 'buscar',
  'pagamento', 'confirmado',
  // favoritos liberado a pedido do dono: salvar quadra e um gancho barato
  // para o sujeito voltar, e nao depende de mais nada do app
  'favoritos',
  // sem conta nao ha reserva: POST /api/reservas responde 401
  'entrar', 'cadastro', 'onboarding', 'login',
  // conta liberada a pedido do dono: quem cria conta pela web precisa poder
  // arrumar nome, foto e preferencias sem instalar o app. Carteira, mensagens,
  // clube e game day seguem exclusivos do app.
  'perfil', 'config',
  // valores de `nav` que a navegacao usa e nao sao rotas
  ''
]);

export function rotaLiberada(nome) {
  if (isNative()) return true;
  return ROTAS_WEB.has(nome);
}

/* Nome da rota dentro de um href: '#perfil', './index.html#quadra/12?x=1'. */
export function rotaDoHref(href) {
  if (!href || !href.includes('#')) return null;
  const bruto = href.slice(href.indexOf('#') + 1);
  return bruto.split(/[/?]/)[0] || null;
}

/* `?layout=web` na URL desliga o desvio automatico por dispositivo — serve
   para testar o layout desktop no celular e vice-versa sem ficar preso. */
export function layoutForcado() {
  if (typeof window === 'undefined') return null;
  const valor = new URLSearchParams(window.location.search).get(ESCAPE_LAYOUT);
  return valor === 'web' || valor === 'mobile' ? valor : null;
}

/* Marca o <html> para o CSS poder reagir. O script inline no <head> das
   paginas faz isso antes da primeira pintura; esta funcao so garante o
   estado quando o modulo carrega. */
export function marcarPlataforma() {
  if (typeof document === 'undefined') return;
  const raiz = document.documentElement;
  raiz.dataset.device = isTouchDevice() ? 'touch' : 'pointer';
  raiz.dataset.runtime = isNative() ? 'app' : 'web';
}
