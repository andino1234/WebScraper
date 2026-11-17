'use strict';

const { query } = require('../db/pool');
const { compileKeywords, score, compileExclusions, findExclusion } = require('../lib/relevance');
const { fold } = require('../lib/text');

const GROUPS = ['Principal', 'Relacionada', 'General'];

async function list() {
  const keywords = await query(`
    SELECT k.*, (SELECT COUNT(*) FROM OpportunityMatches m WHERE m.KeywordId = k.Id) AS Hits
    FROM Keywords k ORDER BY FIELD(k.GroupName, 'Principal', 'Relacionada', 'General'), k.Points DESC, k.Keyword`);
  const exclusions = await query('SELECT Id, Keyword, Reason, CreatedAt FROM DiscardedKeywords ORDER BY Keyword');
  return { keywords, exclusions };
}

async function create({ keyword, group, points }) {
  const value = String(keyword || '').trim();
  if (!value) throw Object.assign(new Error('Escribe la palabra o frase'), { status: 400 });
  const existing = await query('SELECT Keyword FROM Keywords');
  if (existing.some(r => fold(r.Keyword) === fold(value))) throw Object.assign(new Error('Esa palabra ya existe'), { status: 409 });
  const g = GROUPS.includes(group) ? group : 'Relacionada';
  const p = Math.max(1, Math.min(100, Number(points || 20)));
  const res = await query('INSERT INTO Keywords (Keyword, GroupName, Points, IsActive, CreatedAt) VALUES (?, ?, ?, 1, NOW())', [value, g, p]);
  return res.insertId;
}

async function update(id, { group, points, active }) {
  const sets = []; const params = [];
  if (group !== undefined && GROUPS.includes(group)) { sets.push('GroupName = ?'); params.push(group); }
  if (points !== undefined) { sets.push('Points = ?'); params.push(Math.max(1, Math.min(100, Number(points)))); }
  if (active !== undefined) { sets.push('IsActive = ?'); params.push(active ? 1 : 0); }
  if (!sets.length) return;
  await query(`UPDATE Keywords SET ${sets.join(', ')}, UpdatedAt = NOW() WHERE Id = ?`, [...params, id]);
}

async function remove(id) {
  await query('DELETE FROM Keywords WHERE Id = ?', [id]);
}

async function addExclusion({ keyword, reason }) {
  const value = String(keyword || '').trim().toLowerCase();
  if (!value) throw Object.assign(new Error('Escribe la palabra a excluir'), { status: 400 });
  await query('INSERT INTO DiscardedKeywords (Keyword, Reason, CreatedAt) VALUES (?, ?, NOW())', [value, String(reason || '').trim() || null]);
}

/** Pasa una palabra activa a la lista negra (como el botón "Descartar" de la versión anterior). */
async function moveToExclusions(id) {
  const [row] = await query('SELECT Keyword FROM Keywords WHERE Id = ?', [id]);
  if (!row) return;
  await query('INSERT INTO DiscardedKeywords (Keyword, Reason, CreatedAt) VALUES (?, ?, NOW())', [row.Keyword.toLowerCase(), 'Movida desde palabras clave']);
  await query('DELETE FROM Keywords WHERE Id = ?', [id]);
}

async function removeExclusion(id) {
  await query('DELETE FROM DiscardedKeywords WHERE Id = ?', [id]);
}

/** Prueba un título contra las palabras clave actuales y explica el puntaje. */
async function tryText(text) {
  const rows = await query('SELECT Id, Keyword, GroupName, Points FROM Keywords WHERE IsActive = 1');
  const ex = await query('SELECT Keyword FROM DiscardedKeywords');
  const banned = new Set(ex.map(e => fold(e.Keyword)));
  const result = score({ title: String(text || ''), description: '' }, compileKeywords(rows.filter(r => !banned.has(fold(r.Keyword)))));
  const hit = findExclusion(String(text || ''), compileExclusions(ex));
  return { ...result, excludedBy: hit };
}

module.exports = { GROUPS, list, create, update, remove, moveToExclusions, addExclusion, removeExclusion, tryText };
