/* Registro de push (FCM/APNS) — Workstream E.

   Enquanto PUSH_READY for false nada roda: o backend usa push mock e nao ha
   servico FCM configurado (VAPID em branco). Com o flag ligado, o app nativo
   pede permissao, captura o token do plugin e registra em POST /api/devices
   (que faz upsert por usuario). Tocar em uma notificacao e navegar para a
   tela certa fica para uma fase futura; aqui o listener apenas registra. */
import { API_BASE_URL } from '../config/constants.js';
import api from './api.js';

export const PUSH_READY = false;

const EMPTY = { ok: false, token: null };

let listeners = [];

export function isNative() {
  return typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();
}

function plugin() {
  return window.Capacitor?.Plugins?.PushNotifications || null;
}

/* Pede permissao e devolve { ok, token }. No navegador (PWA) nao ha servico
   declarado, entao nada acontece. */
export async function initPush() {
  if (!PUSH_READY || !isNative() || !plugin()) return EMPTY;
  try {
    const permission = await plugin().requestPermissions();
    if (!permission?.receive) return EMPTY;
    const token = await plugin().register();
    if (!token || !token.value) return EMPTY;
    registerDevice(token.value).catch(() => {});
    listeners.push(await plugin().addListener('pushNotificationReceived', () => {}));
    listeners.push(await plugin().addListener('pushNotificationActionPerformed', () => {}));
    return { ok: true, token: token.value };
  } catch (error) {
    console.warn('[push] indisponivel', error);
    return EMPTY;
  }
}

export function disposePush() {
  listeners.forEach((handle) => handle?.remove?.());
  listeners = [];
}

/* Upsert do token no backend. Android usa FCM, iOS usa APNS. */
export async function registerDevice(token) {
  if (!API_BASE_URL || !token) return null;
  const platform = window.Capacitor?.getPlatform?.() === 'android' ? 'fcm' : 'apns';
  return api.post('/api/devices', { fcmToken: token, platform });
}

export default { initPush, disposePush, registerDevice, isNative };
