'use strict';

const { fold, stripAccents, escapeRegExp } = require('./text');

const LEVELS = [
  { name: 'Crítica', min: 100 },
  { name: 'Alta', min: 50 },
  { name: 'Media', min: 25 },
  { name: 'Baja', min: 0 }
];

const GROUP_MIN_POINTS = { principal: 5, relacionada: 3 };
// Lo que aparece solo en la descripción suma como máximo esto: las páginas traen mucho texto
// y sin este tope un aviso de empleo con "evaluación, monitoreo, datos…" en el cuerpo salía "Crítica".
// Para ser Alta o Crítica, el título tiene que mencionar algo relevante.
const DESCRIPTION_CAP = 45;

/**
 * Prepara las palabras clave una sola vez por ejecución.
 * Reglas de coincidencia:
 *  - Sin importar acentos ni mayúsculas ("consultoria" = "Consultoría").
 *  - La palabra debe empezar en un límite de palabra ("tor" no coincide con "sector").
 *  - Se permiten terminaciones (consult -> consultoría, consultant, consultancy).
 *  - Siglas en MAYÚSCULAS de hasta 4 letras (TOR, RFP, EOI, M&E) deben coincidir exactas y en mayúsculas.
 */
function compileKeywords(rows = []) {
  const compiled = [];
  for (const row of rows) {
    const value = String(row.Keyword ?? row.keyword ?? '').trim();
    if (!value) continue;
    const group = String(row.GroupName ?? row.groupName ?? 'General');
    const base = Number(row.Points ?? row.points ?? 0);
    const min = GROUP_MIN_POINTS[fold(group)] || 1;
    const points = Math.max(base, min);
    const isAcronym = value.length <= 4 && value === value.toUpperCase() && /[A-Z]/.test(value);
    const re = isAcronym
      ? new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(stripAccents(value))}(?![A-Za-z0-9])`)
      : new RegExp(`(^|[^a-z0-9])${escapeRegExp(fold(value))}`);
    compiled.push({ id: row.Id ?? row.id ?? null, keyword: value, group, points, isAcronym, re });
  }
  return compiled;
}

function compileExclusions(rows = []) {
  return rows
    .map(r => String(r.Keyword ?? r.keyword ?? r.TitlePattern ?? r ?? '').trim())
    .filter(Boolean)
    .map(value => ({ value, re: new RegExp(`(^|[^a-z0-9])${escapeRegExp(fold(value))}(?![a-z0-9])`) }));
}

function levelFor(score) {
  return LEVELS.find(l => score >= l.min).name;
}

/**
 * Calcula el puntaje. Las coincidencias en el título valen el doble,
 * porque el título dice de qué trata la licitación; la descripción suele traer ruido.
 */
function score({ title, description }, compiledKeywords) {
  const t = { folded: fold(title), raw: stripAccents(title) };
  const d = { folded: fold(description), raw: stripAccents(description) };
  let total = 0;
  const matches = [];
  for (const kw of compiledKeywords) {
    const inTitle = kw.isAcronym ? kw.re.test(t.raw) : kw.re.test(t.folded);
    const inBody = !inTitle && (kw.isAcronym ? kw.re.test(d.raw) : kw.re.test(d.folded));
    if (!inTitle && !inBody) continue;
    const points = inTitle ? kw.points * 2 : kw.points;
    total += points;
    matches.push({ id: kw.id, keyword: kw.keyword, group: kw.group, points, where: inTitle ? 'título' : 'descripción' });
  }
  // No contar dos veces la misma raíz: si coinciden "consult", "consultor" y "consultoría",
  // solo cuenta la más larga (la más específica).
  const kept = [];
  for (const m of matches.sort((a, b) => fold(b.keyword).length - fold(a.keyword).length)) {
    const f = fold(m.keyword);
    if (kept.some(k => fold(k.keyword).startsWith(f))) continue;
    kept.push(m);
  }
  const fromTitle = kept.filter(m => m.where === 'título').reduce((sum, m) => sum + m.points, 0);
  const fromBody = kept.filter(m => m.where !== 'título').reduce((sum, m) => sum + m.points, 0);
  total = fromTitle + Math.min(fromBody, DESCRIPTION_CAP);
  kept.sort((a, b) => b.points - a.points);
  return { score: total, level: levelFor(total), matches: kept };
}

/** Devuelve la primera exclusión encontrada en el título, o null. */
function findExclusion(title, compiledExclusions) {
  const t = fold(title);
  const hit = compiledExclusions.find(e => e.re.test(t));
  return hit ? hit.value : null;
}

module.exports = { compileKeywords, compileExclusions, score, findExclusion, levelFor, LEVELS };
