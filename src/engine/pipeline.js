/**
 * Licitaciones Insight Latam — motor de búsqueda, filtrado y puntuación de oportunidades.
 *
 * @author Ariel Geovanny Andino Chinchilla
 * @see    https://github.com/andino1234
 */
'use strict';

const crypto = require('crypto');
const { getPool } = require('../db/pool');
const { env } = require('../config/env');
const { connectors } = require('./connectors');
const { createClient } = require('../lib/http');
const { resolveCountry } = require('../lib/geo');
const { parseDate, isExpired } = require('../lib/dates');
const { compileKeywords, compileExclusions, score, findExclusion } = require('../lib/relevance');
const { squish, isJunkTitle, truncate, fold } = require('../lib/text');
const { logger } = require('../lib/logger');

const REASONS = {
  saved: 'Guardadas',
  duplicates: 'Ya existían',
  outOfRegion: 'Fuera de la región',
  noCountry: 'Sin país de la región',
  expired: 'Vencidas',
  lowScore: 'Poco relevantes',
  excluded: 'Excluidas por palabra',
  invalid: 'Sin título o enlace válido',
  errors: 'Con error al guardar'
};

function parseConfig(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch (_) { return {}; }
}

function hashFor(url, title) {
  return crypto.createHash('sha256').update(`${url}|${title}`).digest('hex');
}

/** Carga palabras clave y exclusiones una vez por ejecución. */
async function loadRules(pool) {
  const [keywords] = await pool.query('SELECT Id, Keyword, GroupName, Points FROM Keywords WHERE IsActive = 1');
  const [discarded] = await pool.query('SELECT Keyword FROM DiscardedKeywords').catch(() => [[]]);
  const [blacklist] = await pool.query('SELECT TitlePattern FROM TitleBlacklist WHERE IsActive = 1').catch(() => [[]]);
  const [countries] = await pool.query('SELECT Id, Name, Region FROM Countries');
  // Una palabra que está en la lista negra nunca suma puntos, aunque siga activa en Palabras clave.
  const banned = new Set(discarded.map(d => fold(d.Keyword)));
  const usable = keywords.filter(k => !banned.has(fold(k.Keyword)));
  return {
    keywords: compileKeywords(usable),
    searchTerms: usable.filter(k => /principal|relacionada/i.test(k.GroupName || ''))
      .sort((a, b) => b.Points - a.Points).map(k => k.Keyword),
    principalTerms: usable.filter(k => /principal/i.test(k.GroupName || '') && Number(k.Points) >= 20)
      .sort((a, b) => b.Points - a.Points).map(k => k.Keyword),
    exclusions: compileExclusions(discarded),
    blacklist: blacklist.map(b => String(b.TitlePattern || '').toLowerCase()).filter(Boolean),
    countryIds: new Map(countries.map(c => [c.Name, { id: c.Id, region: c.Region }]))
  };
}

async function countryIdFor(pool, rules, country) {
  const known = rules.countryIds.get(country.name);
  if (known) return known.id;
  const [res] = await pool.query('INSERT INTO Countries (Name, IsoCode, Region, CreatedAt) VALUES (?, ?, ?, NOW())', [country.name, country.iso, country.region]);
  rules.countryIds.set(country.name, { id: res.insertId, region: country.region });
  return res.insertId;
}

/**
 * Evalúa y guarda un elemento. Devuelve la clave de REASONS que explica el resultado.
 */
async function processItem(pool, rules, source, raw, minScore, newHigh) {
  const title = squish(raw.title);
  const url = squish(raw.url);
  if (!title || !url || isJunkTitle(title) || !/^https?:\/\//i.test(url)) return 'invalid';

  const hash = hashFor(url, title);
  const [dupe] = await pool.query('SELECT Id FROM Opportunities WHERE CombinedHash = ? OR (Url = ? AND SourceId <=> ?) LIMIT 1', [hash, url, source.Id]);
  if (dupe.length) return 'duplicates';

  const description = String(raw.description || '');

  const deadline = parseDate(raw.deadline);
  if (deadline && isExpired(deadline)) return 'expired';
  if (!deadline && !env.scraping.keepWithoutDeadline) return 'invalid';

  const lowerTitle = title.toLowerCase();
  if (findExclusion(title, rules.exclusions) || rules.blacklist.some(p => lowerTitle.includes(p))) return 'excluded';

  const relevance = score({ title, description }, rules.keywords);
  if (relevance.score < minScore) return 'lowScore';
  if (env.scraping.requireKeywordInTitle && !relevance.matches.some(m => m.where === 'título')) return 'lowScore';
  // Fuentes muy grandes (p. ej. compras públicas de Brasil) exigen una palabra Principal en el título.
  if (parseConfig(source.Config).requirePrincipal &&
      !relevance.matches.some(m => /principal/i.test(m.group) && m.where === 'título')) return 'lowScore';

  const geo = resolveCountry({ explicit: raw.explicitCountry, title, description, sourceDefault: source.CountryName });
  if (!geo.country) return geo.reason === 'fuera-de-region' ? 'outOfRegion' : 'noCountry';
  if (geo.country.region === 'REG' && !env.scraping.includeRegional) return 'outOfRegion';

  const countryId = await countryIdFor(pool, rules, geo.country);
  const matched = relevance.matches.slice(0, 12).map(m => ({ k: m.keyword, p: m.points, w: m.where }));

  const [res] = await pool.query(
    `INSERT INTO Opportunities
      (SourceId, OrganizationId, CountryId, Title, Description, Url, CombinedHash, CategoryName, PublishedAt, Deadline,
       DetectedAt, RelevanceScore, RelevanceLevel, Status, StatusChangedAt, Buyer, Reference, Region, MatchedKeywords, Budget)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, 'nueva', NOW(), ?, ?, ?, ?, ?)`,
    [
      source.Id, source.OrganizationId || null, countryId, truncate(title, 1000), truncate(description, 20000), url.slice(0, 1000), hash,
      truncate(raw.category || source.Category || 'Licitación', 150), parseDate(raw.publishedAt), deadline,
      relevance.score, relevance.level, raw.buyer ? truncate(raw.buyer, 500) : null, raw.reference ? truncate(String(raw.reference), 255) : null,
      geo.country.region, JSON.stringify(matched), raw.budget || null
    ]);

  if (relevance.matches.length) {
    const values = relevance.matches.map(m => [res.insertId, m.id, m.keyword, m.group, m.points]);
    await pool.query('INSERT INTO OpportunityMatches (OpportunityId, KeywordId, KeywordText, GroupName, Points) VALUES ?', [values]);
  }
  if (['Alta', 'Crítica'].includes(relevance.level)) {
    newHigh.push({ id: res.insertId, title, country: geo.country.name, deadline, level: relevance.level, source: source.Name, url });
  }
  return 'saved';
}

/**
 * Ejecuta una fuente: descarga, filtra, puntúa y guarda. Nunca lanza excepción:
 * cualquier error queda registrado en SourceRuns y en la ficha de la fuente.
 */
async function runSource(sourceRow, { triggered = 'programado', rules: sharedRules, newHigh = [], http: injectedHttp } = {}) {
  const pool = getPool();
  const rules = sharedRules || await loadRules(pool);
  const source = sourceRow.CountryName !== undefined ? sourceRow : (await pool.query(
    'SELECT s.*, c.Name AS CountryName FROM Sources s LEFT JOIN Countries c ON c.Id = s.CountryId WHERE s.Id = ?', [sourceRow.Id]))[0][0];
  const config = parseConfig(source.Config);
  const connector = connectors[source.Connector] || connectors.html;
  const minScore = Number.isFinite(Number(config.minScore)) ? Number(config.minScore) : env.scraping.minScore;
  const stats = Object.fromEntries(Object.keys(REASONS).map(k => [k, 0]));
  const messages = [];
  const log = msg => { messages.push(msg); logger.info(`[${source.Name}] ${msg}`); };

  const [run] = await pool.query('INSERT INTO SourceRuns (SourceId, StartedAt, Status, Triggered) VALUES (?, NOW(), "running", ?)', [source.Id, triggered]);
  const started = Date.now();
  let found = 0;
  let status = 'ok';
  let errorMessage = null;

  try {
    const http = injectedHttp || createClient({ timeout: Number(config.timeoutMs || 30000), ignoreTlsErrors: Boolean(config.ignoreTlsErrors) });
    const items = await connector.fetch({ http, source, config, log, env, rules });
    found = items.length;
    for (const item of items) {
      try {
        const reason = await processItem(pool, rules, source, item, minScore, newHigh);
        stats[reason]++;
      } catch (e) {
        stats.errors++;
        if (stats.errors <= 3) log(`error al guardar "${truncate(item.title, 60)}": ${e.message}`);
      }
    }
    if (found === 0) {
      status = 'vacio';
      log('La fuente no devolvió ninguna convocatoria. Puede que la página haya cambiado o que no haya avisos vigentes.');
    }
  } catch (e) {
    status = 'error';
    errorMessage = e.message;
    log(`ERROR: ${e.message}`);
    logger.error(`[${source.Name}] ${e.stack || e.message}`);
  }

  const seconds = Math.round((Date.now() - started) / 1000);
  const summary = status === 'error'
    ? errorMessage
    : `${found} encontradas, ${stats.saved} nuevas (${seconds}s)`;

  await pool.query(
    `UPDATE SourceRuns SET FinishedAt = NOW(), Status = ?, Found = ?, Saved = ?, Duplicates = ?, OutOfRegion = ?, NoCountry = ?,
       Expired = ?, LowScore = ?, Excluded = ?, Invalid = ?, Errors = ?, Message = ? WHERE Id = ?`,
    [status, found, stats.saved, stats.duplicates, stats.outOfRegion, stats.noCountry, stats.expired, stats.lowScore,
      stats.excluded, stats.invalid, stats.errors, messages.slice(-30).join('\n'), run.insertId]);

  await pool.query(
    `UPDATE Sources SET LastRunAt = NOW(), LastStatus = ?, LastFound = ?, LastSaved = ?, LastError = ?,
       ConsecutiveFailures = CASE WHEN ? = 'ok' THEN 0 ELSE ConsecutiveFailures + 1 END,
       LastSuccessAt = CASE WHEN ? = 'ok' THEN NOW() ELSE LastSuccessAt END
     WHERE Id = ?`,
    [status, found, stats.saved, status === 'ok' ? null : (errorMessage || summary), status, status, source.Id]);

  return { sourceId: source.Id, name: source.Name, status, found, ...stats, seconds, summary, messages };
}

let running = null;

/** Ejecuta todas las fuentes activas (o solo las que les toca según su frecuencia). */
async function runAll({ force = false, triggered = 'programado' } = {}) {
  if (running) return { alreadyRunning: true, startedAt: running.startedAt };
  running = { startedAt: new Date(), current: null, done: 0, total: 0 };
  const pool = getPool();
  const newHigh = [];
  const results = [];
  try {
    const [sources] = await pool.query(`
      SELECT s.*, c.Name AS CountryName FROM Sources s LEFT JOIN Countries c ON c.Id = s.CountryId
      WHERE s.IsActive = 1 ${force ? '' : 'AND (s.LastRunAt IS NULL OR s.LastRunAt <= DATE_SUB(NOW(), INTERVAL GREATEST(COALESCE(s.FrequencyMinutes,1440),60) MINUTE))'}
      ORDER BY s.LastRunAt IS NOT NULL, s.LastRunAt`);
    running.total = sources.length;
    if (!sources.length) return { results, newHigh };
    const rules = await loadRules(pool);
    for (const source of sources) {
      running.current = source.Name;
      results.push(await runSource(source, { triggered, rules, newHigh }));
      running.done++;
    }
    logger.info(`Búsqueda terminada: ${results.length} fuentes, ${results.reduce((a, r) => a + r.saved, 0)} nuevas`);
    return { results, newHigh };
  } finally {
    try { await require('./browser').closeBrowser(); } catch (_) { /* nada */ }
    running = null;
  }
}

function getRunState() {
  return running ? { isRunning: true, ...running } : { isRunning: false };
}

module.exports = { runSource, runAll, getRunState, loadRules, processItem, REASONS, parseConfig };
