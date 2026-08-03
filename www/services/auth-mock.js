/* Backend de auth fingido, para o app funcionar inteiro antes da API existir.

   Mesmo espirito do resto do projeto: services/venues.js decide entre API e
   localStorage a cada chamada. Aqui a decisao ja foi tomada pelo auth.js —
   este arquivo e so o lado local.

   Uma escolha importante: gabriel@email.com devolve id 'u-gabriel', que e o
   mesmo id de CURRENT_USER. Isso preserva a demo inteira (clube, peladas,
   presenca, chat, tudo chaveado por esse id). Qualquer outro email ganha id
   novo e cai no estado sem clube — que e justamente o caminho que precisa
   ser testavel agora que existe busca e entrada em clube. */
import storage from '../storage/storage.js';
import { CURRENT_USER } from '../config/mock-data.js';
import { mesAno } from '../utils/formatters.js';

const CONTAS_KEY = 'auth_accounts';
const DEMO_EMAIL = 'gabriel@email.com';

const contas = () => storage.get(CONTAS_KEY, []);
const salvarContas = (lista) => storage.set(CONTAS_KEY, lista);


const normalizarEmail = (email) => String(email || '').trim().toLowerCase();

/* Token opaco. Nao carrega informacao: quem responde "quem sou eu" e o
   auth_user guardado ao lado, e no backend real sera o servidor. */
const novoToken = () => `local.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 10)}`;

/* Os campos que o onboarding e o ranking vao precisar ja nascem aqui, mesmo
   vazios — assim nenhuma tela precisa testar se a chave existe. */
function novoUsuario({ name, email, provider, photo = '' }) {
  return {
    id: `u-${Date.now().toString(36)}`,
    name: String(name || '').trim() || 'Jogador',
    email: normalizarEmail(email),
    phone: '',
    city: '',
    photo,
    position: '',
    level: '',
    birthDate: '',
    foot: '',
    favoriteSport: '',
    rating: null,
    memberSince: mesAno(),
    stats: { games: 0, reservations: 0, favorites: 0 },
    provider,
    onboardedAt: null
  };
}

/* O usuario da demo: CURRENT_USER com os campos novos preenchidos. */
function usuarioDemo(provider) {
  return {
    ...CURRENT_USER,
    photo: CURRENT_USER.photo || '',
    position: 'Atacante',
    level: 'intermediario',
    birthDate: '',
    foot: '',
    rating: 4.8,
    provider,
    // Ja passou pelo onboarding: quem abre a demo quer ver o app, nao o
    // formulario de boas-vindas.
    onboardedAt: new Date().toISOString()
  };
}

function achar(email) {
  const alvo = normalizarEmail(email);
  if (alvo === DEMO_EMAIL) return usuarioDemo('password');
  return contas().find((c) => c.email === alvo) || null;
}

export const authMock = {
  async login({ email, senha, password }) {
    const conta = achar(email);
    if (!conta) {
      throw new Error('E-mail não encontrado. Confira ou crie uma conta.');
    }
    // A senha nao e conferida de proposito: guardar senha em localStorage
    // seria pior do que nao guardar. Quem valida sera o backend.
    void senha; void password;
    return { token: novoToken(), user: conta, isNew: false };
  },

  async register({ name, email }) {
    if (achar(email)) {
      throw new Error('Já existe uma conta com esse e-mail.');
    }
    const user = novoUsuario({ name, email, provider: 'password' });
    salvarContas([...contas(), user]);
    return { token: novoToken(), user, isNew: true };
  },

  /* O backend real receberia o idToken, validaria a assinatura no Google e
     so entao decidiria criar ou reaproveitar a conta. Aqui a decisao sai do
     perfil que o mock de handshake devolveu. */
  async google({ profile }) {
    const existente = achar(profile?.email);
    if (existente) {
      return { token: novoToken(), user: existente, isNew: false };
    }
    const user = novoUsuario({
      name: profile?.name,
      email: profile?.email,
      photo: profile?.picture || '',
      provider: 'google'
    });
    salvarContas([...contas(), user]);
    return { token: novoToken(), user, isNew: true };
  },

  async patchUser(user, patch) {
    const atualizado = { ...user, ...patch };
    if (atualizado.email !== DEMO_EMAIL) {
      salvarContas(contas().map((c) => (c.id === atualizado.id ? atualizado : c)));
    }
    return atualizado;
  }
};

export default authMock;
