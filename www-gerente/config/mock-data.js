// Dados locais temporarios. A futura API FastAPI substituira este arquivo
// sem alterar as paginas ou os componentes visuais.
export const SPORTS = [
  'Futebol Society',
  'Beach Tennis',
  'Volei',
  'Basquete',
  'Tenis',
  'Futsal'
];

/* A home mostra so os esportes mais jogados — o rail nao e um indice, e um
   atalho. Beach Tennis e Basquete continuam em SPORTS e seguem achaveis por
   "Ver todos" e pelos filtros de Explorar. */
export const FEATURED_SPORTS = [
  'Futebol Society',
  'Futsal',
  'Volei'
];

/* O foco e futebol, mas as outras quadras nao somem do app: caem em "Outros",
   que filtra por exclusao. Sem isso, Beach Point, Top Spin e Cesta Cheia
   ficariam sem nenhuma porta de entrada por esporte. */
export const OTHER_SPORTS = SPORTS.filter((sport) => !FEATURED_SPORTS.includes(sport));

export const VENUES = [
  {
    id: 1,
    name: 'Arena Bola na Rede',
    sport: 'Futebol Society',
    neighborhood: 'Jardim Goias',
    distance: 1.2,
    rating: 4.8,
    reviews: 214,
    price: 120,
    priceMonthly: 408,
    image: 'https://images.unsplash.com/photo-1556056504-5c7696c4c28d?auto=format&fit=crop&w=900&q=80',
    gallery: [
      'https://images.unsplash.com/photo-1556056504-5c7696c4c28d?auto=format&fit=crop&w=1200&q=82',
      'https://images.unsplash.com/photo-1577223625816-7546f13df25d?auto=format&fit=crop&w=900&q=80',
      'https://images.unsplash.com/photo-1459865264687-595d652de67e?auto=format&fit=crop&w=900&q=80'
    ],
    tags: ['Grama sintetica', 'Iluminada', 'Vestiario'],
    map: { x: 58, y: 42, lat: -16.7060, lng: -49.2350 }
  },
  {
    id: 2,
    name: 'Beach Point Arena',
    sport: 'Beach Tennis',
    neighborhood: 'Setor Bueno',
    distance: 2.5,
    rating: 4.9,
    reviews: 388,
    price: 90,
    priceMonthly: 306,
    image: 'https://images.unsplash.com/photo-1626224583764-f87db24ac4ea?auto=format&fit=crop&w=900&q=80',
    gallery: [
      'https://images.unsplash.com/photo-1626224583764-f87db24ac4ea?auto=format&fit=crop&w=1200&q=82',
      'https://images.unsplash.com/photo-1612872087720-bb876e2e67d1?auto=format&fit=crop&w=900&q=80',
      'https://images.unsplash.com/photo-1592656094267-764a45160876?auto=format&fit=crop&w=900&q=80'
    ],
    tags: ['Areia', 'Coberta', 'Bar'],
    map: { x: 29, y: 56, lat: -16.7050, lng: -49.2770 }
  },
  {
    id: 3,
    name: 'Quadra do Ze',
    sport: 'Futsal',
    neighborhood: 'Setor Sul',
    distance: 0.8,
    rating: 4.5,
    reviews: 97,
    price: 80,
    priceMonthly: 272,
    image: 'https://images.unsplash.com/photo-1577223625816-7546f13df25d?auto=format&fit=crop&w=900&q=80',
    gallery: [
      'https://images.unsplash.com/photo-1577223625816-7546f13df25d?auto=format&fit=crop&w=1200&q=82',
      'https://images.unsplash.com/photo-1556056504-5c7696c4c28d?auto=format&fit=crop&w=900&q=80',
      'https://images.unsplash.com/photo-1546519638-68e109498ffc?auto=format&fit=crop&w=900&q=80'
    ],
    tags: ['Piso oficial', 'Coberta', 'Vestiario'],
    map: { x: 51, y: 62, lat: -16.6870, lng: -49.2620 }
  },
  {
    id: 4,
    name: 'Volei Sand Club',
    sport: 'Volei',
    neighborhood: 'Setor Oeste',
    distance: 3.4,
    rating: 4.7,
    reviews: 142,
    price: 70,
    priceMonthly: 238,
    image: 'https://images.unsplash.com/photo-1612872087720-bb876e2e67d1?auto=format&fit=crop&w=900&q=80',
    gallery: [
      'https://images.unsplash.com/photo-1612872087720-bb876e2e67d1?auto=format&fit=crop&w=1200&q=82',
      'https://images.unsplash.com/photo-1626224583764-f87db24ac4ea?auto=format&fit=crop&w=900&q=80',
      'https://images.unsplash.com/photo-1592656094267-764a45160876?auto=format&fit=crop&w=900&q=80'
    ],
    tags: ['Areia', 'Estacionamento', 'Bar'],
    map: { x: 37, y: 31, lat: -16.6780, lng: -49.2720 }
  },
  {
    id: 5,
    name: 'Top Spin Tenis',
    sport: 'Tenis',
    neighborhood: 'Alto da Gloria',
    distance: 4.1,
    rating: 4.6,
    reviews: 73,
    price: 110,
    priceMonthly: 374,
    image: 'https://images.unsplash.com/photo-1595435934249-5df7ed86e1c0?auto=format&fit=crop&w=900&q=80',
    gallery: [
      'https://images.unsplash.com/photo-1595435934249-5df7ed86e1c0?auto=format&fit=crop&w=1200&q=82',
      'https://images.unsplash.com/photo-1592656094267-764a45160876?auto=format&fit=crop&w=900&q=80',
      'https://images.unsplash.com/photo-1626224583764-f87db24ac4ea?auto=format&fit=crop&w=900&q=80'
    ],
    tags: ['Saibro', 'Iluminada', 'Aulas'],
    map: { x: 71, y: 68, lat: -16.7150, lng: -49.2470 }
  },
  {
    id: 6,
    name: 'Cesta Cheia Basquete',
    sport: 'Basquete',
    neighborhood: 'Setor Marista',
    distance: 4.8,
    rating: 4.4,
    reviews: 51,
    price: 75,
    priceMonthly: 255,
    image: 'https://images.unsplash.com/photo-1546519638-68e109498ffc?auto=format&fit=crop&w=900&q=80',
    gallery: [
      'https://images.unsplash.com/photo-1546519638-68e109498ffc?auto=format&fit=crop&w=1200&q=82',
      'https://images.unsplash.com/photo-1577223625816-7546f13df25d?auto=format&fit=crop&w=900&q=80',
      'https://images.unsplash.com/photo-1556056504-5c7696c4c28d?auto=format&fit=crop&w=900&q=80'
    ],
    tags: ['Coberta', 'Arquibancada', 'Vestiario'],
    map: { x: 63, y: 25, lat: -16.6950, lng: -49.2650 }
  }
];

// TODO: substituir avaliações mockadas por GET /quadras/{id}/avaliacoes.
const REVIEW_FIXTURES = [
  {
    author: 'Mariana Alves',
    date: 'Há 2 semanas',
    rating: 5,
    text: 'Quadra muito bem cuidada, iluminação ótima e atendimento rápido.'
  },
  {
    author: 'João Pedro',
    date: 'Há 1 mês',
    rating: 5,
    text: 'A reserva foi tranquila. O vestiário estava limpo e o horário começou pontualmente.'
  },
  {
    author: 'Rafael Costa',
    date: 'Há 2 meses',
    rating: 4,
    text: 'Boa estrutura para jogar com a turma. Voltaria a reservar sem dúvida.'
  },
  {
    author: 'Camila Rocha',
    date: 'Há 3 meses',
    rating: 5,
    text: 'Espaço organizado, fácil de encontrar e com uma equipe muito atenciosa.'
  }
];

VENUES.forEach((venue, venueIndex) => {
  venue.reviewItems = Array.from({ length: 3 }, (_, reviewIndex) => (
    REVIEW_FIXTURES[(venueIndex + reviewIndex) % REVIEW_FIXTURES.length]
  ));
});

export const DEFAULT_AVAILABILITY = [
  { hour: '08:00', status: 'busy' },
  { hour: '09:00', status: 'free' },
  { hour: '10:00', status: 'free' },
  { hour: '11:00', status: 'free' },
  { hour: '12:00', status: 'busy' },
  { hour: '13:00', status: 'free' },
  { hour: '14:00', status: 'busy' },
  { hour: '15:00', status: 'free' },
  { hour: '16:00', status: 'free' },
  { hour: '17:00', status: 'free' },
  { hour: '18:00', status: 'busy' },
  { hour: '19:00', status: 'free' },
  { hour: '20:00', status: 'free' },
  { hour: '21:00', status: 'free' },
  { hour: '22:00', status: 'free' }
];

export const INITIAL_RESERVATIONS = [
  {
    code: 'PQ-11900',
    venueId: 1,
    date: 'Hoje',
    hour: '19:00',
    endHour: '20:00',
    duration: 1,
    price: 120,
    status: 'Confirmada',
    statusClass: 'pago',
    group: 'proxima'
  },
  {
    code: 'PQ-20800',
    venueId: 2,
    date: 'Amanha',
    hour: '08:00',
    endHour: '09:00',
    duration: 1,
    price: 90,
    status: 'Confirmada',
    statusClass: 'pago',
    group: 'proxima'
  },
  {
    code: 'PQ-42000',
    venueId: 4,
    date: 'Sex, 12/06',
    hour: '20:00',
    endHour: '21:00',
    duration: 1,
    price: 70,
    status: 'Aguardando pagamento',
    statusClass: 'pendente',
    group: 'proxima'
  },
  {
    code: 'PQ-31500',
    venueId: 3,
    date: 'Sab, 20/06',
    hour: '15:00',
    endHour: '16:00',
    duration: 1,
    price: 80,
    status: 'Concluída',
    statusClass: 'concluido',
    group: 'historico'
  }
];

export const CONVERSATIONS = [
  {
    id: 1,
    venueId: 1,
    venue: 'Arena Bola na Rede',
    subject: 'Reserva de sabado 19h',
    messages: [
      { from: 'player', text: 'Fala! Reservei sabado as 19h. A quadra tem colete pra emprestar?', time: '09:12' },
      { from: 'venue', text: 'Opa, Gabriel! Tem sim, 10 coletes. Quantos voces vao precisar?', time: '09:15' },
      { from: 'player', text: 'Uns 6 ta otimo. Valeu!', time: '09:16' },
      { from: 'venue', text: 'Fechado, deixo separado na recepcao. Bom jogo!', time: '09:17' }
    ]
  },
  {
    id: 2,
    venueId: 2,
    venue: 'Beach Point Arena',
    subject: 'Beach tennis domingo',
    messages: [
      { from: 'venue', text: 'Oi Gabriel, seu horario de domingo 10h esta confirmado. Precisa de raquete?', time: '18:40' }
    ]
  }
];

export const WALLET = {
  balance: 85,
  transactions: [
    { date: 'Hoje', description: 'Reserva - Arena Bola na Rede', value: -120 },
    { date: 'Ontem', description: 'Cashback por indicacao', value: 20 },
    { date: '28/06', description: 'Reserva - Beach Point Arena', value: -90 },
    { date: '25/06', description: 'Adicao de saldo via Pix', value: 150 },
    { date: '20/06', description: 'Reserva - Volei Sand Club', value: -70 }
  ],
  coupons: [
    { code: 'PARTIU10', description: 'R$ 10 de bonus na sua proxima reserva' },
    { code: 'AMIGO20', description: 'R$ 20 ao indicar um amigo que reservar' },
    { code: 'NOITE15', description: '15% de desconto em horarios da noite' }
  ]
};

export const CURRENT_USER = {
  // Id proprio: a presenca na pelada precisa de chave estavel, e "Editar
  // perfil" ja permite trocar o nome — chavear por nome deixaria referencias
  // orfas em silencio na primeira edicao.
  id: 'u-gabriel',
  name: 'Gabriel Lisboa',
  email: 'gabriel@email.com',
  phone: '(62) 99999-0000',
  city: 'Goiânia',
  memberSince: 'jun/2025',
  stats: { games: 12, reservations: 8, favorites: 3 },
  favoriteSport: 'Futebol Society'
};

function buildMatchDate(minutesFromNow) {
  const d = new Date(Date.now() + minutesFromNow * 60000);
  return {
    date: d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }),
    dateISO: d.toISOString().slice(0, 10),
    time: d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    timestamp: d.getTime()
  };
}

function buildMatchEndDate(startTimestamp, durationMinutes) {
  const d = new Date(startTimestamp + durationMinutes * 60000);
  return {
    time: d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    timestamp: d.getTime()
  };
}

// Permite demonstrar as 3 fases do card sem esperar o relogio:
// ?partida=aovivo (em andamento), ?partida=fim (encerrada), padrao = proxima partida.
function demoMatchOffsetMinutes() {
  const demo = new URLSearchParams(globalThis.location?.search || '').get('partida');
  if (demo === 'aovivo') return -20;
  if (demo === 'fim') return -90;
  return 25;
}

const matchStart = buildMatchDate(demoMatchOffsetMinutes());
const matchEnd = buildMatchEndDate(matchStart.timestamp, 60);

export const ACTIVE_MATCH = {
  id: 1,
  reservationCode: 'PQ-11900',
  venueId: 1,
  venueName: 'Arena Bola na Rede',
  venueImage: 'https://images.unsplash.com/photo-1556056504-5c7696c4c28d?auto=format&fit=crop&w=900&q=80',
  sport: 'Futebol Society',
  address: 'Rua 27, 345 - Jardim Goiás, Goiânia - GO',
  lat: -16.7060,
  lng: -49.2350,
  date: matchStart.date,
  dateISO: matchStart.dateISO,
  startTime: matchStart.time,
  endTime: matchEnd.time,
  startTimestamp: matchStart.timestamp,
  endTimestamp: matchEnd.timestamp,
  duration: 60,
  organizer: {
    name: 'Carlos Almeida',
    phone: '(62) 98888-0001'
  },
  players: {
    confirmed: [
      { name: 'Gabriel Lisboa', avatar: '', rating: 4.8, position: 'Atacante', confirmedAt: '2 dias atrás' },
      { name: 'Rafael Costa', avatar: '', rating: 4.5, position: 'Meio-campo', confirmedAt: '1 dia atrás' },
      { name: 'Mariana Alves', avatar: '', rating: 4.9, position: 'Zagueira', confirmedAt: '12h atrás' },
      { name: 'João Pedro', avatar: '', rating: 4.3, position: 'Goleiro', confirmedAt: '8h atrás' },
      { name: 'Camila Rocha', avatar: '', rating: 4.7, position: 'Atacante', confirmedAt: '5h atrás' },
      { name: 'Thiago Santos', avatar: '', rating: 4.6, position: 'Lateral', confirmedAt: '3h atrás' },
      { name: 'Lucas Oliveira', avatar: '', rating: 4.4, position: 'Meio-campo', confirmedAt: '1h atrás' },
      { name: 'Pedro Henrique', avatar: '', rating: 4.2, position: 'Zagueiro', confirmedAt: '30min atrás' }
    ],
    pending: [
      { name: 'Ana Beatriz', avatar: '', rating: 4.1, position: 'Atacante' },
      { name: 'Felipe Augusto', avatar: '', rating: 4.0, position: 'Goleiro' }
    ]
  },
  chat: [
    { from: 'system', text: 'Partida criada', time: '3 dias atrás' },
    { from: 'player', name: 'Gabriel Lisboa', text: 'Bora pessoal! Vai ter resenha depois?', time: '2 dias atrás' },
    { from: 'player', name: 'Rafael Costa', text: 'Bora! Levo a churrasqueira', time: '2 dias atrás' },
    { from: 'player', name: 'Mariana Alves', text: 'Chego 19h15, sai do trampo 18h', time: '1 dia atrás' },
    { from: 'player', name: 'João Pedro', text: 'Tranquilo Mariana, aquecemos sem voce', time: '1 dia atrás' },
    { from: 'organizer', text: 'Pessoal, lembrando de levar colete claro e escuro', time: '12h atrás' },
    { from: 'player', name: 'Camila Rocha', text: 'Alguem pode pegar a bola?', time: '5h atrás' }
  ],
  phase: 'pre-game',
  score: { teamA: 0, teamB: 0 },
  teams: null,
  elapsedSeconds: 0,
  currentHalf: 1,
  halfDuration: 30,
  yellowCards: [],
  redCards: [],
  goals: [],
  assists: [],
  mvpVotes: {},
  rating: null,
  photos: [],
  videos: []
};

/* ═══════════════ Clube ═══════════════
   Um clube e o grupo que organiza a pelada recorrente. Uma pelada pode ser
   "do clube" ou "avulsa" (sem time fixo).

   Membros tem id; jogadores da partida continuam por nome, de proposito: a
   escalacao e outro dominio (inclui convidado que nao e membro). O elo entre
   os dois e feito por nome, e devolve null quando e convidado. */
// ?clube=vazio mostra o estado sem clube sem precisar limpar o localStorage,
// no mesmo espirito de demoMatchOffsetMinutes().
function demoWithoutClub() {
  return new URLSearchParams(globalThis.location?.search || '').get('clube') === 'vazio';
}

export const CLUBS = demoWithoutClub() ? [] : [
  {
    id: 1,
    name: 'Pelada dos Cria',
    sport: 'Futebol Society',
    city: 'Goiânia, GO',
    description: 'Toda quinta às 20h. Quem faltar sem avisar paga a água.',
    photo: '',
    createdBy: 'u-gabriel',
    members: [
      { id: 'u-gabriel', name: 'Gabriel Lisboa', role: 'dono', position: 'Atacante', rating: 4.8, since: 'jun/2025' },
      { id: 'u-rafael', name: 'Rafael Costa', role: 'membro', position: 'Meio-campo', rating: 4.5, since: 'jun/2025' },
      { id: 'u-mariana', name: 'Mariana Alves', role: 'membro', position: 'Zagueira', rating: 4.9, since: 'jul/2025' },
      { id: 'u-joao', name: 'João Pedro', role: 'membro', position: 'Goleiro', rating: 4.3, since: 'jul/2025' },
      { id: 'u-camila', name: 'Camila Rocha', role: 'membro', position: 'Atacante', rating: 4.7, since: 'jul/2025' },
      { id: 'u-thiago', name: 'Thiago Santos', role: 'membro', position: 'Lateral', rating: 4.6, since: 'ago/2025' }
    ]
  }
];

function peladaDate(daysFromNow) {
  const d = new Date(Date.now() + daysFromNow * 86400000);
  return d.toISOString().slice(0, 10);
}

export const PELADAS = [
  {
    id: 1,
    clubId: 1,
    kind: 'clube',
    title: 'Pelada de quinta',
    venueId: 1,
    venueName: 'Arena Bola na Rede',
    sport: 'Futebol Society',
    dateISO: peladaDate(3),
    startTime: '20:00',
    duration: 60,
    maxPlayers: 14,
    organizerId: 'u-gabriel',
    status: 'agendada',
    attendance: { 'u-gabriel': 'sim', 'u-rafael': 'sim', 'u-mariana': 'talvez', 'u-joao': 'sim' }
  },
  {
    id: 2,
    clubId: null,
    kind: 'avulsa',
    title: 'Vôlei com a galera do trabalho',
    venueId: 4,
    venueName: 'Volei Sand Club',
    sport: 'Volei',
    dateISO: peladaDate(6),
    startTime: '19:00',
    duration: 60,
    maxPlayers: 12,
    organizerId: 'u-gabriel',
    status: 'agendada',
    attendance: { 'u-gabriel': 'sim' }
  }
];

/* Conversa do clube — o mural onde a pelada e combinada. E o chat que saiu
   da tela de jogo: la ele nao tinha proposito, aqui tem. */
export const CLUB_CHAT = [
  { clubId: 1, memberId: 'u-gabriel', name: 'Gabriel Lisboa', text: 'Fechou a quinta! Já reservei a Arena.', time: '3 dias atrás' },
  { clubId: 1, memberId: 'u-rafael', name: 'Rafael Costa', text: 'Boa! Levo a churrasqueira depois do jogo.', time: '3 dias atrás' },
  { clubId: 1, memberId: 'u-mariana', name: 'Mariana Alves', text: 'Chego 20h15, saio do trampo 19h30.', time: '2 dias atrás' },
  { clubId: 1, memberId: 'u-joao', name: 'João Pedro', text: 'Tranquilo, a gente aquece antes.', time: '2 dias atrás' },
  { clubId: 1, memberId: 'u-camila', name: 'Camila Rocha', text: 'Alguém pode levar colete claro e escuro?', time: '1 dia atrás' },
  { clubId: 1, memberId: 'u-gabriel', name: 'Gabriel Lisboa', text: 'Levo eu. Confirmem presença aí, galera.', time: '1 dia atrás' }
];

/* ═══════════════ Pessoas na plataforma ═══════════════
   O app so conhecia CURRENT_USER — nao havia como responder "quantos se
   cadastraram" nem "quem sumiu". Datas relativas a hoje para o painel nao
   envelhecer sozinho.

   lastActiveAt e o campo que sustenta a reativacao: quem passa de 7 dias
   entra na fila de notificacao. */
function diasAtras(dias) {
  return new Date(Date.now() - dias * 86400000).toISOString();
}

export const USERS = [
  { id: 'u-gabriel', name: 'Gabriel Lisboa', role: 'jogador', city: 'Goiânia, GO', createdAt: diasAtras(58), lastActiveAt: diasAtras(0) },
  { id: 'u-rafael', name: 'Rafael Costa', role: 'jogador', city: 'Goiânia, GO', createdAt: diasAtras(54), lastActiveAt: diasAtras(1) },
  { id: 'u-mariana', name: 'Mariana Alves', role: 'jogador', city: 'Goiânia, GO', createdAt: diasAtras(41), lastActiveAt: diasAtras(2) },
  { id: 'u-joao', name: 'João Pedro', role: 'jogador', city: 'Aparecida de Goiânia, GO', createdAt: diasAtras(39), lastActiveAt: diasAtras(5) },
  { id: 'u-camila', name: 'Camila Rocha', role: 'jogador', city: 'Goiânia, GO', createdAt: diasAtras(33), lastActiveAt: diasAtras(6) },
  { id: 'u-thiago', name: 'Thiago Santos', role: 'jogador', city: 'Goiânia, GO', createdAt: diasAtras(28), lastActiveAt: diasAtras(9) },
  { id: 'u-lucas', name: 'Lucas Oliveira', role: 'jogador', city: 'Goiânia, GO', createdAt: diasAtras(24), lastActiveAt: diasAtras(14) },
  { id: 'u-pedro', name: 'Pedro Henrique', role: 'jogador', city: 'Goiânia, GO', createdAt: diasAtras(21), lastActiveAt: diasAtras(23) },
  { id: 'u-ana', name: 'Ana Beatriz', role: 'jogador', city: 'Goiânia, GO', createdAt: diasAtras(17), lastActiveAt: diasAtras(31) },
  { id: 'u-felipe', name: 'Felipe Augusto', role: 'jogador', city: 'Goiânia, GO', createdAt: diasAtras(12), lastActiveAt: diasAtras(3) },
  { id: 'u-carlos', name: 'Carlos Almeida', role: 'dono', venueId: 1, city: 'Goiânia, GO', createdAt: diasAtras(70), lastActiveAt: diasAtras(0) },
  { id: 'u-sandra', name: 'Sandra Beach', role: 'dono', venueId: 2, city: 'Goiânia, GO', createdAt: diasAtras(66), lastActiveAt: diasAtras(1) },
  { id: 'u-ze', name: 'José Ribeiro', role: 'dono', venueId: 3, city: 'Goiânia, GO', createdAt: diasAtras(62), lastActiveAt: diasAtras(11) },
  { id: 'u-marcos', name: 'Marcos Areia', role: 'dono', venueId: 4, city: 'Goiânia, GO', createdAt: diasAtras(45), lastActiveAt: diasAtras(4) },
  { id: 'u-julia', name: 'Julia Spin', role: 'dono', venueId: 5, city: 'Goiânia, GO', createdAt: diasAtras(30), lastActiveAt: diasAtras(19) },
  { id: 'u-bruno', name: 'Bruno Cesta', role: 'dono', venueId: 6, city: 'Goiânia, GO', createdAt: diasAtras(15), lastActiveAt: diasAtras(2) }
];
