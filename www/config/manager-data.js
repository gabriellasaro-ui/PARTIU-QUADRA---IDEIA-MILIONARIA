/* Dados da ARENA do gerente.

   Correcao de um erro de modelo meu: eu vinha alimentando o painel do
   gerente com VENUES, que e o catalogo do marketplace inteiro — as 6 arenas
   da plataforma. O gerente e dono de UMA arena, com varias quadras dentro
   dela. Sao coisas diferentes:

     VENUES  -> o que o jogador ve no Explorar (arenas de toda a cidade)
     COURTS  -> os espacos DESTA arena (Society 1, Society 2, Areia)

   Valores conferidos contra _legacy/gerente/app.py e _legacy/shared/data.py,
   que era de onde o app antigo lia. */

export const ARENA = {
  id: 1,
  name: 'Arena Bola na Rede',
  sport: 'Futebol Society',
  neighborhood: 'Jardim Goiás',
  city: 'Goiania, GO',
  rating: 4.8,
  distance: 1.2,
  views30d: 1284,
  conversion: 9.8,
  visible: true,
  featured: false
};

export const COURTS = [
  {
    id: 1,
    label: 'Society 1',
    sport: 'Futebol Society',
    price: 120,
    priceMonthly: 408,
    active: true,
    occupancy: 78,
    photo: 'https://images.unsplash.com/photo-1556056504-5c7696c4c28d?auto=format&fit=crop&w=900&q=80'
  },
  {
    id: 2,
    label: 'Society 2',
    sport: 'Futsal',
    price: 80,
    priceMonthly: 272,
    active: true,
    occupancy: 64,
    photo: 'https://images.unsplash.com/photo-1543326727-cf6c39e8f84c?auto=format&fit=crop&w=900&q=80'
  },
  {
    id: 3,
    label: 'Areia',
    sport: 'Volei',
    price: 70,
    priceMonthly: 238,
    active: false,
    occupancy: 0,
    photo: 'https://images.unsplash.com/photo-1612872087720-bb876e2e67d1?auto=format&fit=crop&w=900&q=80'
  }
];

/* As reservas que o GERENTE ve tem cliente e telefone — ele precisa saber
   quem esta do outro lado. As do jogador nao tinham isso, porque o cliente
   e ele proprio. */
export const ARENA_BOOKINGS = [
  { id: 9, codigo: 'PQ-1929', cliente: 'Gabriel Lisboa', telefone: '(62) 99888-0001', quadra: 'Society 1', data: 'Sáb, 06/07', hora: '19:00 – 20:00', valor: 120, status: 'Solicitada' },
  { id: 1, codigo: 'PQ-1931', cliente: 'Lucas Andrade', telefone: '(62) 99140-2210', quadra: 'Society 1', data: 'Hoje', hora: '08:00 – 09:00', valor: 120, status: 'Solicitada' },
  { id: 2, codigo: 'PQ-1932', cliente: 'Equipe Os Galáticos', telefone: '(62) 99777-1180', quadra: 'Society 1', data: 'Hoje', hora: '14:00 – 16:00', valor: 240, status: 'Pago' },
  { id: 3, codigo: 'PQ-1933', cliente: 'Marina Souza', telefone: '(62) 98120-5567', quadra: 'Society 2', data: 'Amanhã', hora: '18:00 – 19:00', valor: 120, status: 'Solicitada' },
  { id: 4, codigo: 'PQ-1934', cliente: 'Pelada do Trabalho', telefone: '(62) 99604-7781', quadra: 'Society 1', data: 'Amanhã', hora: '20:00 – 21:00', valor: 120, status: 'Pendente' },
  { id: 5, codigo: 'PQ-1935', cliente: 'Rafael Lima', telefone: '(62) 99333-0092', quadra: 'Society 2', data: 'Amanhã', hora: '21:00 – 22:00', valor: 120, status: 'Confirmado' },
  { id: 6, codigo: 'PQ-1936', cliente: 'Time da Firma', telefone: '(62) 98800-4521', quadra: 'Society 1', data: 'Qui, 02/07', hora: '19:00 – 20:00', valor: 120, status: 'Confirmado' },
  { id: 7, codigo: 'PQ-1937', cliente: 'Amigos da Bola', telefone: '(62) 99012-3344', quadra: 'Society 2', data: 'Sex, 03/07', hora: '20:00 – 22:00', valor: 240, status: 'Solicitada' },
  { id: 8, codigo: 'PQ-1938', cliente: 'Galera do Bairro', telefone: '(62) 99455-8890', quadra: 'Society 1', data: 'Sáb, 04/07', hora: '16:00 – 17:00', valor: 120, status: 'Confirmado' }
];

/* Repasses ja conciliados. Histórico fechado: nao sai das reservas acima,
   que sao a semana corrente. */
export const ARENA_PAYOUTS = [
  { periodo: '01 a 07 deste mês', reservas: 32, bruto: 4820, status: 'Pago', cls: 'pago' },
  { periodo: '25 a 31 do mês passado', reservas: 28, bruto: 4120, status: 'Pago', cls: 'pago' },
  { periodo: '18 a 24 do mês passado', reservas: 31, bruto: 4505, status: 'Pago', cls: 'pago' }
];

/* "Hoje" e "Amanhã" sao relativos; a agenda precisa de um dia concreto para
   posicionar o evento na grade. Devolve 0=Seg .. 6=Dom. */
const ROTULO_DIA = { Seg: 0, Ter: 1, Qua: 2, Qui: 3, Sex: 4, Sáb: 5, Dom: 6 };

export function bookingWeekday(booking, hoje = new Date()) {
  // getDay() e 0=Dom; a grade comeca na segunda.
  const segundaBase = (d) => (d.getDay() + 6) % 7;
  if (booking.data === 'Hoje') return segundaBase(hoje);
  if (booking.data === 'Amanhã') return (segundaBase(hoje) + 1) % 7;
  return ROTULO_DIA[booking.data.split(',')[0]] ?? 0;
}

/* A data concreta da reserva. "Amanhã" nao pode virar so um indice de dia da
   semana: no domingo isso da segunda-feira, e o modulo joga o evento na
   segunda que ja passou. Aqui ele cai no dia certo, ainda que seja na
   semana seguinte.

   Os rotulos explicitos ("Qui, 02/07") sao dado de demonstracao ancorado na
   semana corrente — ficam no dia da semana correspondente. */
export function bookingDate(booking, hoje = new Date()) {
  const base = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  if (booking.data === 'Hoje') return base;
  if (booking.data === 'Amanhã') {
    base.setDate(base.getDate() + 1);
    return base;
  }
  const alvo = ROTULO_DIA[booking.data.split(',')[0]] ?? 0;
  const segunda = new Date(base);
  segunda.setDate(segunda.getDate() - ((segunda.getDay() + 6) % 7) + alvo);
  return segunda;
}

/* '19:00 – 20:00' -> { inicio: 19, fim: 20 }. O travessao do dado antigo e
   en dash, nao hifen. */
export function bookingHours(booking) {
  const [ini, fim] = String(booking.hora).split(/\s*[–-]\s*/);
  const hora = (t) => {
    const [h, m] = String(t).split(':').map(Number);
    return h + (m || 0) / 60;
  };
  return { inicio: hora(ini), fim: hora(fim || ini) };
}

/* Mensalistas da arena, no formato do app antigo. */
export const ARENA_MEMBERS = [
  { id: 'mock-matheus', name: 'Matheus Ribeiro', court: 'Society 1', day: 'terça', time: '20:00', price: 420, status: 'ativo' },
  { id: 'mock-caiapo', name: 'Time Caiapó', court: 'Society 2', day: 'quinta', time: '21:00', price: 480, status: 'ativo' },
  { id: 'mock-fernanda', name: 'Fernanda Lima', court: 'Areia', day: 'sábado', time: '09:00', price: 360, status: 'renovando' }
];

/* Status do app antigo -> classe de cor. "Solicitada" e "Pendente" pedem
   acao; "Pago" e "Confirmado" nao. */
export const STATUS_CLASS = {
  Solicitada: 'solicitada',
  Pendente: 'pendente',
  Pago: 'pago',
  Confirmado: 'confirmado'
};

/* Avaliacoes da arena, do app antigo (_legacy/gerente/app.py:194). */
export const ARENA_REVIEWS = [
  { cliente: 'Lucas Andrade', nota: 5, quando: 'há 2 dias', texto: 'Quadra impecável, gramado novo e iluminação ótima pra jogar à noite.' },
  { cliente: 'Marina Souza', nota: 5, quando: 'há 5 dias', texto: 'Vestiário limpo e atendimento rápido. Voltarei com certeza.' },
  { cliente: 'Rafael Lima', nota: 4, quando: 'há 1 semana', texto: 'Muito boa, só faltou estacionamento mais perto. No mais, top.' },
  { cliente: 'Time da Firma', nota: 5, quando: 'há 2 semanas', texto: 'Melhor society da região, reserva pelo app é super prática.' }
];

export const REVIEW_DIST = [
  { n: 5, qtd: 168 }, { n: 4, qtd: 32 }, { n: 3, qtd: 9 }, { n: 2, qtd: 3 }, { n: 1, qtd: 2 }
];

/* Perfil da arena — o que a tela de Configurações edita. */
export const ARENA_PROFILE = {
  nome: 'Arena Bola na Rede',
  esporte: 'Futebol Society',
  descricao: 'Society com grama sintética, iluminação e vestiário.',
  endereco: 'Rua das Quadras, 123 — Jardim Goiás, Goiânia',
  telefone: '(62) 99999-0000',
  email: 'contato@arenabolanarede.com',
  pixTipo: 'CNPJ',
  pixChave: '12.345.678/0001-90',
  pixTitular: 'Arena Bola na Rede LTDA',
  notificaReserva: true,
  notificaPagamento: true,
  notificaAvaliacao: false,
  notificaResumo: true,
  pausada: false
};

export const ARENA_COUPONS = [
  { id: 'mock-primeirajogada', code: 'PRIMEIRAJOGADA', discount: 10, expires: '2026-08-31', court: 'Todas as quadras' }
];

export const SPORTS = ['Futebol Society', 'Futsal', 'Beach Tennis', 'Vôlei', 'Basquete', 'Tênis'];

export const AMENITIES = [
  { id: 'iluminacao', label: 'Iluminação', on: true },
  { id: 'coberta', label: 'Coberta', on: false },
  { id: 'vestiario', label: 'Vestiário', on: true },
  { id: 'estacionamento', label: 'Estacionamento', on: false },
  { id: 'bar', label: 'Bar / lanchonete', on: false }
];
