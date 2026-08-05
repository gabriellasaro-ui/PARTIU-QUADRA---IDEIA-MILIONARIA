export const ROUTES = {
  home: './index.html',
  desktop: './pc.html#quadras',
  login: './index.html#entrar',
  entrar: './index.html#entrar',
  cadastro: './index.html#cadastro',
  onboarding: './index.html#onboarding',
  clubes: './index.html#clubes',
  dashboard: './dashboard.html',
  explorar: './index.html#explorar',
  mapa: './index.html#mapa',
  reservas: './index.html#reservas',
  quadra: './index.html#quadra',
  pagamento: './index.html#pagamento',
  confirmado: './index.html#confirmado',
  favoritos: './index.html#favoritos',
  carteira: './index.html#carteira',
  mensagens: './index.html#mensagens',
  perfil: './index.html#perfil',
  configurações: './index.html#config',
  clube: './index.html#clube',
  game: './index.html#game',
  gerenteReservas: './dashboard.html#reservas',
  gerenteMensagens: './dashboard.html#mensagens',
  gerenteAgenda: './dashboard.html#agenda',
  gerenteFinanceiro: './dashboard.html#financeiro',
  gerenteQuadras: './dashboard.html#quadras',
  gerenteAvaliacoes: './dashboard.html#avaliacoes',
  gerenteConfig: './dashboard.html#config'
};

export function parseMobileRouteHash(hashValue = '') {
  const raw = String(hashValue).replace(/^#/, '').trim() || 'home';
  const [pathValue, queryValue = ''] = raw.split('?');
  const parts = pathValue.split('/').filter(Boolean);
  const first = parts[0] || 'home';
  const aliases = {
    buscar: 'quadras',
    explorar: 'quadras',
    home: 'home',
    inicio: 'home',
    chat: 'mensagens',
    configurações: 'config',
    // Links antigos para ./login.html continuam valendo.
    login: 'entrar',
    registrar: 'cadastro'
  };
  const validRoutes = new Set([
    'home',
    'quadras',
    'mapa',
    'quadra',
    'pagamento',
    'confirmado',
    'reservas',
    'favoritos',
    'carteira',
    'perfil',
    'config',
    'mensagens',
    'game',
    'clube',
    'clubes',
    'entrar',
    'cadastro',
    'onboarding'
  ]);
  let name = aliases[first] || first;
  const params = {};

  if (name === 'quadra' || name === 'pagamento' || name === 'confirmado') {
    params.id = Number(parts[1] || 1);
  }
  if (name === 'mensagens') params.id = Number(parts[1] || 0);
  if (name === 'carteira' && parts[1]) {
    name = 'carteiraAcao';
    params.action = parts[1];
  }
  if (name !== 'carteiraAcao' && !validRoutes.has(name)) name = 'home';

  return {
    name,
    params,
    query: new URLSearchParams(queryValue),
    signature: `${name}:${parts.slice(1).join('/')}:${queryValue}`
  };
}

export function route(name, params = {}) {
  const base = ROUTES[name] || ROUTES.home;
  const query = new URLSearchParams(params).toString();
  return query ? `${base}?${query}` : base;
}
