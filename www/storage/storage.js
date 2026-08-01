import { STORAGE_PREFIX } from '../config/constants.js';

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';

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
  },
  getAuthToken() {
    return read(TOKEN_KEY);
  },
  setAuthToken(token) {
    return write(TOKEN_KEY, token);
  },
  getAuthUser() {
    return read(USER_KEY);
  },
  setAuthUser(user) {
    return write(USER_KEY, user);
  }
};

export default storage;
