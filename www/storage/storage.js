import { STORAGE_PREFIX } from '../config/constants.js';

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';
const REFRESH_KEY = 'auth_refresh';

function key(name) {
  return `${STORAGE_PREFIX}:${name}`;
}

function read(name, fallback = null) {
  try {
    const raw = globalThis.localStorage?.getItem(key(name));
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    return fallback;
  }
}

function write(name, value) {
  try {
    globalThis.localStorage?.setItem(key(name), JSON.stringify(value));
    return true;
  } catch (error) {
    return false;
  }
}

function remove(name) {
  try {
    globalThis.localStorage?.removeItem(key(name));
    return true;
  } catch (error) {
    return false;
  }
}

export const storage = {
  get: read,
  set: write,
  remove,
  clearSession() {
    remove(TOKEN_KEY);
    remove(USER_KEY);
    remove(REFRESH_KEY);
    // O perfil vai junto: sem isto, quem entrar depois no mesmo aparelho
    // herda nome, cidade e foto de quem saiu.
    remove('player_profile');
  },
  getAuthToken() {
    return read(TOKEN_KEY);
  },
  setAuthToken(token) {
    return write(TOKEN_KEY, token);
  },
  getAuthRefreshToken() {
    return read(REFRESH_KEY);
  },
  setAuthRefreshToken(token) {
    return write(REFRESH_KEY, token);
  },
  getAuthUser() {
    return read(USER_KEY);
  },
  setAuthUser(user) {
    return write(USER_KEY, user);
  }
};

export default storage;
