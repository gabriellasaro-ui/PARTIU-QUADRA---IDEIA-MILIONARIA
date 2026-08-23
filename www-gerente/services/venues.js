import { API_BASE_URL } from '../config/constants.js';
import api from './api.js';
import storage from '../storage/storage.js';
import {
  CONVERSATIONS,
  CURRENT_USER,
  DEFAULT_AVAILABILITY,
  INITIAL_RESERVATIONS,
  SPORTS,
  VENUES,
  WALLET
} from '../config/mock-data.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

async function fromApiOrLocal(path, localValue) {
  if (!API_BASE_URL) return clone(localValue);
  return api.get(path);
}

export const venueService = {
  /* Estados e municipios (IBGE, embarcados no backend). Copiados do app do
     jogador porque o painel passou a pedir estado e cidade no perfil da arena
     — e campo livre produz "BH", "Belo Horizonte" e "belo horizonte" como tres
     cidades, com nenhum filtro fechando depois.

     Passa pelo mesmo `api` do resto: um fetch('/api/...') cru ignoraria o
     API_BASE_URL e quebraria no dia em que a API sair para outro dominio. */
  async estados() {
    if (!API_BASE_URL) return [];
    const data = await api.get('/api/localidades/estados', { auth: false });
    return data?.estados || [];
  },

  async cidadesDe(uf) {
    if (!API_BASE_URL || !uf) return [];
    const data = await api.get(`/api/localidades/estados/${encodeURIComponent(uf)}/cidades`, { auth: false });
    return data?.cidades || [];
  },
  async list(filters = {}) {
    const data = await fromApiOrLocal('/api/quadras', { quadras: VENUES });
    const venues = Array.isArray(data) ? data : (data?.quadras || []);
    const sport = String(filters.sport || '').trim();
    return venues
      .filter((venue) => !sport || venue.esporte === sport || venue.sport === sport)
      .sort((a, b) => (a.distancia || a.distance) - (b.distancia || b.distance));
  },

  async featured() {
    const data = await fromApiOrLocal('/api/quadras/destaques', {
      destaques: clone(VENUES).sort((a, b) => b.rating - a.rating).slice(0, 4)
    });
    return data?.destaques || [];
  },

  async get(id) {
    if (API_BASE_URL) {
      const data = await api.get(`/api/quadras/${id}`);
      return data?.quadra || data || null;
    }
    return clone(VENUES.find((venue) => venue.id === Number(id)) || null);
  },

  async sports() {
    if (API_BASE_URL) {
      const data = await api.get('/api/quadras/esportes');
      return data?.esportes || SPORTS;
    }
    return SPORTS;
  },

  async availability(id) {
    if (API_BASE_URL) {
      const data = await api.get(`/api/quadras/${id}/horarios`);
      return data?.horarios || DEFAULT_AVAILABILITY;
    }
    return clone(DEFAULT_AVAILABILITY);
  },

  async reservations() {
    if (API_BASE_URL) {
      const data = await api.get('/api/reservas');
      return data?.reservas || [];
    }
    return storage.get('reservations', clone(INITIAL_RESERVATIONS));
  },

  async saveReservation(reservation) {
    if (API_BASE_URL) return api.post('/api/reservas', reservation);
    const reservations = await this.reservations();
    const next = [reservation, ...reservations.filter((item) => item.code !== reservation.code)];
    storage.set('reservations', next);
    return clone(reservation);
  },

  async favoriteIds() {
    return storage.get('favorite_venues', [1, 2, 4]);
  },

  async favorites() {
    if (API_BASE_URL) {
      const data = await api.get('/api/favoritos');
      return data?.quadras || [];
    }
    const ids = await this.favoriteIds();
    return VENUES.filter((venue) => ids.includes(venue.id)).map(clone);
  },

  async toggleFavorite(id) {
    const venueId = Number(id);
    const ids = await this.favoriteIds();
    const active = ids.includes(venueId);
    const next = active ? ids.filter((item) => item !== venueId) : [...ids, venueId];
    storage.set('favorite_venues', next);
    return !active;
  },

  async conversations() {
    if (API_BASE_URL) {
      const data = await api.get('/api/mensagens?role=jogador');
      return data?.conversas || [];
    }
    return storage.get('conversations', clone(CONVERSATIONS));
  },

  /* Encerrar o atendimento. So a arena pode — o canal existe para resolver
     AQUELA reserva, e nao para virar linha direta por onde a proxima e
     combinada por fora da plataforma. */
  async encerrarConversa(conversationId) {
    if (!API_BASE_URL) return null;
    return api.post(`/api/mensagens/${conversationId}/encerrar`, {});
  },

  /* Bloquear a pessoa. Encerrar resolve UM atendimento; quando o problema e a
     pessoa, a proxima reserva abre outra conversa e a arena volta ao mesmo
     lugar. O bloqueio e so desta arena. */
  async bloquearPessoa(playerId, motivo) {
    if (!API_BASE_URL) return null;
    return api.post(`/api/mensagens/bloquear/${playerId}`, { motivo: motivo || null });
  },

  async desbloquearPessoa(playerId) {
    if (!API_BASE_URL) return null;
    return api.delete(`/api/mensagens/bloquear/${playerId}`);
  },

  async bloqueados() {
    if (!API_BASE_URL) return [];
    const data = await api.get('/api/mensagens/bloqueados');
    return data?.bloqueados || [];
  },

  async sendMessage(conversationId, text) {
    if (API_BASE_URL) {
      return api.post(`/api/mensagens/${conversationId}/enviar?texto=${encodeURIComponent(text)}&de=jogador`);
    }
    const conversations = await this.conversations();
    const conversation = conversations.find((item) => item.id === Number(conversationId));
    if (!conversation) return null;
    conversation.messages.push({
      from: 'player',
      text,
      time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    });
    storage.set('conversations', conversations);
    return clone(conversation);
  },

  async ensureConversationForVenue(venue) {
    const conversations = await this.conversations();
    let conversation = conversations.find((item) => Number(item.venueId) === Number(venue?.id));
    if (!conversation) {
      conversation = {
        id: conversations.reduce((max, item) => Math.max(max, item.id), 0) + 1,
        venueId: venue?.id,
        venue: venue?.name || 'Arena',
        subject: 'Reserva confirmada',
        messages: []
      };
      conversations.push(conversation);
      storage.set('conversations', conversations);
    }
    return clone(conversation);
  },

  async wallet() {
    return fromApiOrLocal('/api/carteira', WALLET);
  },

  async profile() {
    if (API_BASE_URL) return api.get('/api/perfil');
    return {
      ...clone(CURRENT_USER),
      ...storage.get('player_profile', {})
    };
  },

  async saveProfile(profile) {
    if (API_BASE_URL) return api.post('/api/perfil/salvar', profile);
    const current = await this.profile();
    const next = { ...current, ...clone(profile) };
    storage.set('player_profile', next);
    return clone(next);
  }
};

export default venueService;
