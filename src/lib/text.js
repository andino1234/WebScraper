'use strict';

/** Quita acentos y pasa a minúsculas: "Consultoría" -> "consultoria" */
function fold(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Quita acentos pero conserva mayúsculas (para siglas como TOR, RFP). */
function stripAccents(value) {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function squish(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function truncate(value, max) {
  const s = squish(value);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// Textos de enlace que nunca son un título real de licitación.
const JUNK_TITLES = [
  'leer mas', 'leer más', 'ver mas', 'ver más', 'read more', 'more', 'mas informacion', 'más información',
  'click here', 'aqui', 'aquí', 'descargar', 'download', 'ver detalle', 'detalle', 'details', 'view', 'ver',
  'saiba mais', 'leia mais', 'apply', 'aplicar', 'next', 'siguiente', 'anterior', 'previous', 'inicio', 'home'
];

function isJunkTitle(title) {
  const t = fold(squish(title)).replace(/[»›>.:…]+$/g, '').trim();
  if (t.length < 12) return true;
  if (JUNK_TITLES.includes(t)) return true;
  if (/^(pdf|docx?|xlsx?)$/i.test(t)) return true;
  return false;
}

module.exports = { fold, stripAccents, squish, escapeRegExp, truncate, isJunkTitle };
