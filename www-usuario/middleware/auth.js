import { REQUIRE_LOGIN } from '../config/constants.js';

/* Quem pode entrar em cada rota.

   Aqui morava um requireAuth() que nunca rodou: ele dependia de
   data-auth-required no <html>, e nenhuma pagina jamais teve o atributo.

   A regra agora e a que o dono definiu: explorar e livre, agir exige conta.
   Ver quadra, preco e mapa nao pede login — quem so esta pesquisando quadra
   nao devia esbarrar num formulario. */

/* Rotas que mexem com dinheiro, identidade ou grupo. Reservar entra por
   #pagamento: o botao de reservar e um <a href="#pagamento/1?dia=...">, e e
   por isso que a guarda de rota cobre melhor que um gate de clique — o
   horario escolhido vive na URL e viaja inteiro dentro do next. */
export const PROTECTED_MOBILE_ROUTES = new Set([
  'reservas',
  'carteira',
  'carteiraAcao',
  'clube',
  'perfil',
  'config',
  'mensagens',
  'game',
  'pagamento',
  'confirmado'
]);

export const AUTH_ROUTES = new Set(['entrar', 'cadastro', 'onboarding']);

/* Monta o hash de login que sabe voltar.

   O encodeURIComponent nao e opcional: parseMobileRouteHash faz
   raw.split('?') com destructuring, entao tudo depois do SEGUNDO '?' e
   descartado em silencio. Sem encoding, quem volta do login cai no checkout
   sem o horario que tinha escolhido — e a tela carrega vazia, sem erro
   nenhum. Por isso o encoding mora aqui, num lugar so, e ninguem monta esse
   hash na mao. */
export function authHashFor(nextHash) {
  const alvo = String(nextHash || '').replace(/^#/, '') || 'home';
  return `#entrar?next=${encodeURIComponent(alvo)}`;
}

/* Para onde ir depois de entrar. Recusa voltar para as proprias telas de
   auth, senao vira laco: #entrar?next=entrar. */
export function safeNext(route) {
  const raw = route?.query?.get('next') || 'home';
  const primeiro = String(raw).split(/[/?]/)[0];
  return AUTH_ROUTES.has(primeiro) ? 'home' : raw;
}

/* Com REQUIRE_LOGIN desligado nada e protegido: o app inteiro abre sem
   conta. A lista acima continua valendo e testada para quando ligar. */
export function isProtectedRoute(routeName) {
  return REQUIRE_LOGIN && PROTECTED_MOBILE_ROUTES.has(routeName);
}

export function requiresLogin() {
  return REQUIRE_LOGIN;
}
