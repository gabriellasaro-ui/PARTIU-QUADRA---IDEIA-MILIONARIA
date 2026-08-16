import { API_BASE_URL } from '../config/constants.js';
import api from './api.js';

/* Notificacoes in-app (Fase 7) + badges do nav. Sem API, tudo vira zero:
   o fallback mock nao tem esse dado ainda. */

const EMPTY_BADGES = { solicitacoes: 0, msg_jog: 0, msg_ger: 0 };

export const notificationService = {
  async list(limite = 50, offset = 0) {
    if (!API_BASE_URL) return [];
    const data = await api.get(`/api/notifications?limite=${limite}&offset=${offset}`);
    return data?.notificacoes || [];
  },

  async unreadCount() {
    if (!API_BASE_URL) return 0;
    const data = await api.get('/api/notifications/unread-count');
    return data?.unread || 0;
  },

  async markRead(id) {
    if (!API_BASE_URL) return null;
    return api.post(`/api/notifications/${id}/read`);
  },

  async markAllRead() {
    if (!API_BASE_URL) return null;
    return api.post('/api/notifications/read-all');
  },

  async navBadges(role = 'jogador') {
    if (!API_BASE_URL) return { ...EMPTY_BADGES };
    try {
      const data = await api.get(`/api/mensagens/nav/badges?role=${role}`);
      return data || { ...EMPTY_BADGES };
    } catch (error) {
      return { ...EMPTY_BADGES };
    }
  },

  /* Preenche os baloes do nav (topbar desktop + sidebar). Reservas conta as
     em andamento (group=proxima); mensagens vem do badge do backend. */
  async refreshNavBadges(role = 'jogador') {
    if (!API_BASE_URL) return EMPTY_BADGES;
    const [badges, reservas] = await Promise.all([
      this.navBadges(role),
      api.get('/api/reservas').catch(() => ({ reservas: [] }))
    ]);
    const reservasCount = (reservas?.reservas || []).filter((r) => r.group === 'proxima').length;
    const msgCount = role === 'gerente' ? badges.msg_ger : badges.msg_jog;

    const reservasEls = document.querySelectorAll(
      '[data-nav-page="reservas"] .web-nav__count, [data-nav-page="reservas"] .badge'
    );
    const msgEls = document.querySelectorAll(
      '[data-nav-page="mensagens"] .web-action-dot, [data-nav-page="mensagens"] .badge'
    );

    reservasEls.forEach((el) => {
      el.hidden = !reservasCount;
      el.textContent = String(reservasCount);
    });
    msgEls.forEach((el) => {
      el.hidden = !msgCount;
      el.textContent = String(msgCount);
    });
    return { ...badges, reservas: reservasCount };
  }
};

export default notificationService;
