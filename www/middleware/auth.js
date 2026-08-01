import authService from '../services/auth.js';
import { ROUTES } from '../config/routes.js';

export function requireAuth() {
  if (authService.hasSession()) return true;
  globalThis.location.assign(ROUTES.login);
  return false;
}

export function redirectWhenAuthenticated() {
  if (!authService.hasSession()) return false;
  globalThis.location.assign(ROUTES.dashboard);
  return true;
}
