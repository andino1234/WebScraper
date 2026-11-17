'use strict';

const { query, one } = require('../db/pool');
const { CONNECTOR_OPTIONS } = require('../engine/connectors');

async function list() {
  return query(`
    SELECT s.*, c.Name AS CountryName,
      (SELECT COUNT(*) FROM Opportunities o WHERE o.SourceId = s.Id) AS TotalOpps,
      (SELECT COUNT(*) FROM Opportunities o WHERE o.SourceId = s.Id AND o.DetectedAt >= DATE_SUB(NOW(), INTERVAL 30 DAY)) AS Opps30
    FROM Sources s LEFT JOIN Countries c ON c.Id = s.CountryId
    ORDER BY s.IsActive DESC, FIELD(s.LastStatus, 'error', 'vacio', 'ok') , s.Name`);
}

async function get(id) {
  return one('SELECT s.*, c.Name AS CountryName FROM Sources s LEFT JOIN Countries c ON c.Id = s.CountryId WHERE s.Id = ?', [id]);
}

function validate(body) {
  const name = String(body.name || '').trim();
  const url = String(body.url || '').trim();
  if (!name) throw Object.assign(new Error('El nombre es obligatorio'), { status: 400 });
  if (!/^https?:\/\//i.test(url)) throw Object.assign(new Error('La URL debe empezar con http:// o https://'), { status: 400 });
  const connector = CONNECTOR_OPTIONS.some(c => c.id === body.connector) ? body.connector : 'html';
  let config = body.config;
  if (typeof config === 'string') {
    config = config.trim() ? config : '{}';
    try { JSON.parse(config); } catch (_) { throw Object.assign(new Error('La configuración avanzada no es un JSON válido'), { status: 400 }); }
  } else {
    config = JSON.stringify(config || {});
  }
  const freq = Math.max(60, Number(body.frequencyMinutes || 1440));
  return {
    name, url, connector, config, freq,
    countryId: body.countryId ? Number(body.countryId) : null,
    category: String(body.category || '').trim() || null,
    notes: String(body.notes || '').trim() || null,
    active: body.active === true || body.active === 'true' || body.active === '1' || body.active === 1 ? 1 : 0
  };
}

async function create(body) {
  const v = validate(body);
  const res = await query(
    `INSERT INTO Sources (Name, Url, Connector, ScraperType, Config, CountryId, Category, Notes, FrequencyMinutes, IsActive, CreatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [v.name, v.url, v.connector, v.connector, v.config, v.countryId, v.category, v.notes, v.freq, v.active]);
  return res.insertId;
}

async function update(id, body) {
  const v = validate(body);
  await query(
    `UPDATE Sources SET Name = ?, Url = ?, Connector = ?, Config = ?, CountryId = ?, Category = ?, Notes = ?, FrequencyMinutes = ?, IsActive = ?, UpdatedAt = NOW()
     WHERE Id = ?`,
    [v.name, v.url, v.connector, v.config, v.countryId, v.category, v.notes, v.freq, v.active, id]);
}

async function setActive(id, active) {
  await query('UPDATE Sources SET IsActive = ?, UpdatedAt = NOW() WHERE Id = ?', [active ? 1 : 0, id]);
}

async function remove(id) {
  const [{ n }] = await query('SELECT COUNT(*) AS n FROM Opportunities WHERE SourceId = ?', [id]);
  if (n > 0) throw Object.assign(new Error(`Esta fuente tiene ${n} oportunidades guardadas. Desactívala en lugar de borrarla.`), { status: 409 });
  await query('DELETE FROM SourceRuns WHERE SourceId = ?', [id]);
  await query('DELETE FROM Sources WHERE Id = ?', [id]);
}

async function countries() {
  return query('SELECT Id, Name, Region FROM Countries WHERE Region IS NOT NULL ORDER BY FIELD(Region, "CA","CARIBE","MX","US","BR","REG"), Name');
}

module.exports = { list, get, create, update, setActive, remove, countries, CONNECTOR_OPTIONS };
