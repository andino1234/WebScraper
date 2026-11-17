'use strict';
/**
 * Prueba de punta a punta con una base MySQL/MariaDB de prueba (TEST_DB_DATABASE)
 * y respuestas de sitios simuladas (sin internet).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const dbName = process.env.TEST_DB_DATABASE;
const fixture = f => fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8');

test('pipeline completo con fuentes simuladas', { skip: !dbName && 'define TEST_DB_DATABASE para correr esta prueba' }, async () => {
  process.env.DB_DATABASE = dbName;
  const { migrate } = require('../src/db/migrate');
  const { getPool, close } = require('../src/db/pool');
  const { runSource } = require('../src/engine/pipeline');
  await migrate();
  const pool = getPool();
  try {

  const fakeHttp = {
    async getJson(url) { if (url.includes('worldbank')) return JSON.parse(fixture('wb.json')); throw new Error('no esperado ' + url); },
    async getHtml(url) {
      const map = { 'https://ejemplo.org/convocatorias': 'list.html', 'https://ejemplo.org/convocatorias/1': 'detail1.html', 'https://ejemplo.org/convocatorias/3': 'detail3.html' };
      const f = map[url.replace(/\/$/, '')];
      if (!f) { const e = new Error('404'); e.status = 404; throw e; }
      const html = fixture(f);
      return { html, $: cheerio.load(html) };
    }
  };

  const [[wb]] = await pool.query("SELECT Id FROM Sources WHERE Connector = 'worldbank' LIMIT 1");
  await pool.query('DELETE FROM Opportunities WHERE SourceId = ?', [wb.Id]);
  const r1 = await runSource({ Id: wb.Id }, { http: fakeHttp, triggered: 'prueba' });
  assert.equal(r1.status, 'ok');
  assert.equal(r1.found, 5, 'la adjudicación (award) no se cuenta');
  assert.equal(r1.saved, 2, 'Guatemala y Santa Lucía');
  assert.equal(r1.outOfRegion, 1, 'Kenya');
  assert.equal(r1.expired, 1, 'Haití vencida');
  assert.equal(r1.lowScore, 1, 'asfalto no es relevante');
  const [saved] = await pool.query('SELECT o.Title, c.Name AS Country, o.Region, o.Status, o.RelevanceLevel, o.MatchedKeywords FROM Opportunities o JOIN Countries c ON c.Id=o.CountryId WHERE o.SourceId = ? ORDER BY o.Id', [wb.Id]);
  assert.deepEqual(saved.map(s => s.Country), ['Guatemala', 'Santa Lucía']);
  assert.equal(saved[0].Status, 'nueva');
  assert.ok(JSON.parse(saved[0].MatchedKeywords).length > 0);

  const r2 = await runSource({ Id: wb.Id }, { http: fakeHttp });
  assert.equal(r2.saved, 0);
  assert.equal(r2.duplicates, 2, 'segunda corrida: todo duplicado');

  // Fuente HTML genérica
  const [ins] = await pool.query(
    "INSERT INTO Sources (Name, Url, Connector, Config, IsActive) VALUES ('Prueba HTML', 'https://ejemplo.org/convocatorias', 'html', ?, 1)",
    [JSON.stringify({ followDetail: true })]);
  const r3 = await runSource({ Id: ins.insertId }, { http: fakeHttp });
  assert.equal(r3.status, 'ok');
  assert.equal(r3.found, 3, 'login, contacto y facebook no son convocatorias');
  assert.equal(r3.saved, 2);
  assert.equal(r3.lowScore, 1, 'compra de vehículos no es relevante');
  const [html] = await pool.query('SELECT o.Title, o.Deadline, c.Name AS Country FROM Opportunities o JOIN Countries c ON c.Id=o.CountryId WHERE o.SourceId = ? ORDER BY o.Id', [ins.insertId]);
  assert.equal(html[0].Title, 'Consultoría para estudio de línea base en Honduras', 'el "Leer más" se reemplaza por el título real');
  assert.equal(html[0].Country, 'Honduras');
  assert.equal(new Date(html[0].Deadline).getFullYear(), 2099);
  assert.equal(html[1].Country, 'Guatemala');

  const [[srcRow]] = await pool.query('SELECT LastStatus, LastFound, LastSaved FROM Sources WHERE Id = ?', [ins.insertId]);
  assert.equal(srcRow.LastStatus, 'ok');
  assert.equal(srcRow.LastSaved, 2);

  // Fuente que falla
  await pool.query("UPDATE Sources SET Url = 'https://ejemplo.org/no-existe' WHERE Id = ?", [ins.insertId]);
  const r4 = await runSource({ Id: ins.insertId }, { http: fakeHttp });
  assert.equal(r4.status, 'error');
  const [[failed]] = await pool.query('SELECT LastStatus, ConsecutiveFailures FROM Sources WHERE Id = ?', [ins.insertId]);
  assert.equal(failed.LastStatus, 'error');
  assert.equal(failed.ConsecutiveFailures, 1);

  await pool.query('DELETE FROM Opportunities WHERE SourceId = ?', [ins.insertId]);
  await pool.query('DELETE FROM Sources WHERE Id = ?', [ins.insertId]);

  // Lista negra: la palabra deja de sumar puntos y excluye el título que la contenga
  const { loadRules, processItem } = require('../src/engine/pipeline');
  const src = { Id: wb.Id, Name: 'Banco Mundial', CountryName: null };
  const item = n => ({ title: `Evaluation of the school feeding program ${n}`, url: `https://ejemplo.org/ln/${n}`, explicitCountry: 'Honduras' });
  let rules = await loadRules(pool);
  assert.ok(rules.searchTerms.includes('Evaluation'), 'las palabras del equipo se usan para buscar');
  assert.equal(await processItem(pool, rules, src, item(1), 25, []), 'saved');
  await pool.query("INSERT INTO DiscardedKeywords (Keyword, Reason) VALUES ('evaluation', 'prueba')");
  rules = await loadRules(pool);
  assert.ok(!rules.searchTerms.includes('Evaluation'), 'en lista negra: ya no se busca por ella');
  assert.equal(await processItem(pool, rules, src, item(2), 25, []), 'excluded');
  await pool.query("DELETE FROM DiscardedKeywords WHERE Reason = 'prueba'");
  await pool.query("DELETE FROM Opportunities WHERE Url LIKE 'https://ejemplo.org/ln/%'");
  } finally {
    await close();
  }
});
