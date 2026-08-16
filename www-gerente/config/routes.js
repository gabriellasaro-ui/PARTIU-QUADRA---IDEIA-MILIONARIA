export const ROUTES = {
  home: './dashboard.html',
  login: './login.html',
  dashboard: './dashboard.html',
  gerenteReservas: './dashboard.html#reservas',
  gerenteMensagens: './dashboard.html#mensagens',
  gerenteAgenda: './dashboard.html#agenda',
  gerenteFinanceiro: './dashboard.html#financeiro',
  gerenteQuadras: './dashboard.html#quadras',
  gerenteAvaliacoes: './dashboard.html#avaliacoes',
  gerenteConfig: './dashboard.html#config'
};

export function route(name, params = {}) {
  const base = ROUTES[name] || ROUTES.home;
  const query = new URLSearchParams(params).toString();
  return query ? `${base}?${query}` : base;
}
