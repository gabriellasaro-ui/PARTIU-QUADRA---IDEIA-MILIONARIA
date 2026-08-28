import api from './api.js';
import storage from '../storage/storage.js';

export const authService = {
  hasSession() {
    return Boolean(storage.getAuthToken());
  },
  currentUser() {
    return storage.getAuthUser();
  },
  async login(credentials) {
    const session = await api.post('/api/auth/login', credentials, { auth: false });
    if (session?.token) storage.setAuthToken(session.token);
    if (session?.refreshToken) storage.setAuthRefreshToken(session.refreshToken);
    if (session?.user) storage.setAuthUser(session.user);
    return session;
  },
  /* Troca a credencial do Google por sessao do painel.

     `contexto: 'gerente'` diz ao backend de qual porta veio o clique. Nao e
     permissao — quem decide o papel e o banco — mas muda a resposta a "esse
     e-mail nao tem conta": no app do jogador o certo e criar na hora; aqui o
     certo e mandar cadastrar a arena, porque conta de gerente precisa de CNPJ,
     endereco e aceite da comissao. Sem isso o dono clicava, "entrava", e
     ganhava em silencio uma conta de JOGADOR presa ao e-mail dele. */
  async exchangeGoogleCredential(credential) {
    const session = await api.post(
      '/api/auth/google',
      { idToken: credential.idToken, contexto: 'gerente' },
      { auth: false }
    );
    if (session?.token) storage.setAuthToken(session.token);
    if (session?.refreshToken) storage.setAuthRefreshToken(session.refreshToken);
    if (session?.user) storage.setAuthUser(session.user);
    return session;
  },

  async logout() {
    try {
      await api.post('/api/auth/logout', {});
    } finally {
      storage.clearSession();
    }
  }
};

export default authService;
