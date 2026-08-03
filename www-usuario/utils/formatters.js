import {
  DEFAULT_CURRENCY,
  DEFAULT_LOCALE,
  SERVICE_FEE_RATE
} from '../config/constants.js';

export function formatCurrency(value, currency = DEFAULT_CURRENCY) {
  return new Intl.NumberFormat(DEFAULT_LOCALE, {
    style: 'currency',
    currency
  }).format(Number(value || 0));
}

export function formatDate(value, options = {}) {
  if (!value) return '';
  return new Intl.DateTimeFormat(DEFAULT_LOCALE, options).format(new Date(value));
}

export function formatHourRange(start, end) {
  if (!start || !end) return '';
  return `${start} - ${end}`;
}

export function calculateCheckoutAmounts(pricePerHour, duration = 1) {
  const subtotal = Math.round(Number(pricePerHour || 0) * Number(duration || 1) * 100) / 100;
  const serviceFee = Math.round(subtotal * SERVICE_FEE_RATE * 100) / 100;
  return {
    subtotal,
    serviceFee,
    total: Math.round((subtotal + serviceFee) * 100) / 100
  };
}

/* toLocaleDateString('pt-BR', {month:'short'}) devolve "ago. de 2026". O app
   escreve "ago/2026" em todo lugar (CLUBS.members.since, CURRENT_USER). */
export function mesAno(date = new Date()) {
  const mes = date.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
  return `${mes}/${date.getFullYear()}`;
}
