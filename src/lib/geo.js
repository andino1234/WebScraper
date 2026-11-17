'use strict';

const { COUNTRIES, REGIONS, LEGACY_NAMES, OTHER_COUNTRIES } = require('../config/regions');
const { fold, stripAccents, escapeRegExp } = require('./text');

// Precompilar expresiones: alias más largos primero para que
// "latin america and the caribbean" gane sobre "caribbean".
const MATCHERS = [];
for (const country of COUNTRIES) {
  for (const alias of country.aliases) {
    MATCHERS.push({
      country,
      length: alias.length,
      re: new RegExp(`(^|[^a-z0-9])${escapeRegExp(fold(alias))}(?![a-z0-9])`, 'g'),
      folded: true
    });
  }
  for (const alias of country.caseSensitive || []) {
    MATCHERS.push({
      country,
      length: alias.length,
      re: new RegExp(`(^|[^A-Za-z0-9.])${escapeRegExp(alias)}(?![A-Za-z0-9])`, 'g'),
      folded: false
    });
  }
}
MATCHERS.sort((a, b) => b.length - a.length);

const OTHER_RE = new RegExp(`(^|[^a-z0-9])(${[...new Set(OTHER_COUNTRIES.map(fold))].sort((a, b) => b.length - a.length).map(escapeRegExp).join('|')})(?![a-z0-9])`);

/** Devuelve el primer país fuera de la cobertura que mencione el texto, o null. */
function mentionsOtherCountry(text) {
  if (!text) return null;
  const m = fold(text).match(OTHER_RE);
  return m ? m[2] : null;
}

const BY_NAME = new Map(COUNTRIES.map(c => [fold(c.name), c]));

/** Devuelve el país canónico para un nombre exacto (o alias exacto), o null. */
function findCountry(name) {
  if (!name) return null;
  const key = fold(String(name).trim());
  if (!key) return null;
  if (BY_NAME.has(key)) return BY_NAME.get(key);
  if (Object.prototype.hasOwnProperty.call(LEGACY_NAMES, key)) {
    const mapped = LEGACY_NAMES[key];
    return mapped ? BY_NAME.get(fold(mapped)) : null;
  }
  for (const c of COUNTRIES) {
    if (c.aliases.some(a => fold(a) === key)) return c;
    if ((c.caseSensitive || []).includes(String(name).trim())) return c;
    if (c.iso && c.iso === String(name).trim().toUpperCase() && String(name).trim().length === 2) return c;
  }
  return null;
}

/**
 * Busca países objetivo mencionados en un texto.
 * Devuelve [{ country, count }] ordenado: países concretos antes que agrupaciones regionales,
 * y luego por número de menciones.
 */
function detectCountries(text) {
  if (!text) return [];
  let folded = fold(text);
  let raw = stripAccents(text);
  const counts = new Map();

  for (const m of MATCHERS) {
    const haystack = m.folded ? folded : raw;
    const found = haystack.match(m.re);
    if (!found) continue;
    counts.set(m.country, (counts.get(m.country) || 0) + found.length);
    // Borrar lo encontrado para que alias más cortos no lo vuelvan a contar
    // ("latin america and the caribbean" no debe sumar también "caribbean").
    if (m.folded) folded = folded.replace(m.re, '$1 ');
    else raw = raw.replace(m.re, '$1 ');
  }

  return [...counts.entries()]
    .map(([country, count]) => ({ country, count }))
    .sort((a, b) => {
      const ra = a.country.region === 'REG' ? 1 : 0;
      const rb = b.country.region === 'REG' ? 1 : 0;
      if (ra !== rb) return ra - rb;
      return b.count - a.count;
    });
}

/**
 * Decide el país de una oportunidad.
 *  - explicit: país que trae la fuente (API). Si viene y NO es de la región, se descarta.
 *  - title / description: se buscan menciones (el título pesa más).
 *  - sourceDefault: país configurado en la fuente (p. ej. Guatecompras -> Guatemala).
 * Devuelve { country, reason } donde country es null si no corresponde a la región.
 */
function resolveCountry({ explicit, title, description, sourceDefault } = {}) {
  const explicitList = (Array.isArray(explicit) ? explicit : [explicit]).filter(Boolean);

  if (explicitList.length) {
    for (const value of explicitList) {
      const direct = findCountry(value);
      if (direct) return { country: direct, reason: 'fuente' };
      const inside = detectCountries(value);
      if (inside.length) return { country: inside[0].country, reason: 'fuente' };
    }
    // La fuente dijo un país, pero no es de la región. Antes de descartar,
    // revisar si el título menciona un país objetivo (avisos regionales).
    const fromTitle = detectCountries(title);
    if (fromTitle.length && fromTitle[0].country.region !== 'REG') {
      return { country: fromTitle[0].country, reason: 'titulo' };
    }
    return { country: null, reason: 'fuera-de-region', detail: explicitList.join(', ') };
  }

  const fromTitle = detectCountries(title);
  if (fromTitle.length && fromTitle[0].country.region !== 'REG') return { country: fromTitle[0].country, reason: 'titulo' };

  // El título nombra un país fuera de la cobertura (p. ej. "…Ulaanbaatar, Mongolia"): se descarta
  // aunque la fuente tenga un país por defecto.
  const otherInTitle = mentionsOtherCountry(title);
  if (otherInTitle) return { country: null, reason: 'fuera-de-region', detail: otherInTitle };
  if (fromTitle.length) return { country: fromTitle[0].country, reason: 'titulo' };

  const fromBody = detectCountries(description);
  if (fromBody.length) return { country: fromBody[0].country, reason: 'texto' };

  const fallback = findCountry(sourceDefault);
  if (fallback) return { country: fallback, reason: 'fuente-por-defecto' };

  const otherInBody = mentionsOtherCountry(description);
  if (otherInBody) return { country: null, reason: 'fuera-de-region', detail: otherInBody };

  return { country: null, reason: 'sin-pais' };
}

function regionOf(countryName) {
  const c = findCountry(countryName);
  return c ? c.region : null;
}

function regionName(code) {
  return REGIONS[code] ? REGIONS[code].name : '';
}

function countriesInRegion(code) {
  return COUNTRIES.filter(c => c.region === code);
}

module.exports = { findCountry, detectCountries, mentionsOtherCountry, resolveCountry, regionOf, regionName, countriesInRegion, COUNTRIES, REGIONS };
