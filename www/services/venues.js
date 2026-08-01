import { API_BASE_URL } from '../config/constants.js';
import api from './api.js';
import storage from '../storage/storage.js';
import {
  ACTIVE_MATCH,
  CONVERSATIONS,
  CURRENT_USER,
  DEFAULT_AVAILABILITY,
  INITIAL_RESERVATIONS,
  SPORTS,
  FEATURED_SPORTS,
  VENUES,
  WALLET,
  CLUBS,
  PELADAS,
  CLUB_CHAT
} from '../config/mock-data.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

async function fromApiOrLocal(path, localValue) {
  if (!API_BASE_URL) return clone(localValue);
  return api.get(path);
}

function applyOverrides(venue) {
  if (!venue) return venue;
  const all = storage.get('venue_overrides', {});
  const patch = all[venue.id];
  return patch ? { ...venue, ...patch } : venue;
}

export const venueService = {
  /* ═══════════ Precos definidos pela arena ═══════════
     O gerente edita preco/hora e mensalidade; o resultado precisa aparecer
     para o jogador. Guardamos so o que mudou (override por id) em vez de
     copiar a quadra inteira: assim os demais campos continuam vindo da
     fonte e nao congelam numa foto antiga. */

  async venueOverrides() {
    return storage.get('venue_overrides', {});
  },

  async saveVenue(venue) {
    if (API_BASE_URL) return api.put(`/api/quadras/${venue.id}`, venue);
    const all = storage.get('venue_overrides', {});
    all[venue.id] = {
      ...(all[venue.id] || {}),
      price: Number(venue.price),
      priceMonthly: Number(venue.priceMonthly),
      active: venue.active !== false
    };
    storage.set('venue_overrides', all);
    return clone(all[venue.id]);
  },

  async list(filters = {}) {
    const data = await fromApiOrLocal('/api/quadras', { quadras: VENUES });
    const venues = Array.isArray(data) ? data : (data?.quadras || []);
    const sport = String(filters.sport || '').trim();
    return venues
      .filter((venue) => !sport || venue.esporte === sport || venue.sport === sport)
      .map(applyOverrides)
      .sort((a, b) => (a.distancia || a.distance) - (b.distancia || b.distance));
  },

  async featured() {
    const data = await fromApiOrLocal('/api/quadras/destaques', {
      destaques: clone(VENUES).sort((a, b) => b.rating - a.rating).slice(0, 4)
    });
    return (data?.destaques || []).map(applyOverrides);
  },

  async get(id) {
    if (API_BASE_URL) {
      const data = await api.get(`/api/quadras/${id}`);
      return data?.quadra || data || null;
    }
    return applyOverrides(clone(VENUES.find((venue) => venue.id === Number(id)) || null));
  },

  async featuredSports() {
    if (API_BASE_URL) {
      const data = await api.get('/api/quadras/esportes?destaque=1');
      return data?.esportes || FEATURED_SPORTS;
    }
    return FEATURED_SPORTS;
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
  },

  async getActiveMatch() {
    if (API_BASE_URL) return api.get('/api/partidas/ativa');
    const match = clone(ACTIVE_MATCH);
    const now = Date.now();
    if (match.phase === 'pre-game' && now >= match.startTimestamp) {
      match.phase = 'during-game';
    }
    if (match.phase === 'during-game' && now >= match.endTimestamp) {
      match.phase = 'post-game';
    }
    if (match.phase === 'during-game') {
      match.elapsedSeconds = Math.floor((now - match.startTimestamp) / 1000);
    }
    return match;
  },

  /* ═══════════ Clube ═══════════
     Mesmo padrao de reservations()/saveReservation(): API quando houver,
     localStorage enquanto nao houver. Os caminhos de API ja ficam declarados
     para o contrato existir antes do backend. */

  async clubs() {
    if (API_BASE_URL) {
      const data = await api.get('/api/clubes');
      return data?.clubes || [];
    }
    return storage.get('clubs', clone(CLUBS));
  },

  async myClub() {
    const user = await this.profile();
    const clubs = await this.clubs();
    return clubs.find((club) => club.members.some((m) => m.id === user.id)) || null;
  },

  async saveClub(club) {
    if (API_BASE_URL) return api.post('/api/clubes', club);
    const clubs = await this.clubs();
    const id = club.id || clubs.reduce((max, item) => Math.max(max, item.id), 0) + 1;
    const previous = clubs.find((c) => c.id === id);
    const next = [
      ...clubs.filter((c) => c.id !== id),
      { ...previous, ...club, id, members: club.members || previous?.members || [] }
    ];
    storage.set('clubs', next);
    return clone(next.find((c) => c.id === id));
  },

  async peladas(clubId) {
    if (API_BASE_URL) {
      const data = await api.get('/api/peladas');
      return data?.peladas || [];
    }
    const all = storage.get('peladas', clone(PELADAS));
    if (clubId === undefined || clubId === null) return all;
    return all.filter((p) => p.clubId === Number(clubId));
  },

  async savePelada(pelada) {
    if (API_BASE_URL) return api.post('/api/peladas', pelada);
    const list = await this.peladas();
    const id = pelada.id || list.reduce((max, item) => Math.max(max, item.id), 0) + 1;
    const next = [...list.filter((p) => p.id !== id), { ...pelada, id }];
    storage.set('peladas', next);
    return clone(next.find((p) => p.id === id));
  },

  async clubChat(clubId) {
    if (API_BASE_URL) {
      const data = await api.get(`/api/clubes/${clubId}/mensagens`);
      return data?.mensagens || [];
    }
    const all = storage.get('club_chat', clone(CLUB_CHAT));
    return all.filter((m) => m.clubId === Number(clubId));
  },

  async sendClubMessage(clubId, message) {
    if (API_BASE_URL) return api.post(`/api/clubes/${clubId}/mensagens`, message);
    const all = storage.get('club_chat', clone(CLUB_CHAT));
    const next = [...all, { ...message, clubId: Number(clubId) }];
    storage.set('club_chat', next);
    return clone(message);
  },

  async setPeladaAttendance(peladaId, memberId, value) {
    if (API_BASE_URL) return api.post(`/api/peladas/${peladaId}/presenca`, { memberId, value });
    const list = await this.peladas();
    const item = list.find((p) => p.id === Number(peladaId));
    if (!item) return null;
    item.attendance = { ...item.attendance, [memberId]: value };
    storage.set('peladas', list);
    return clone(item);
  },

  async confirmPresence(id) {
    if (API_BASE_URL) return api.post(`/api/partidas/${id}/confirmar`);
    return { ok: true };
  },

  async notifyDelay(id, minutes) {
    if (API_BASE_URL) return api.post(`/api/partidas/${id}/atraso`, { minutes });
    return { ok: true };
  }
};

export default venueService;
