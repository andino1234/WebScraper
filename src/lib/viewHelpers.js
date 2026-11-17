'use strict';

const { daysUntil } = require('./dates');
const { REGIONS } = require('../config/regions');

function flag(iso) {
  if (!iso || iso.length !== 2) return '🌎';
  return String.fromCodePoint(...[...iso.toUpperCase()].map(c => 0x1f1e6 + c.charCodeAt(0) - 65));
}

function date(d, opts = { day: '2-digit', month: 'short', year: 'numeric' }) {
  if (!d) return '—';
  const x = new Date(d);
  return isNaN(x) ? '—' : x.toLocaleDateString('es-GT', opts);
}

function dateTime(d) {
  if (!d) return '—';
  const x = new Date(d);
  return isNaN(x) ? '—' : x.toLocaleString('es-GT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function ago(d) {
  if (!d) return 'nunca';
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'hace un momento';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  const days = Math.round(s / 86400);
  return days === 1 ? 'ayer' : `hace ${days} días`;
}

/** Texto y color de la fecha límite: "Cierra hoy", "Cierra en 3 días"... */
function deadline(d) {
  const n = daysUntil(d);
  if (n === null) return { text: 'Sin fecha límite', tone: 'none', days: null };
  if (n < 0) return { text: `Venció hace ${-n} d`, tone: 'past', days: n };
  if (n === 0) return { text: 'Cierra hoy', tone: 'urgent', days: n };
  if (n === 1) return { text: 'Cierra mañana', tone: 'urgent', days: n };
  if (n <= 7) return { text: `Cierra en ${n} días`, tone: 'soon', days: n };
  if (n <= 21) return { text: `Cierra en ${n} días`, tone: 'mid', days: n };
  return { text: `Cierra ${date(d, { day: '2-digit', month: 'short' })}`, tone: 'far', days: n };
}

const LEVEL_TONE = { 'Crítica': 'crit', 'Alta': 'high', 'Media': 'mid', 'Baja': 'low' };

function qs(current, changes = {}) {
  const p = new URLSearchParams();
  const merged = { ...current, ...changes };
  for (const [k, v] of Object.entries(merged)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, v);
  }
  if (!('pagina' in changes)) p.delete('pagina');
  p.delete('abrir');
  const s = p.toString();
  return s ? `?${s}` : '?';
}

module.exports = { flag, date, dateTime, ago, deadline, LEVEL_TONE, REGIONS, qs };
