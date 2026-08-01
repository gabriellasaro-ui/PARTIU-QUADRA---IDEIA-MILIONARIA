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
