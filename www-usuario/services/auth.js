/* Sessao do jogador — a API publica, que nao muda quando o backend chegar.

   Tres camadas, de proposito:
     google-auth.js  -> o handshake com o Google (a unica descartavel)
     auth-mock.js    -> o backend fingido enquanto nao ha API
     auth.js         -> o que o resto do app enxerga

   Cada funcao segue o mesmo padrao de services/venues.js: se API_BASE_URL
   estiver preenchida vai para a rede, senao cai no mock. Quando a API subir,
   ninguem fora daqui precisa mudar uma linha.

   A sessao mora em pq:auth_token e pq:auth_user (storage/storage.js aplica o
   prefixo). Antes disto o ui.js lia "auth_token" cru e os dois lados nunca
   se enxergavam. */
import { API_BASE_URL } from '../config/constants.js';
import api from './api.js';
import storage from '../storage/storage.js';
import authMock from './auth-mock.js';
import { requestGoogleCredential } from './google-auth.js';

/* Um so lugar escreve a sessao. Devolve para o chamador poder encadear. */
function persistir(session) {
  if (session?.token) storage.setAuthToken(session.token);
  if (session?.refreshToken) storage.setAuthRefreshToken(session.refreshToken);
  if (session?.user) storage.setAuthUser(session.user);
  return session;
}

export const authService = {
  hasSession() {
    return Boolean(storage.getAuthToken());
  },

  currentUser() {
    return storage.getAuthUser();
  },

  /* Devolve { token, user, isNew }. O isNew decide se a pessoa vai para o
     onboarding ou direto para onde estava indo. */
  async login(credentials) {
    const email = credentials?.email;
    // O backend usa "senha" (backend/app/schemas/auth.py), o formulario usa
    // "password". Alinhado aqui em vez de na hora da integracao, que e
    // quando esse tipo de coisa vira bug chato de achar.
    const senha = credentials?.senha ?? credentials?.password;
    const session = API_BASE_URL
      ? await api.post('/api/auth/login', { email, senha }, { auth: false })
      : await authMock.login({ email, senha });
    return persistir(session);
  },

  async register({ name, email, senha, password }) {
    const session = API_BASE_URL
      ? await api.post('/api/auth/register', { name, email, senha: senha ?? password }, { auth: false })
      : await authMock.register({ name, email });
    return persistir(session);
  },

  /* Duas etapas separadas: pegar a credencial do Google, e trocar ela por
     uma sessao nossa. E esse corte que permite trocar so a primeira quando
     os client IDs existirem. */
  async loginWithGoogle() {
    const credential = await requestGoogleCredential();
    const session = API_BASE_URL
      ? await api.post('/api/auth/google', { idToken: credential.idToken }, { auth: false })
      : await authMock.google(credential);
    return persistir(session);
  },

  async logout() {
    try {
      if (API_BASE_URL) await api.post('/api/auth/logout', {});
    } finally {
      storage.clearSession();
      window.dispatchEvent(new CustomEvent('pq:auth-logout'));
    }
  },

  /* Entrou mas ainda nao disse posicao e nivel. */
  needsOnboarding() {
    const user = this.currentUser();
    return Boolean(user) && !user.onboardedAt;
  },

  async completeOnboarding({ position, level }) {
    const patch = { position, level, onboardedAt: new Date().toISOString() };
    if (API_BASE_URL) {
      const user = await api.patch('/api/auth/onboarding', patch);
      storage.setAuthUser(user);
      return user;
    }
    const user = await authMock.patchUser(this.currentUser() || {}, patch);
    storage.setAuthUser(user);
    return user;
  },

  /* Mantem o usuario da sessao em dia quando o perfil e editado — senao a
     topbar e a saudacao ficam com o nome velho ate o proximo login. */
  updateSessionUser(patch) {
    const user = this.currentUser();
    if (!user) return null;
    const next = { ...user, ...patch };
    storage.setAuthUser(next);
    return next;
  }
};

export default authService;
