'use strict';

const { fold } = require('./text');

const MONTHS = {
  // español
  enero: 1, ene: 1, febrero: 2, feb: 2, marzo: 3, mar: 3, abril: 4, abr: 4, mayo: 5, may: 5,
  junio: 6, jun: 6, julio: 7, jul: 7, agosto: 8, ago: 8, septiembre: 9, setiembre: 9, sep: 9, sept: 9, set: 9,
  octubre: 10, oct: 10, noviembre: 11, nov: 11, diciembre: 12, dic: 12,
  // inglés
  january: 1, jan: 1, february: 2, march: 3, april: 4, apr: 4, june: 6, july: 7, august: 8, aug: 8,
  september: 9, october: 10, november: 11, december: 12, dec: 12,
  // portugués
  janeiro: 1, fevereiro: 2, fev: 2, marco: 3, maio: 5, mai: 5, junho: 6, julho: 7, agosto_pt: 8,
  setembro: 9, outubro: 10, out: 10, novembro: 11, dezembro: 12, dez: 12,
  // francés
  janvier: 1, fevrier: 2, mars: 3, avril: 4, juin: 6, juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre_fr: 11, decembre: 12
};

const MONTH_RE = Object.keys(MONTHS).filter(k => !k.includes('_')).sort((a, b) => b.length - a.length).join('|');

function makeDate(y, m, d, hh = 0, mm = 0) {
  y = Number(y); m = Number(m); d = Number(d);
  if (y < 100) y += 2000;
  if (!(y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  // Hora local: una fecha "30/11/2026" significa ese día en la zona del servidor,
  // no la medianoche UTC (que en Centroamérica sería el día anterior).
  const date = new Date(y, m - 1, d, Number(hh) || 0, Number(mm) || 0);
  if (date.getMonth() !== m - 1) return null; // 31 de febrero, etc.
  return date;
}

/**
 * Convierte un texto con una fecha a Date. Entiende:
 *  2026-11-30, 2026-11-30T14:00:00Z, 30/11/2026, 30-11-2026, 30.11.2026,
 *  30 de noviembre de 2026, 30 Nov 2026, 30-Nov-2026, November 30, 2026, 11/30/2026 (si el día > 12).
 *  options.preferMonthFirst = true para fuentes de EE. UU. (MM/DD/YYYY).
 */
function parseDate(value, options = {}) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value) ? null : value;
  const raw = String(value).trim();
  if (!raw) return null;

  // ISO
  let m = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (m) {
    // "2026-11-30T00:00:00Z" suele ser solo una fecha: tratarla como día local.
    if (/T00:00(:00)?(\.0+)?Z$/i.test(raw)) return makeDate(m[1], m[2], m[3]);
    if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) {
      const d = new Date(raw);
      return isNaN(d) ? null : d;
    }
    return makeDate(m[1], m[2], m[3], m[4], m[5]);
  }

  // Compacto AAAAMMDD
  m = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return makeDate(m[1], m[2], m[3]);

  const text = fold(raw);

  // 30/11/2026 o 11/30/2026
  m = text.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b(?:\D{0,6}(\d{1,2}):(\d{2}))?/);
  if (m) {
    let a = Number(m[1]); let b = Number(m[2]);
    let day = a; let month = b;
    if (options.preferMonthFirst ? b <= 31 && a <= 12 : false) { day = b; month = a; }
    if (month > 12 && day <= 12) { const t = day; day = month; month = t; }
    return makeDate(m[3], month, day, m[4], m[5]);
  }

  // 30 de noviembre de 2026 / 30 Nov 2026 / 30-Nov-2026
  m = text.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th|º|°)?[\\s.-]*(?:de\\s+)?(${MONTH_RE})\\.?[\\s,.-]*(?:de\\s+|del\\s+)?(\\d{4})`));
  if (m) return makeDate(m[3], MONTHS[m[2]], m[1]);

  // November 30, 2026
  m = text.match(new RegExp(`\\b(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})`));
  if (m) return makeDate(m[3], MONTHS[m[1]], m[2]);

  return null;
}

// Etiquetas que suelen anteceder a la fecha límite
const DEADLINE_LABELS = [
  'fecha limite', 'fecha de cierre', 'fecha cierre', 'cierre de recepcion', 'plazo de presentacion', 'plazo de entrega',
  'plazo para', 'plazo', 'fecha maxima', 'recepcion de ofertas', 'presentacion de ofertas', 'presentacion de propuestas',
  'vence', 'vencimiento', 'cierre',
  'deadline', 'closing date', 'closing on', 'closes on', 'due date', 'submission deadline', 'submission date',
  'proposals due', 'responses due', 'application deadline', 'apply by', 'expiry date', 'expires',
  'data de encerramento', 'encerramento', 'prazo', 'data limite', 'recebimento das propostas',
  'date limite', 'date de cloture'
];
const LABEL_RE = new RegExp(`(${DEADLINE_LABELS.map(l => l.replace(/ /g, '\\s+')).join('|')})`, 'g');

/** Busca una fecha límite dentro de un texto largo (página de detalle). */
function extractDeadline(text, options = {}) {
  if (!text) return null;
  const folded = fold(text);
  let best = null;
  let match;
  LABEL_RE.lastIndex = 0;
  while ((match = LABEL_RE.exec(folded)) !== null) {
    const window = folded.slice(match.index + match[0].length, match.index + match[0].length + 90);
    const date = parseDate(window, options) || parseLooseDate(window, options);
    if (date) {
      // Si hay varias, quedarse con la más próxima en el futuro
      const now = Date.now() - 24 * 3600 * 1000;
      if (!best || (date.getTime() >= now && (best.getTime() < now || date < best))) best = date;
    }
  }
  return best;
}

/** Igual que parseDate pero busca la fecha en cualquier parte del fragmento. */
function parseLooseDate(fragment, options = {}) {
  const patterns = [
    /\d{4}-\d{2}-\d{2}/,
    /\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/,
    new RegExp(`\\d{1,2}(?:st|nd|rd|th)?[\\s.-]*(?:de\\s+)?(?:${MONTH_RE})\\.?[\\s,.-]*(?:de\\s+|del\\s+)?\\d{4}`),
    new RegExp(`(?:${MONTH_RE})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}`)
  ];
  for (const re of patterns) {
    const m = fragment.match(re);
    if (m) {
      const d = parseDate(m[0], options);
      if (d) return d;
    }
  }
  return null;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function isExpired(deadline) {
  if (!deadline) return false;
  const d = deadline instanceof Date ? deadline : new Date(deadline);
  return !isNaN(d) && d < startOfToday();
}

function daysUntil(deadline) {
  if (!deadline) return null;
  const d = deadline instanceof Date ? deadline : new Date(deadline);
  if (isNaN(d)) return null;
  const target = new Date(d); target.setHours(0, 0, 0, 0);
  return Math.round((target - startOfToday()) / 86400000);
}

function formatYmd(date, sep = '') {
  const d = date instanceof Date ? date : new Date(date);
  const p = n => String(n).padStart(2, '0');
  return [d.getFullYear(), p(d.getMonth() + 1), p(d.getDate())].join(sep);
}

function formatMdy(date) {
  const d = date instanceof Date ? date : new Date(date);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())}/${d.getFullYear()}`;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

module.exports = { parseDate, extractDeadline, isExpired, daysUntil, formatYmd, formatMdy, addDays, startOfToday };
