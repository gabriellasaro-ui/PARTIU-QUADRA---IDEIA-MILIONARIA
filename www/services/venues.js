import { API_BASE_URL } from '../config/constants.js';
import api from './api.js';
import storage from '../storage/storage.js';
import authService from './auth.js';
import { mesAno } from '../utils/formatters.js';
import {
  ACTIVE_MATCH,
  CONVERSATIONS,
  CURRENT_USER,
  INITIAL_RESERVATIONS,
  SPORTS,
  FEATURED_SPORTS,
  OTHER_SPORTS,
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

/* Destaque pago vale ate a data gravada pelo painel do gerente. */
function boostAtivo(venue) {
  return Boolean(venue?.boosted && venue.boostedUntil && new Date(venue.boostedUntil) > new Date());
}

function applyOverrides(venue) {
  if (!venue) return venue;
  const all = storage.get('venue_overrides', {});
  const patch = all[venue.id];
  return patch ? { ...venue, ...patch } : venue;
}

/* Local escolhido pela pessoa. Fica no aparelho: e "de onde estou buscando
   agora", nao um dado de cadastro — quem viaja muda a busca sem mexer no
   perfil. */
const CHAVE_LOCAL = 'player_local';
const CHAVE_CLUBE_ATIVO = 'clube_ativo';

export function localEscolhido() {
  return storage.get(CHAVE_LOCAL, null);
}

export function definirLocal(local) {
  storage.set(CHAVE_LOCAL, local || null);
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

  /* Cidades onde ha quadra cadastrada. E o que alimenta o seletor de local:
     a lista do IBGE tem 5.571 municipios e quase nenhum tem quadra. */
  /* Traduz coordenada em bairro/cidade usando as arenas cadastradas. Se o
     lugar conhecido mais proximo estiver longe demais, quem chama decide
     nao usar — por isso a distancia volta junto. */
  async localDeCoordenada(lat, lng) {
    if (!API_BASE_URL) return null;
    const data = await api.get(`/api/quadras/proximo?lat=${lat}&lng=${lng}`, { auth: false });
    return data?.local || null;
  },

  async cidadesComQuadra() {
    if (!API_BASE_URL) return [];
    const data = await api.get('/api/quadras/cidades', { auth: false });
    return data?.cidades || [];
  },

  async list(filters = {}) {
    /* Sem lat/lng a API mede distancia a partir do centro de Goiania, entao
       trocar de cidade nao mudava a ordem nem os quilometros. */
    const local = filters.local || localEscolhido();
    const busca = local?.lat != null
      ? `/api/quadras?lat=${local.lat}&lng=${local.lng}`
      : '/api/quadras';
    const data = await fromApiOrLocal(busca, { quadras: VENUES });
    const venues = Array.isArray(data) ? data : (data?.quadras || []);
    const sport = String(filters.sport || '').trim();
    // "outros" e um filtro por exclusao: tudo que nao esta em destaque.
    const matches = (venue) => {
      if (!sport) return true;
      const nome = venue.esporte || venue.sport;
      if (sport === 'outros') return OTHER_SPORTS.includes(nome);
      return nome === sport;
    };
    return venues
      .filter(matches)
      .map(applyOverrides)
      /* Turbinada primeiro, depois melhor avaliada, distancia so desempata.
         Antes era so distancia, entao a quadra ruim da esquina ganhava da
         otima a 400m. Como e no servico e nao na tela, mapa e favoritos
         herdam a regra.

         O turbinado tem prazo: uma arena que parou de pagar volta para a
         ordem normal sozinha, sem ninguem precisar limpar nada. */
      .sort((a, b) => Number(boostAtivo(b)) - Number(boostAtivo(a))
        || (b.rating || 0) - (a.rating || 0)
        || (a.distancia || a.distance) - (b.distancia || b.distance));
  },

  async featured() {
    /* Manda a coordenada do local escolhido, igual list(). Sem ela o servidor
       media a distancia a partir do centro de Goiania, e a Home mostrava
       "3,8 km" para uma arena a 600 km de quem estava olhando. */
    const local = localEscolhido();
    const busca = local?.lat != null
      ? `/api/quadras/destaques?lat=${local.lat}&lng=${local.lng}`
      : '/api/quadras/destaques';
    const data = await fromApiOrLocal(busca, {
      destaques: clone(VENUES).sort((a, b) => b.rating - a.rating).slice(0, 4)
    });
    return (data?.destaques || []).map(applyOverrides);
  },

  async get(id) {
    if (API_BASE_URL) {
      const data = await api.get(`/api/quadras/${id}`);
      return data?.quadra || data || null;
    }
    return applyOverrides(clone(VENUES.find((venue) => String(venue.id) === String(id)) || null));
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

  /* A data e obrigatoria no uso real: sem ela a API responde sempre HOJE, e
     era isso que fazia a tela de outro dia mostrar disponibilidade errada. */
  /* Agenda da quadra. SEM fallback de mock, em nenhum caminho.

     Havia dois: `|| DEFAULT_AVAILABILITY` quando a resposta vinha vazia, e o
     mock inteiro quando nao ha API. Os dois enchiam a tela com uma agenda
     INVENTADA — horarios livres que nao existem, ocupados que nao existem —
     e a pessoa escolhia um deles achando que estava reservando. O erro so
     apareceria no POST, depois de ela ter escolhido dia, hora e duracao.

     Agenda e o unico dado desta tela que nao admite palpite: ou e a agenda
     real da quadra naquela data, ou nao ha horario para mostrar. Lista vazia
     e honesta; agenda falsa nao. */
  async availability(id, date) {
    if (!API_BASE_URL) return [];
    const query = date ? `?data=${encodeURIComponent(date)}` : '';
    const data = await api.get(`/api/quadras/${id}/horarios${query}`);
    return Array.isArray(data?.horarios) ? data.horarios : [];
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

  /* Preco server-side do checkout. A estimativa local continua como fallback
     visual; na hora de confirmar o servidor manda. */
  async quote(payload) {
    if (API_BASE_URL) {
      const data = await api.post('/api/reservas/quote', payload);
      const q = data?.quote || {};
      return {
        subtotal: (q.subtotal_cents || 0) / 100,
        serviceFee: (q.service_fee_cents || 0) / 100,
        total: (q.total_cents || 0) / 100,
        validUntil: data?.validUntil || null
      };
    }
    return null;
  },

  async favoriteIds() {
    if (API_BASE_URL) {
      const data = await api.get('/api/favoritos');
      return (data?.quadras || []).map((q) => String(q.id));
    }
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

  /* Favorito e da ARENA, nao da quadra: e assim que o banco guarda
     (user_favorites.arena_id) e e o que /api/favoritos/{id} espera. O front
     mandava o id da quadra e levava 404 "Arena nao encontrada" em todo
     clique — o coracao piscava e nada era salvo.

     A marcacao visual continua por quadra porque o GET devolve todas as
     quadras das arenas favoritadas; so o toggle precisa da arena. */
  async toggleFavorite(arenaId) {
    if (API_BASE_URL) {
      const data = await api.get('/api/favoritos');
      const active = (data?.quadras || []).some((q) => String(q.arenaId) === String(arenaId));
      if (active) {
        await api.delete(`/api/favoritos/${arenaId}`);
        return false;
      }
      await api.post(`/api/favoritos/${arenaId}`);
      return true;
    }
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
    const conversation = conversations.find((item) => String(item.id) === String(conversationId));
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
    let conversation = conversations.find((item) => String(item.venueId) === String(venue?.id));
    if (!conversation && API_BASE_URL) return null;
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
    /* Campos derivados NAO vem do override. Em aparelhos que ja editaram o
       perfil antes desta correcao, player_profile guarda o objeto inteiro e
       congelaria stats e nota para sempre. Descartar na leitura desentala
       esses aparelhos sem jogar fora nome, cidade e telefone, que a pessoa
       realmente editou. */
    const { stats, memberSince, rating, ...override } = storage.get('player_profile', {});
    return {
      ...clone(CURRENT_USER),
      // A sessao manda no que e identidade: quem entrou e quem esta aqui.
      ...(authService.currentUser() || {}),
      ...override
    };
  },

  /* Estados e municipios (dados do IBGE embarcados no backend). Passa pelo
     mesmo `api` do resto: um fetch('/api/...') cru ignora API_BASE_URL e
     quebra no dia em que a API estiver em outro dominio. */
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

  /* Exclusao de conta. Sem fallback local de proposito: sem API nao ha o que
     excluir, e fingir que excluiu seria pior que recusar. */
  /* `senha` obrigatoria para conta com senha local. Conta Google nao tem
     senha aqui, e o backend dispensa nesse caso. */
  /* Troca de senha. Exige a ATUAL mesmo com sessao valida: o token sobrevive
     dias, e celular destravado na mao de outra pessoa nao pode virar troca de
     senha — que e o jeito de tomar a conta de alguem para sempre. */
  async trocarSenha(senhaAtual, senhaNova) {
    if (!API_BASE_URL) throw new Error('Indisponível sem a API');
    return api.post('/api/auth/senha', { senhaAtual, senhaNova });
  },

  async deleteAccount(senha = null) {
    if (!API_BASE_URL) throw new Error('Exclusão de conta indisponível sem a API');
    return api.delete('/api/perfil', senha ? { body: { senha } } : undefined);
  },

  async saveProfile(patch) {
    if (API_BASE_URL) return api.patch('/api/perfil', patch);
    /* So o patch, nunca o objeto inteiro — o mesmo cuidado que saveVenue ja
       toma de proposito. Gravando tudo, stats/memberSince/favoriteSport
       viravam copia congelada na primeira edicao e mudanca no catalogo nunca
       mais aparecia. */
    storage.set('player_profile', { ...storage.get('player_profile', {}), ...clone(patch) });
    // A topbar e a saudacao leem da sessao; sem isto ficam com o nome velho.
    authService.updateSessionUser(patch);
    return this.profile();
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

  /* Todos os clubes da pessoa. */
  async myClubs() {
    if (API_BASE_URL) {
      try {
        const data = await api.get('/api/clubes/meus');
        return data?.clubes || [];
      } catch (error) {
        /* Backend anterior a esta rota responde 404, e a tela do clube inteira
           morria em "Nao foi possivel carregar" — sem dizer por que. Durante
           uma janela de deploy (app novo, servidor ainda antigo) isso derruba
           uma tela que tem como funcionar: da para chegar no mesmo resultado
           filtrando a lista geral. Mais lento, mas vivo. */
        const user = await this.profile();
        const clubs = await this.clubs();
        return clubs.filter((club) => club.members?.some((m) => m.id === user.id));
      }
    }
    const user = await this.profile();
    const clubs = await this.clubs();
    return clubs.filter((club) => club.members.some((m) => m.id === user.id));
  },

  /* O clube ATIVO — o que a tela esta mostrando agora.

     A assinatura nao mudou de proposito: renderClub, o formulario, o chat e a
     pelada continuam chamando myClub() como antes. O que mudou e o
     significado, agora que a pessoa participa de varios: em vez de "o unico
     clube dela", e "aquele em que ela esta". A escolha vive no aparelho, e nao
     no servidor — e preferencia de navegacao, nao dado de conta.

     Se o clube guardado sumiu (a pessoa saiu, ou o dono apagou), cai no
     primeiro da lista em vez de devolver nada: uma tela vazia com clubes
     existentes seria pior do que mostrar outro. */
  async myClub() {
    const clubs = await this.myClubs();
    if (!clubs.length) return null;
    const escolhido = storage.get(CHAVE_CLUBE_ATIVO, null);
    return clubs.find((c) => String(c.id) === String(escolhido)) || clubs[0];
  },

  definirClubeAtivo(clubId) {
    storage.set(CHAVE_CLUBE_ATIVO, clubId ? String(clubId) : null);
  },

  /* Configuracao do clube: modo de entrada e limite de membros. */
  async clubConfig(clubId, { joinMode, maxMembers } = {}) {
    const atual = await this.clubByIdLocal(clubId);
    if (!atual) throw new Error('Clube não encontrado.');
    return this.saveClub({
      id: clubId,
      name: atual.name,
      sport: atual.sport,
      city: atual.city,
      state: atual.state || null,
      description: atual.description || '',
      ...(joinMode ? { joinMode } : {}),
      ...(maxMembers ? { maxMembers: Number(maxMembers) } : {})
    });
  },

  async clubByIdLocal(clubId) {
    const clubs = await this.myClubs();
    return clubs.find((c) => String(c.id) === String(clubId)) || null;
  },

  /* Fila de quem pediu para entrar. So a gestao enxerga. */
  /* Marca o mural como lido. Rota propria: o GET das mensagens NAO marca,
     porque o aviso persistente precisa sobreviver ao carregamento da tela e
     sumir so quando a pessoa abre a aba de conversa. */
  async markClubChatRead(clubId) {
    if (!API_BASE_URL || !clubId) return null;
    return api.post(`/api/clubes/${clubId}/mensagens/read`, {});
  },

  async clubRequests(clubId) {
    if (!API_BASE_URL) return [];
    const data = await api.get(`/api/clubes/${clubId}/solicitacoes`);
    return data?.solicitacoes || [];
  },

  async decideRequest(clubId, requestId, aprovar) {
    if (!API_BASE_URL) return { ok: true };
    const acao = aprovar ? 'aprovar' : 'recusar';
    return api.post(`/api/clubes/${clubId}/solicitacoes/${requestId}/${acao}`, {});
  },

  async setMemberRole(clubId, memberId, role) {
    if (!API_BASE_URL) return null;
    const data = await api.post(`/api/clubes/${clubId}/membros/${memberId}/cargo`, { role });
    return data?.clube || null;
  },

  async saveClub(club) {
    if (API_BASE_URL) {
      /* A rota responde {clube:{...}}, e nao o clube direto. Devolver o
         envelope cru fazia `saved.name` chegar undefined em quem chamou — o
         aviso de sucesso dizia "undefined criado!" e nenhum campo do clube
         recem-criado era utilizavel. */
      const data = await api.post('/api/clubes', club);
      return data?.clube || data;
    }
    const clubs = await this.clubs();
    const id = club.id || clubs.reduce((max, item) => Math.max(max, item.id), 0) + 1;
    const previous = clubs.find((c) => c.id === id);
    const next = [
      ...clubs.filter((c) => c.id !== id),
      {
        ...previous,
        ...club,
        id,
        members: club.members || previous?.members || [],
        // So na criacao. Regerar na edicao invalidaria convites ja mandados.
        code: previous?.code || club.code || this.generateClubCode(clubs)
      }
    ];
    storage.set('clubs', next);
    return clone(next.find((c) => c.id === id));
  },

  /* Codigo de convite. 6 caracteres, exibido XXX-XXX.

     O alfabeto exclui I, L, O, 0 e 1 de proposito: sao os pares que se
     confundem falados e escritos, e este codigo vai ser ditado em voz alta
     num grupo de WhatsApp. 31^6 da ~887 milhoes de combinacoes.

     Guardado SEM hifen — o hifen e formatacao, nao dado. Se entrasse no
     valor, a busca teria que normalizar em dois lugares. */
  generateClubCode(existentes = []) {
    const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const usados = new Set(existentes.map((c) => c.code).filter(Boolean));
    for (let tentativa = 0; tentativa < 50; tentativa += 1) {
      let code = '';
      for (let i = 0; i < 6; i += 1) {
        code += ALFABETO[Math.floor(Math.random() * ALFABETO.length)];
      }
      if (!usados.has(code)) return code;
    }
    return `C${Date.now().toString(36).slice(-5).toUpperCase()}`;
  },

  async clubByCode(code) {
    if (API_BASE_URL) {
      const data = await api.get(`/api/clubes?codigo=${encodeURIComponent(code)}`);
      return data?.clube || null;
    }
    const alvo = String(code || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const clubs = await this.clubs();
    return clone(clubs.find((c) => c.code === alvo)) || null;
  },

  /* O membro nasce do PERFIL: posicao e nota vem de quem a pessoa e, nao de
     um valor escrito na mao na hora de entrar. */
  async joinClub(clubId, codigo = null) {
    if (API_BASE_URL) {
      /* A resposta tem duas formas: {clube} quando entrou, e
         {status:"pendente", clube} quando o clube pede aprovacao. Quem chamou
         precisa distinguir — dizer "voce entrou" para quem so entrou na fila
         seria mentira, e a pessoa ficaria esperando um acesso que nao veio. */
      const data = await api.post(`/api/clubes/${clubId}/entrar`, codigo ? { codigo } : {});
      return { pendente: data?.status === 'pendente', clube: data?.clube || data || null };
    }
    const [clubs, user] = await Promise.all([this.clubs(), this.profile()]);
    const club = clubs.find((c) => c.id === Number(clubId));
    if (!club) throw new Error('Clube não encontrado.');
    if (club.members.some((m) => m.id === user.id)) return { pendente: false, clube: clone(club) };

    const membro = {
      id: user.id,
      name: user.name,
      role: 'membro',
      position: user.position || 'Jogador',
      rating: user.rating ?? null,
      since: mesAno()
    };
    const next = clubs.map((c) => (c.id === club.id ? { ...c, members: [...c.members, membro] } : c));
    storage.set('clubs', next);
    return { pendente: false, clube: clone(next.find((c) => c.id === club.id)) };
  },

  async leaveClub(clubId) {
    if (API_BASE_URL) return api.post(`/api/clubes/${clubId}/sair`, {});
    const [clubs, user] = await Promise.all([this.clubs(), this.profile()]);
    const club = clubs.find((c) => c.id === Number(clubId));
    if (!club) return null;
    const restantes = club.members.filter((m) => m.id !== user.id);
    // Sair sendo o ultimo apaga o clube: um grupo sem ninguem nao e grupo,
    // e ficaria orfao aparecendo na busca dos outros para sempre.
    if (!restantes.length) return this.deleteClub(clubId, { force: true });
    storage.set('clubs', clubs.map((c) => (c.id === club.id ? { ...c, members: restantes } : c)));
    return { ok: true };
  },

  /* So o dono, e so com o clube vazio — a regra que o dono do produto
     definiu. O force existe para o caminho do ultimo membro saindo, que ja
     satisfaz a regra por outro caminho. */
  async deleteClub(clubId, { force = false } = {}) {
    if (API_BASE_URL) return api.delete(`/api/clubes/${clubId}`);
    const [clubs, user] = await Promise.all([this.clubs(), this.profile()]);
    const club = clubs.find((c) => c.id === Number(clubId));
    if (!club) return { ok: true };
    if (!force) {
      const euSouDono = club.members.some((m) => m.id === user.id && m.role === 'dono');
      if (!euSouDono) throw new Error('Só quem criou o clube pode apagar.');
      if (club.members.length > 1) {
        throw new Error('Remova os outros membros antes de apagar o clube.');
      }
    }
    storage.set('clubs', clubs.filter((c) => c.id !== club.id));
    // Cascata: pelada de clube e conversa nao sobrevivem ao clube.
    const peladas = await this.peladas();
    storage.set('peladas', peladas.filter((p) => p.clubId !== club.id));
    const chat = storage.get('club_chat', clone(CLUB_CHAT));
    storage.set('club_chat', chat.filter((m) => m.clubId !== club.id));
    return { ok: true };
  },

  /* Sem isto a regra "apagar so se vazio" deixaria o clube indeletavel para
     sempre: nao haveria como esvaziar. */
  async removeMember(clubId, memberId) {
    if (API_BASE_URL) return api.delete(`/api/clubes/${clubId}/membros/${memberId}`);
    const [clubs, user] = await Promise.all([this.clubs(), this.profile()]);
    const club = clubs.find((c) => c.id === Number(clubId));
    if (!club) return null;
    if (!club.members.some((m) => m.id === user.id && m.role === 'dono')) {
      throw new Error('Só quem criou o clube pode remover membros.');
    }
    if (memberId === user.id) throw new Error('Você não pode remover a si mesmo.');
    storage.set('clubs', clubs.map((c) => (
      c.id === club.id ? { ...c, members: c.members.filter((m) => m.id !== memberId) } : c
    )));
    return { ok: true };
  },

  async peladas(clubId) {
    if (API_BASE_URL) {
      const data = await api.get('/api/peladas');
      return data?.peladas || [];
    }
    /* Sem API nao ha pelada de verdade. Devolver a lista de exemplo faria a
       tela prometer jogos que ninguem marcou — o mesmo erro da agenda. */
    return [];
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
    return [];
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
