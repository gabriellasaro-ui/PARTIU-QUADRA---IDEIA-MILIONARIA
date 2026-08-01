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
    const session = await api.post('/auth/login', credentials, { auth: false });
    if (session?.token) storage.setAuthToken(session.token);
    if (session?.user) storage.setAuthUser(session.user);
    return session;
  },
  async logout() {
    try {
      await api.post('/auth/logout', {});
    } finally {
      storage.clearSession();
    }
  }
};

export default authService;
