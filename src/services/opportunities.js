'use strict';

const { query, one, getPool } = require('../db/pool');

const STATUSES = [
  { id: 'nueva', label: 'Nuevas', single: 'Nueva', hint: 'Por revisar' },
  { id: 'interesa', label: 'Me interesan', single: 'Me interesa', hint: 'Vale la pena evaluarlas' },
  { id: 'preparando', label: 'Preparando', single: 'Preparando propuesta', hint: 'El equipo está armando la propuesta' },
  { id: 'enviada', label: 'Enviadas', single: 'Propuesta enviada', hint: 'Esperando resultado' },
  { id: 'ganada', label: 'Ganadas', single: 'Ganada', hint: '' },
  { id: 'perdida', label: 'No ganadas', single: 'No ganada', hint: '' },
  { id: 'descartada', label: 'Descartadas', single: 'Descartada', hint: 'No aplica' }
];
const STATUS_IDS = STATUSES.map(s => s.id);
// En estas pestañas se muestran también las vencidas (son historial).
const HISTORY_STATUSES = ['enviada', 'ganada', 'perdida', 'descartada'];

const SORTS = {
  relevancia: 'o.RelevanceScore DESC, (o.Deadline IS NULL), o.Deadline ASC, o.Id DESC',
  cierre: '(o.Deadline IS NULL), o.Deadline ASC, o.RelevanceScore DESC',
  recientes: 'o.DetectedAt DESC, o.Id DESC'
};

function buildWhere(f = {}) {
  const where = [];
  const params = [];
  const status = STATUS_IDS.includes(f.estado) ? f.estado : (f.estado === 'todas' ? null : 'nueva');

  if (status) { where.push('o.Status = ?'); params.push(status); }
  const showExpired = f.vencidas === '1' || (status && HISTORY_STATUSES.includes(status));
  if (!showExpired) where.push('(o.Deadline IS NULL OR o.Deadline >= CURDATE())');

  if (f.q) {
    where.push('(o.Title LIKE ? OR o.Description LIKE ? OR o.Buyer LIKE ? OR o.Reference LIKE ?)');
    const like = `%${String(f.q).trim()}%`;
    params.push(like, like, like, like);
  }
  if (f.region) { where.push('o.Region = ?'); params.push(f.region); }
  if (f.pais) { where.push('o.CountryId = ?'); params.push(Number(f.pais)); }
  if (f.fuente) { where.push('o.SourceId = ?'); params.push(Number(f.fuente)); }
  if (f.nivel) {
    const levels = String(f.nivel).split(',').filter(Boolean);
    where.push(`o.RelevanceLevel IN (${levels.map(() => '?').join(',')})`);
    params.push(...levels);
  }
  if (f.cierra === 'sin') where.push('o.Deadline IS NULL');
  else if (['7', '14', '30'].includes(String(f.cierra))) {
    where.push('o.Deadline IS NOT NULL AND o.Deadline <= DATE_ADD(CURDATE(), INTERVAL ? DAY)');
    params.push(Number(f.cierra));
  }
  if (f.desde === 'hoy') where.push('o.DetectedAt >= CURDATE()');
  else if (f.desde === '7') where.push('o.DetectedAt >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)');

  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params, status };
}

const LIST_COLUMNS = `
  o.Id, o.Title, o.Url, o.Deadline, o.PublishedAt, o.DetectedAt, o.RelevanceScore, o.RelevanceLevel, o.Status,
  o.Region, o.Buyer, o.Reference, o.MatchedKeywords, o.VisitCount, o.CategoryName,
  c.Name AS CountryName, c.IsoCode AS CountryIso, s.Name AS SourceName,
  (SELECT COUNT(*) FROM StatusHistory h WHERE h.OpportunityId = o.Id) AS HistoryCount`;

async function list(filters = {}) {
  const pageSize = Math.min(Math.max(Number(filters.por || 30), 10), 100);
  const page = Math.max(Number(filters.pagina || 1), 1);
  const { sql, params, status } = buildWhere(filters);
  const order = SORTS[filters.orden] || SORTS.relevancia;
  const from = `FROM Opportunities o LEFT JOIN Countries c ON c.Id = o.CountryId LEFT JOIN Sources s ON s.Id = o.SourceId ${sql}`;
  const [{ total }] = await query(`SELECT COUNT(*) AS total ${from}`, params);
  const items = await query(`SELECT ${LIST_COLUMNS} ${from} ORDER BY ${order} LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize]);
  return { items: items.map(decorate), total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)), status };
}

/** Cantidad por estado, respetando los demás filtros (para los contadores de las pestañas). */
async function countsByStatus(filters = {}) {
  const counts = Object.fromEntries(STATUS_IDS.map(s => [s, 0]));
  const base = { ...filters, estado: 'todas' };
  // Las pestañas de historial cuentan también las vencidas.
  for (const group of [{ statuses: STATUS_IDS.filter(s => !HISTORY_STATUSES.includes(s)), vencidas: filters.vencidas }, { statuses: HISTORY_STATUSES, vencidas: '1' }]) {
    const { sql, params } = buildWhere({ ...base, vencidas: group.vencidas });
    const rows = await query(
      `SELECT o.Status, COUNT(*) AS n FROM Opportunities o ${sql ? sql + ' AND' : 'WHERE'} o.Status IN (?) GROUP BY o.Status`,
      [...params, group.statuses]);
    for (const r of rows) counts[r.Status] = r.n;
  }
  return counts;
}

function decorate(row) {
  let keywords = [];
  try { keywords = row.MatchedKeywords ? JSON.parse(row.MatchedKeywords) : []; } catch (_) { keywords = []; }
  return { ...row, keywords };
}

async function get(id) {
  const row = await one(`
    SELECT o.*, c.Name AS CountryName, c.IsoCode AS CountryIso, s.Name AS SourceName, s.Url AS SourceUrl,
           u.FullName AS StatusUserName
    FROM Opportunities o
    LEFT JOIN Countries c ON c.Id = o.CountryId
    LEFT JOIN Sources s ON s.Id = o.SourceId
    LEFT JOIN Users u ON u.Id = o.StatusUserId
    WHERE o.Id = ?`, [id]);
  if (!row) return null;
  const history = await query(`
    SELECT h.FromStatus, h.ToStatus, h.CreatedAt, u.FullName AS UserName
    FROM StatusHistory h LEFT JOIN Users u ON u.Id = h.UserId
    WHERE h.OpportunityId = ? ORDER BY h.CreatedAt DESC LIMIT 20`, [id]);
  let keywords = decorate(row).keywords;
  if (!keywords.length) {
    const m = await query('SELECT KeywordText AS k, Points AS p FROM OpportunityMatches WHERE OpportunityId = ? ORDER BY Points DESC', [id]);
    keywords = m;
  }
  return { ...row, keywords, history };
}

async function setStatus(ids, status, userId) {
  if (!STATUS_IDS.includes(status)) throw Object.assign(new Error('Estado no válido'), { status: 400 });
  const list = (Array.isArray(ids) ? ids : [ids]).map(Number).filter(n => n > 0);
  if (!list.length) return { changed: 0 };
  const pool = getPool();
  const current = await query('SELECT Id, Status FROM Opportunities WHERE Id IN (?)', [list]);
  const toChange = current.filter(r => r.Status !== status);
  if (!toChange.length) return { changed: 0 };
  await pool.query('UPDATE Opportunities SET Status = ?, StatusChangedAt = NOW(), StatusUserId = ? WHERE Id IN (?)', [status, userId || null, toChange.map(r => r.Id)]);
  await pool.query('INSERT INTO StatusHistory (OpportunityId, FromStatus, ToStatus, UserId) VALUES ?', [toChange.map(r => [r.Id, r.Status, status, userId || null])]);
  return { changed: toChange.length, previous: toChange.map(r => ({ id: r.Id, status: r.Status })) };
}

/** Deshacer: devuelve cada oportunidad a su estado anterior. */
async function restore(previous, userId) {
  for (const p of previous || []) {
    if (STATUS_IDS.includes(p.status)) await setStatus([p.id], p.status, userId);
  }
}

async function setNotes(id, notes) {
  await query('UPDATE Opportunities SET Notes = ? WHERE Id = ?', [String(notes || '').slice(0, 5000), id]);
}

async function trackVisit(id) {
  await query('UPDATE Opportunities SET VisitCount = VisitCount + 1, LastVisitedAt = NOW() WHERE Id = ?', [id]);
  return one('SELECT Url FROM Opportunities WHERE Id = ?', [id]);
}

async function filterOptions() {
  const countries = await query(`
    SELECT c.Id, c.Name, c.IsoCode, c.Region, COUNT(o.Id) AS n
    FROM Countries c JOIN Opportunities o ON o.CountryId = c.Id
    WHERE c.Region IS NOT NULL GROUP BY c.Id ORDER BY c.Name`);
  const sources = await query(`
    SELECT s.Id, s.Name, COUNT(o.Id) AS n FROM Sources s JOIN Opportunities o ON o.SourceId = s.Id
    GROUP BY s.Id ORDER BY s.Name`);
  return { countries, sources };
}

async function exportRows(filters) {
  const { sql, params } = buildWhere(filters);
  const order = SORTS[filters.orden] || SORTS.relevancia;
  return query(`
    SELECT o.Id, o.Title, o.Status, o.RelevanceLevel, o.RelevanceScore, c.Name AS CountryName, o.Region, s.Name AS SourceName,
           o.Buyer, o.Reference, o.Deadline, o.PublishedAt, o.DetectedAt, o.Budget, o.Url, o.Notes
    FROM Opportunities o LEFT JOIN Countries c ON c.Id = o.CountryId LEFT JOIN Sources s ON s.Id = o.SourceId
    ${sql} ORDER BY ${order} LIMIT 5000`, params);
}

module.exports = { STATUSES, STATUS_IDS, list, countsByStatus, get, setStatus, restore, setNotes, trackVisit, filterOptions, exportRows };
