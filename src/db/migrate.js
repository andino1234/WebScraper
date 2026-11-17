'use strict';

/**
 * Migración idempotente: se puede ejecutar cuantas veces se quiera.
 *  - En una base vacía crea todas las tablas.
 *  - En la base de la versión anterior agrega lo que falta, sin borrar datos.
 * Uso: npm run migrate
 */

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { getPool, close } = require('./pool');
const { env, assertConfig } = require('../config/env');
const { COUNTRIES, LEGACY_NAMES } = require('../config/regions');
const { CATALOG, LEGACY_CONNECTOR, LEGACY_DEACTIVATE } = require('../config/catalog');
const { fold } = require('../lib/text');
const { compileKeywords, score } = require('../lib/relevance');

// Dominio del sitio -> país (para corregir fuentes mal asignadas en la versión anterior)
const TLD_COUNTRY = { gt: 'Guatemala', sv: 'El Salvador', hn: 'Honduras', ni: 'Nicaragua', cr: 'Costa Rica', pa: 'Panamá', bz: 'Belice',
  do: 'República Dominicana', ht: 'Haití', jm: 'Jamaica', mx: 'México', br: 'Brasil', cu: 'Cuba', tt: 'Trinidad y Tobago', bb: 'Barbados' };

const log = (...a) => console.log('[migrate]', ...a);

async function tableExists(pool, table) {
  const [rows] = await pool.query(
    'SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1', [table]);
  return rows.length > 0;
}

async function columnExists(pool, table, column) {
  const [rows] = await pool.query(
    'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1', [table, column]);
  return rows.length > 0;
}

async function indexExists(pool, table, index) {
  const [rows] = await pool.query(
    'SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1', [table, index]);
  return rows.length > 0;
}

async function addColumn(pool, table, column, definition) {
  if (await columnExists(pool, table, column)) return false;
  await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  log(`+ ${table}.${column}`);
  return true;
}

async function addIndex(pool, table, index, definition) {
  if (await indexExists(pool, table, index)) return;
  try {
    await pool.query(`ALTER TABLE \`${table}\` ADD ${definition}`);
    log(`+ índice ${table}.${index}`);
  } catch (e) {
    log(`! no se pudo crear el índice ${index}: ${e.message}`);
  }
}

async function ensureAutoIncrementPk(pool, table) {
  // Los volcados de phpMyAdmin a veces no traen PRIMARY KEY / AUTO_INCREMENT.
  const [rows] = await pool.query(
    "SELECT EXTRA, COLUMN_KEY, COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'Id'", [table]);
  if (!rows.length) return;
  const col = rows[0];
  if (col.COLUMN_KEY !== 'PRI') {
    await pool.query(`ALTER TABLE \`${table}\` ADD PRIMARY KEY (Id)`);
    log(`+ PRIMARY KEY ${table}`);
  }
  if (!String(col.EXTRA).includes('auto_increment')) {
    await pool.query(`ALTER TABLE \`${table}\` MODIFY Id ${col.COLUMN_TYPE} NOT NULL AUTO_INCREMENT`);
    log(`+ AUTO_INCREMENT ${table}`);
  }
}

async function createBaseTables(pool) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS Roles (
      Id INT AUTO_INCREMENT PRIMARY KEY,
      Name VARCHAR(100) NOT NULL,
      CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS Users (
      Id INT AUTO_INCREMENT PRIMARY KEY,
      FullName VARCHAR(200) NOT NULL,
      Email VARCHAR(200) NOT NULL,
      PasswordHash VARCHAR(255) NOT NULL,
      RoleId INT NOT NULL,
      IsActive TINYINT(1) NOT NULL DEFAULT 1,
      CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UpdatedAt DATETIME NULL,
      UNIQUE KEY UQ_Users_Email (Email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS Organizations (
      Id INT AUTO_INCREMENT PRIMARY KEY,
      Name VARCHAR(255) NOT NULL,
      Category VARCHAR(150) NULL,
      CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UpdatedAt DATETIME NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS Countries (
      Id INT AUTO_INCREMENT PRIMARY KEY,
      Name VARCHAR(150) NOT NULL,
      IsoCode VARCHAR(10) NULL,
      CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS Sources (
      Id INT AUTO_INCREMENT PRIMARY KEY,
      Name VARCHAR(255) NOT NULL,
      OrganizationId INT NULL,
      CountryId INT NULL,
      Url VARCHAR(1000) NOT NULL,
      Email VARCHAR(255) NULL,
      Category VARCHAR(150) NULL,
      ScraperType VARCHAR(50) NULL,
      SearchType VARCHAR(50) NULL,
      FrequencyMinutes INT NOT NULL DEFAULT 1440,
      IsActive TINYINT(1) NOT NULL DEFAULT 1,
      CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UpdatedAt DATETIME NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS Keywords (
      Id INT AUTO_INCREMENT PRIMARY KEY,
      Keyword VARCHAR(255) NOT NULL,
      GroupName VARCHAR(100) NOT NULL DEFAULT 'General',
      Points INT NOT NULL DEFAULT 0,
      IsActive TINYINT(1) NOT NULL DEFAULT 1,
      CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UpdatedAt DATETIME NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS DiscardedKeywords (
      Id INT AUTO_INCREMENT PRIMARY KEY,
      Keyword VARCHAR(255) NOT NULL,
      Reason VARCHAR(255) NULL,
      CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UpdatedAt DATETIME NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS Opportunities (
      Id BIGINT AUTO_INCREMENT PRIMARY KEY,
      SourceId INT NULL,
      OrganizationId INT NULL,
      CountryId INT NULL,
      Title VARCHAR(1000) NOT NULL,
      Description TEXT NULL,
      Url VARCHAR(1000) NOT NULL,
      CombinedHash VARCHAR(64) NOT NULL,
      CategoryName VARCHAR(150) NULL,
      PublishedAt DATETIME NULL,
      Deadline DATETIME NULL,
      DetectedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      RelevanceScore INT NOT NULL DEFAULT 0,
      RelevanceLevel VARCHAR(50) NOT NULL DEFAULT 'Baja',
      IsApplied TINYINT(1) NOT NULL DEFAULT 0,
      IsAlertSent TINYINT(1) NOT NULL DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS OpportunityMatches (
      Id BIGINT AUTO_INCREMENT PRIMARY KEY,
      OpportunityId BIGINT NOT NULL,
      KeywordId INT NULL,
      KeywordText VARCHAR(255) NULL,
      GroupName VARCHAR(100) NULL,
      Points INT NULL DEFAULT 0,
      CreatedAt DATETIME NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS TitleBlacklist (
      Id BIGINT AUTO_INCREMENT PRIMARY KEY,
      TitlePattern VARCHAR(500) NOT NULL,
      Reason VARCHAR(255) NULL,
      IsActive TINYINT(1) NOT NULL DEFAULT 1,
      CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    // Nuevas en la versión 2
    `CREATE TABLE IF NOT EXISTS SourceRuns (
      Id BIGINT AUTO_INCREMENT PRIMARY KEY,
      SourceId INT NOT NULL,
      StartedAt DATETIME NOT NULL,
      FinishedAt DATETIME NULL,
      Status VARCHAR(20) NOT NULL DEFAULT 'running',
      Found INT NOT NULL DEFAULT 0,
      Saved INT NOT NULL DEFAULT 0,
      Duplicates INT NOT NULL DEFAULT 0,
      OutOfRegion INT NOT NULL DEFAULT 0,
      NoCountry INT NOT NULL DEFAULT 0,
      Expired INT NOT NULL DEFAULT 0,
      LowScore INT NOT NULL DEFAULT 0,
      Excluded INT NOT NULL DEFAULT 0,
      Invalid INT NOT NULL DEFAULT 0,
      Errors INT NOT NULL DEFAULT 0,
      Message TEXT NULL,
      Triggered VARCHAR(20) NULL,
      KEY IX_SourceRuns_Source (SourceId, StartedAt)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS StatusHistory (
      Id BIGINT AUTO_INCREMENT PRIMARY KEY,
      OpportunityId BIGINT NOT NULL,
      FromStatus VARCHAR(20) NULL,
      ToStatus VARCHAR(20) NOT NULL,
      UserId INT NULL,
      CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY IX_StatusHistory_Opp (OpportunityId),
      KEY IX_StatusHistory_Date (CreatedAt)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS AppSettings (
      SettingKey VARCHAR(100) PRIMARY KEY,
      SettingValue TEXT NULL,
      UpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  ];
  for (const sql of statements) await pool.query(sql);

  for (const t of ['Roles', 'Users', 'Organizations', 'Countries', 'Sources', 'Keywords', 'Opportunities', 'OpportunityMatches']) {
    await ensureAutoIncrementPk(pool, t);
  }
}

async function addV2Columns(pool) {
  await addColumn(pool, 'Countries', 'Region', 'VARCHAR(10) NULL');

  await addColumn(pool, 'Sources', 'FrequencyMinutes', 'INT NOT NULL DEFAULT 1440');
  await addColumn(pool, 'Sources', 'ScraperType', 'VARCHAR(50) NULL');
  await addColumn(pool, 'Sources', 'Connector', "VARCHAR(30) NOT NULL DEFAULT 'html'");
  await addColumn(pool, 'Sources', 'Config', 'TEXT NULL');
  await addColumn(pool, 'Sources', 'Notes', 'VARCHAR(1000) NULL');
  await addColumn(pool, 'Sources', 'LastRunAt', 'DATETIME NULL');
  await addColumn(pool, 'Sources', 'LastStatus', 'VARCHAR(20) NULL');
  await addColumn(pool, 'Sources', 'LastFound', 'INT NULL');
  await addColumn(pool, 'Sources', 'LastSaved', 'INT NULL');
  await addColumn(pool, 'Sources', 'LastError', 'TEXT NULL');
  await addColumn(pool, 'Sources', 'ConsecutiveFailures', 'INT NOT NULL DEFAULT 0');
  await addColumn(pool, 'Sources', 'LastSuccessAt', 'DATETIME NULL');

  const added = await addColumn(pool, 'Opportunities', 'Status', "VARCHAR(20) NOT NULL DEFAULT 'nueva'");
  await addColumn(pool, 'Opportunities', 'StatusChangedAt', 'DATETIME NULL');
  await addColumn(pool, 'Opportunities', 'StatusUserId', 'INT NULL');
  await addColumn(pool, 'Opportunities', 'Notes', 'TEXT NULL');
  await addColumn(pool, 'Opportunities', 'Buyer', 'VARCHAR(500) NULL');
  await addColumn(pool, 'Opportunities', 'Reference', 'VARCHAR(255) NULL');
  await addColumn(pool, 'Opportunities', 'Region', 'VARCHAR(10) NULL');
  await addColumn(pool, 'Opportunities', 'MatchedKeywords', 'TEXT NULL');
  await addColumn(pool, 'Opportunities', 'Budget', 'VARCHAR(100) NULL');
  await addColumn(pool, 'Opportunities', 'VisitCount', 'INT NOT NULL DEFAULT 0');
  await addColumn(pool, 'Opportunities', 'LastVisitedAt', 'DATETIME NULL');
  await addColumn(pool, 'Opportunities', 'IsApplied', 'TINYINT(1) NOT NULL DEFAULT 0');
  await addColumn(pool, 'Opportunities', 'IsAlertSent', 'TINYINT(1) NOT NULL DEFAULT 0');

  await addIndex(pool, 'Opportunities', 'IX_Opp_Status', 'INDEX IX_Opp_Status (Status, Deadline)');
  await addIndex(pool, 'Opportunities', 'IX_Opp_Detected', 'INDEX IX_Opp_Detected (DetectedAt)');
  await addIndex(pool, 'Opportunities', 'IX_Opp_Country', 'INDEX IX_Opp_Country (CountryId)');
  await addIndex(pool, 'Opportunities', 'IX_Opp_Hash', 'INDEX IX_Opp_Hash (CombinedHash)');
  await addIndex(pool, 'Opportunities', 'IX_Opp_Url', 'INDEX IX_Opp_Url (Url(255))');
  await addIndex(pool, 'OpportunityMatches', 'IX_Matches_Opp', 'INDEX IX_Matches_Opp (OpportunityId)');

  return { statusAdded: added };
}

/** Convierte las banderas de la versión anterior al nuevo campo Status (solo la primera vez). */
async function migrateLegacyStatus(pool) {
  const has = async c => columnExists(pool, 'Opportunities', c);
  const parts = [];
  if (await has('ApplicationCompleted')) parts.push("WHEN COALESCE(ApplicationCompleted,0) = 1 THEN 'enviada'");
  if (await has('ApplicationStatus')) parts.push("WHEN COALESCE(ApplicationStatus,0) IN (1,2) THEN 'preparando'");
  parts.push("WHEN COALESCE(IsApplied,0) = 1 THEN 'interesa'");
  if (await has('ValidationDate')) parts.push("WHEN ValidationDate IS NOT NULL AND COALESCE(IsApplied,0) = 0 THEN 'descartada'");
  const [res] = await pool.query(`
    UPDATE Opportunities SET Status = CASE ${parts.join(' ')} ELSE 'nueva' END,
      StatusChangedAt = COALESCE(StatusChangedAt, DetectedAt)
    WHERE Status = 'nueva'`);
  log(`estados convertidos desde la versión anterior: ${res.affectedRows}`);

  // Las rechazadas y vencidas que la versión anterior movió a otras tablas vuelven como
  // historial, para que no se vuelvan a ingresar como nuevas.
  const restore = async (table, status) => {
    if (!(await tableExists(pool, table))) return;
    const [r] = await pool.query(`
      INSERT INTO Opportunities (SourceId, OrganizationId, CountryId, Title, Description, Url, CombinedHash, CategoryName,
        PublishedAt, Deadline, DetectedAt, RelevanceScore, RelevanceLevel, Status, StatusChangedAt)
      SELECT x.SourceId, x.OrganizationId, x.CountryId, LEFT(COALESCE(x.Title,''),1000), x.Description, LEFT(COALESCE(x.Url,''),1000), x.CombinedHash,
        x.CategoryName, x.PublishedAt, x.Deadline, COALESCE(x.DetectedAt, NOW()), COALESCE(x.RelevanceScore,0), COALESCE(x.RelevanceLevel,'Baja'), ?, NOW()
      FROM \`${table}\` x
      WHERE x.CombinedHash IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Opportunities o WHERE o.CombinedHash = x.CombinedHash)`, [status]);
    if (r.affectedRows) log(`recuperadas ${r.affectedRows} desde ${table}`);
  };
  await restore('ReportedOpportunities', 'descartada');
  await restore('ExpiredOpportunities', 'nueva');
  await restore('InApplicationExpiredReports', 'preparando');
}

/** Recalcula prioridad y palabras coincidentes de lo que ya estaba guardado, con las reglas nuevas. */
async function rescoreExisting(pool) {
  const [kwRows] = await pool.query('SELECT Id, Keyword, GroupName, Points FROM Keywords WHERE IsActive = 1');
  const kws = compileKeywords(kwRows);
  const [rows] = await pool.query('SELECT Id, Title, Description FROM Opportunities');
  for (const r of rows) {
    const s = score({ title: r.Title, description: r.Description || '' }, kws);
    const matched = JSON.stringify(s.matches.slice(0, 12).map(m => ({ k: m.keyword, p: m.points, w: m.where })));
    await pool.query('UPDATE Opportunities SET RelevanceScore = ?, RelevanceLevel = ?, MatchedKeywords = ? WHERE Id = ?', [s.score, s.level, matched, r.Id]);
  }
  if (rows.length) log(`prioridad recalculada para ${rows.length} oportunidades existentes`);

  // Lo que la versión anterior guardó de países fuera de la cobertura (Ecuador, Kenia…) pasa a "Descartadas".
  const [res] = await pool.query(`
    UPDATE Opportunities o JOIN Countries c ON c.Id = o.CountryId
    SET o.Status = 'descartada', o.StatusChangedAt = NOW(),
        o.Notes = CONCAT(COALESCE(o.Notes, ''), 'Descartada automáticamente en la v2: país fuera de la cobertura (', c.Name, ').')
    WHERE c.Region IS NULL AND o.Status = 'nueva'`);
  if (res.affectedRows) log(`${res.affectedRows} oportunidades de países fuera de la cobertura pasaron a Descartadas`);
}

async function seedRoles(pool) {
  for (const name of ['Administrador', 'Empleado']) {
    const [r] = await pool.query('SELECT Id FROM Roles WHERE Name = ? LIMIT 1', [name]);
    if (!r.length) await pool.query('INSERT INTO Roles (Name) VALUES (?)', [name]);
  }
}

async function seedAdmin(pool) {
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM Users');
  if (n > 0) return;
  const [[role]] = await pool.query("SELECT Id FROM Roles WHERE Name = 'Administrador' LIMIT 1");
  const password = env.admin.password || crypto.randomBytes(9).toString('base64url');
  await pool.query(
    'INSERT INTO Users (FullName, Email, PasswordHash, RoleId, IsActive, CreatedAt) VALUES (?, ?, ?, ?, 1, NOW())',
    ['Administrador', env.admin.email, await bcrypt.hash(password, 10), role.Id]);
  log(`usuario administrador creado: ${env.admin.email}`);
  if (!env.admin.password) log(`contraseña temporal (cámbiala al entrar): ${password}`);
}

async function seedCountries(pool) {
  const [rows] = await pool.query('SELECT Id, Name FROM Countries');
  const byFold = new Map(rows.map(r => [fold(r.Name), r]));
  for (const c of COUNTRIES) {
    let row = byFold.get(fold(c.name));
    if (!row) {
      // ¿Existe con otro nombre (inglés)?
      const legacy = rows.find(r => LEGACY_NAMES[fold(r.Name)] === c.name || c.aliases.some(a => fold(a) === fold(r.Name)));
      if (legacy) {
        // Renombrar al nombre canónico ("United States" -> "Estados Unidos") para que todo apunte al mismo país.
        await pool.query('UPDATE Countries SET Name = ?, Region = ?, IsoCode = COALESCE(IsoCode, ?) WHERE Id = ?', [c.name, c.region, c.iso, legacy.Id]);
        byFold.set(fold(c.name), { Id: legacy.Id, Name: c.name });
        log(`país renombrado: ${legacy.Name} -> ${c.name}`);
        continue;
      }
      await pool.query('INSERT INTO Countries (Name, IsoCode, Region, CreatedAt) VALUES (?, ?, ?, NOW())', [c.name, c.iso, c.region]);
    } else {
      await pool.query('UPDATE Countries SET Region = ?, IsoCode = COALESCE(IsoCode, ?) WHERE Id = ?', [c.region, c.iso, row.Id]);
    }
  }
  // Unificar duplicados en inglés (p. ej. "Dominican Republic" -> "República Dominicana")
  const [all] = await pool.query('SELECT Id, Name FROM Countries');
  const canonical = new Map(all.filter(r => COUNTRIES.some(c => c.name === r.Name)).map(r => [r.Name, r.Id]));
  for (const r of all) {
    const target = LEGACY_NAMES[fold(r.Name)];
    if (target && canonical.has(target) && canonical.get(target) !== r.Id) {
      const to = canonical.get(target);
      const [a] = await pool.query('UPDATE Opportunities SET CountryId = ? WHERE CountryId = ?', [to, r.Id]);
      const [b] = await pool.query('UPDATE Sources SET CountryId = ? WHERE CountryId = ?', [to, r.Id]);
      await pool.query('UPDATE Countries SET Region = NULL WHERE Id = ?', [r.Id]);
      if (a.affectedRows || b.affectedRows) log(`país unificado: ${r.Name} -> ${target}`);
    }
  }
  // Región de las oportunidades existentes
  await pool.query(`UPDATE Opportunities o JOIN Countries c ON c.Id = o.CountryId SET o.Region = c.Region WHERE o.Region IS NULL`);
}

// Lista base (la misma que usaba el equipo en la versión anterior). Solo se carga si la tabla está vacía.
const DEFAULT_KEYWORDS = [
  ['Consultoría', 'Principal', 35], ['Consultancy', 'Principal', 35], ['Consultant', 'Principal', 35], ['consult', 'Principal', 10],
  ['Investigación', 'Principal', 35], ['research', 'Principal', 35], ['Estudio', 'Principal', 35], ['Market Research', 'Principal', 35],
  ['Estudio de Mercado', 'Principal', 30], ['M&E', 'Principal', 30], ['Monitoring and Evaluation', 'Principal', 30],
  ['Línea Base', 'Principal', 30], ['Baseline', 'Principal', 30], ['Diagnóstico Situacional', 'Principal', 30],
  ['Investigación Social', 'Principal', 30], ['Terms of Reference', 'Principal', 35], ['TOR', 'Principal', 35],
  ['Request for Proposal', 'Principal', 35], ['RFP', 'Principal', 35], ['Expression of Interest', 'Principal', 35], ['EOI', 'Principal', 35],
  ['procurement', 'Principal', 10], ['tender', 'Principal', 10],
  ['Encuesta', 'Relacionada', 25], ['Survey', 'Relacionada', 25], ['Assessment', 'Relacionada', 25], ['Evaluación', 'Relacionada', 25],
  ['Monitoreo', 'Relacionada', 25], ['Monitoring', 'Relacionada', 25], ['Data Collection', 'Relacionada', 25],
  ['Recolección de Datos', 'Relacionada', 25], ['Data Analysis', 'Relacionada', 25], ['Análisis de Datos', 'Relacionada', 25],
  ['Focus Group', 'Relacionada', 25], ['Grupo Focal', 'Relacionada', 25], ['Servicios Profesionales', 'Relacionada', 25],
  ['Asistencia Técnica', 'Relacionada', 25], ['services', 'Relacionada', 5],
  ['Jóvenes', 'General', 10], ['Pobreza', 'General', 10], ['Niñez', 'General', 10], ['Mujeres', 'General', 10],
  ['Actores Clave', 'General', 10], ['Stakeholders', 'General', 10], ['Alcohol', 'General', 10], ['Tabaco', 'General', 10],
  ['Embarazo', 'General', 10], ['MIPYME', 'General', 10], ['Violencia', 'General', 10], ['Delincuencia', 'General', 10],
  ['Población en riesgo', 'General', 10], ['Prevención', 'General', 10], ['Campaña', 'General', 10], ['Enfermedad', 'General', 10],
  ['Social', 'General', 10], ['Mercado', 'General', 10], ['Impacto', 'General', 10], ['Cuantitativa', 'General', 10],
  ['Cualitativa', 'General', 10], ['Neuromarketing', 'General', 10], ['Datos', 'General', 10], ['Diagnóstico', 'General', 10],
  ['Económico', 'General', 10], ['Salud', 'General', 10], ['Empresarial', 'General', 10], ['Político', 'General', 10],
  ['Vulnerables', 'General', 10], ['Empleo', 'General', 10], ['Inversión', 'General', 10], ['Fortalecimiento', 'General', 10],
  ['Emprendimiento', 'General', 10], ['Emprendedor', 'General', 10]
];

const EXTRA_KEYWORDS = [
  // Inglés
  ['Evaluation', 'Principal', 30], ['Impact Evaluation', 'Principal', 35], ['Study', 'Relacionada', 25],
  ['Opinion Poll', 'Relacionada', 25], ['Polling', 'Relacionada', 25], ['Qualitative', 'Relacionada', 15],
  ['Quantitative', 'Relacionada', 15], ['Call for Proposals', 'Relacionada', 15],
  // Español
  ['Sondeo', 'Relacionada', 25], ['Estudio de Opinión', 'Principal', 30], ['Evaluación de Impacto', 'Principal', 35],
  ['Términos de Referencia', 'Principal', 35], ['Consultor', 'Principal', 30],
  // Portugués (Brasil)
  ['Pesquisa', 'Principal', 35], ['Pesquisa de Mercado', 'Principal', 35], ['Pesquisa de Opinião', 'Principal', 35],
  ['Consultoria', 'Principal', 35], ['Estudo', 'Relacionada', 25], ['Avaliação', 'Relacionada', 25],
  ['Linha de Base', 'Principal', 30], ['Levantamento de Dados', 'Relacionada', 25], ['Coleta de Dados', 'Relacionada', 25],
  ['Análise de Dados', 'Relacionada', 25], ['Monitoramento', 'Relacionada', 20], ['Assessoria Técnica', 'Relacionada', 20],
  ['Termo de Referência', 'Principal', 35]
];

async function seedKeywords(pool) {
  const [rows] = await pool.query('SELECT Keyword FROM Keywords');
  const existing = new Set(rows.map(r => fold(r.Keyword)));
  let added = 0;
  const list = rows.length ? EXTRA_KEYWORDS : [...DEFAULT_KEYWORDS, ...EXTRA_KEYWORDS];
  for (const [kw, group, points] of list) {
    if (existing.has(fold(kw))) continue;
    await pool.query('INSERT INTO Keywords (Keyword, GroupName, Points, IsActive, CreatedAt) VALUES (?, ?, ?, 1, NOW())', [kw, group, points]);
    existing.add(fold(kw));
    added++;
  }
  if (added) log(`palabras clave agregadas: ${added}`);

  // Corregir errores de tipeo conocidos de la versión anterior
  await pool.query("UPDATE Keywords SET Keyword = 'Alcohol' WHERE Keyword = 'Acohol'");
}

async function upsertSources(pool) {
  const [countries] = await pool.query('SELECT Id, Name FROM Countries');
  const countryId = name => (name ? (countries.find(c => c.Name === name) || {}).Id || null : null);
  const [sources] = await pool.query('SELECT * FROM Sources');

  // 1) Fuentes viejas: asignar conector y desactivar las que no son páginas de licitaciones.
  for (const s of sources) {
    const legacyType = fold(s.ScraperType || '').replace(/[\s_-]+/g, '');
    if (s.Connector === 'html' && !s.Config) {
      let connector = LEGACY_CONNECTOR[legacyType] || 'html';
      let config = null;
      if (legacyType === 'pnud') config = { hrefInclude: 'view_negotiation|view_notice|nego_id', include: '.', followDetail: true, maxItems: 60 };
      else if (['acnur', 'crs', 'oit', 'sica', 'guatecompras'].includes(legacyType)) config = { useBrowser: true, followDetail: true };
      else if (connector === 'html') config = { followDetail: true };
      await pool.query('UPDATE Sources SET Connector = ?, Config = ? WHERE Id = ?', [connector, config ? JSON.stringify(config) : null, s.Id]);
      // País según el dominio (.sv, .gt, .hn…) cuando la versión anterior lo tenía mal asignado
      try {
        const tld = new URL(s.Url).hostname.split('.').pop();
        const target = TLD_COUNTRY[tld] && countryId(TLD_COUNTRY[tld]);
        if (target && target !== s.CountryId) {
          await pool.query('UPDATE Sources SET CountryId = ? WHERE Id = ?', [target, s.Id]);
          log(`país corregido: ${s.Name} -> ${TLD_COUNTRY[tld]}`);
        }
      } catch (_) { /* URL inválida */ }
    }
    const reason = LEGACY_DEACTIVATE[s.Name];
    if (reason && s.IsActive && !s.Notes) {
      await pool.query('UPDATE Sources SET IsActive = 0, Notes = ? WHERE Id = ?', [`Desactivada en v2: ${reason}`, s.Id]);
      log(`fuente desactivada: ${s.Name} (${reason})`);
    }
    if (s.Name === 'AECID' && /transparencia\.gob\.es/.test(s.Url) && s.IsActive && !s.Notes) {
      await pool.query('UPDATE Sources SET IsActive = 0, Notes = ? WHERE Id = ?', ['Desactivada en v2: es el buscador de transparencia de España, no convocatorias.', s.Id]);
    }
  }

  // 2) Fuentes del catálogo: crear las que falten; si existe una vieja equivalente, reutilizarla.
  const [current] = await pool.query('SELECT Id, Name, Connector, Url FROM Sources');
  for (const entry of CATALOG) {
    let row = current.find(s => s.Name === entry.name)
      || (['worldbank', 'idb', 'ungm'].includes(entry.connector) ? current.find(s => s.Connector === entry.connector && s.Name !== 'Naciones Unidas') : null)
      || current.find(s => s.Url && s.Url.replace(/\/+$/, '') === entry.url.replace(/\/+$/, ''));
    if (row) {
      await pool.query(
        `UPDATE Sources SET Name = ?, Connector = ?, Url = ?, Config = ?, Notes = COALESCE(Notes, ?), Category = COALESCE(Category, ?),
           CountryId = COALESCE(?, CountryId) WHERE Id = ? AND (Config IS NULL OR Connector <> ?)`,
        [entry.name, entry.connector, entry.url, JSON.stringify(entry.config || {}), entry.notes || null, entry.category,
          countryId(entry.country), row.Id, entry.connector]);
      continue;
    }
    await pool.query(
      `INSERT INTO Sources (Name, Url, Category, ScraperType, Connector, Config, CountryId, FrequencyMinutes, IsActive, Notes, CreatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1440, ?, ?, NOW())`,
      [entry.name, entry.url, entry.category, entry.connector, entry.connector, JSON.stringify(entry.config || {}),
        countryId(entry.country), entry.active ? 1 : 0, entry.notes || null]);
    log(`fuente nueva: ${entry.name}${entry.active ? '' : ' (inactiva)'}`);
  }

  // País de las fuentes del catálogo que quedaron sin país
  for (const entry of CATALOG.filter(e => e.country)) {
    await pool.query('UPDATE Sources SET CountryId = ? WHERE Name = ? AND CountryId IS NULL', [countryId(entry.country), entry.name]);
  }
  // Fuentes de muchos países: sin país por defecto (cada aviso trae el suyo).
  await pool.query(`UPDATE Sources SET CountryId = NULL WHERE CountryId IS NOT NULL
    AND (Connector IN ('worldbank','idb','ungm') OR Url LIKE '%jobs.unicef.org%' OR Url LIKE '%procurement-notices.undp.org%')`);

  // SAM.gov se activa sola si hay clave configurada
  if (env.scraping.samApiKey) await pool.query("UPDATE Sources SET IsActive = 1 WHERE Connector = 'samgov'");
}

/** Revisa con las reglas actuales lo que está en "Nuevas" y descarta lo que ya no cumple. */
async function recheckNew(pool, label) {
  // Revisar con las reglas actuales lo que está en "Nuevas" y pasar a "Descartadas" lo que no cumple.
  const { loadRules } = require('../engine/pipeline');
  const { resolveCountry } = require('../lib/geo');
  const { findExclusion } = require('../lib/relevance');
  const rules = await loadRules(pool);
  const [items] = await pool.query(`SELECT o.Id, o.Title, o.Description, s.Config FROM Opportunities o
    LEFT JOIN Sources s ON s.Id = o.SourceId WHERE o.Status = 'nueva'`);
  let discarded = 0;
  for (const o of items) {
    const sc = score({ title: o.Title, description: o.Description || '' }, rules.keywords);
    let cfg = {}; try { cfg = JSON.parse(o.Config || '{}'); } catch (_) { cfg = {}; }
    let reason = null;
    if (findExclusion(o.Title, rules.exclusions)) reason = 'palabra en lista negra';
    else if (sc.score < env.scraping.minScore) reason = 'poco relevante';
    else if (env.scraping.requireKeywordInTitle && !sc.matches.some(m => m.where === 'título')) reason = 'ninguna palabra clave en el título';
    else if (cfg.requirePrincipal && !sc.matches.some(m => /principal/i.test(m.group) && m.where === 'título')) reason = 'sin palabra principal en el título';
    else if (resolveCountry({ title: o.Title }).reason === 'fuera-de-region') reason = 'país fuera de la cobertura';
    const matched = JSON.stringify(sc.matches.slice(0, 12).map(m => ({ k: m.keyword, p: m.points, w: m.where })));
    if (reason) {
      discarded++;
      await pool.query(`UPDATE Opportunities SET Status = 'descartada', StatusChangedAt = NOW(), RelevanceScore = ?, RelevanceLevel = ?, MatchedKeywords = ?,
        Notes = CONCAT(COALESCE(Notes, ''), CONCAT('Descartada en la revisión automática ', ?, ': '), ?, '.') WHERE Id = ?`, [sc.score, sc.level, matched, label, reason, o.Id]);
    } else {
      await pool.query('UPDATE Opportunities SET RelevanceScore = ?, RelevanceLevel = ?, MatchedKeywords = ? WHERE Id = ?', [sc.score, sc.level, matched, o.Id]);
    }
  }
  log(`revisión ${label}: ${items.length} nuevas revisadas, ${discarded} pasaron a Descartadas`);
}

/** Ajustes de la versión 2.2: Grants.gov solo para empresas y con palabra principal en el título. */
async function patch22(pool) {
  const [[done]] = await pool.query("SELECT COUNT(*) AS n FROM AppSettings WHERE SettingKey = 'patch_2_2'");
  if (done.n) return;
  const [rows] = await pool.query("SELECT Id, Config FROM Sources WHERE Connector = 'grantsgov'");
  for (const r of rows) {
    let cfg = {}; try { cfg = JSON.parse(r.Config || '{}'); } catch (_) { cfg = {}; }
    cfg.requirePrincipal = true;
    await pool.query('UPDATE Sources SET Config = ? WHERE Id = ?', [JSON.stringify(cfg), r.Id]);
  }
  await recheckNew(pool, 'v2.2');
  await pool.query("INSERT INTO AppSettings (SettingKey, SettingValue) VALUES ('patch_2_2', NOW())");
}

/** Ajustes de la versión 2.1 (se aplican una sola vez). */
async function patch21(pool) {
  const [[done]] = await pool.query("SELECT COUNT(*) AS n FROM AppSettings WHERE SettingKey = 'patch_2_1'");
  if (done.n) return;

  // "Termo de Referência" / "Términos de Referencia" aparecen en casi todos los avisos (es el anexo obligatorio):
  // no dicen nada del tema, así que bajan a 5 puntos.
  await pool.query("UPDATE Keywords SET Points = 5, GroupName = 'General' WHERE Keyword IN ('Termo de Referência', 'Términos de Referencia')");
  // "consult" encontraba "consultório" (consultorios médicos)
  for (const [kw, reason] of [['consultorio', 'Consultorio médico, no consultoría'], ['consultorios', 'Consultorios médicos, no consultoría']]) {
    const [x] = await pool.query('SELECT Id FROM DiscardedKeywords WHERE Keyword = ?', [kw]);
    if (!x.length) await pool.query('INSERT INTO DiscardedKeywords (Keyword, Reason, CreatedAt) VALUES (?, ?, NOW())', [kw, reason]);
  }
  // Brasil: exigir palabra principal en el título
  const [pncp] = await pool.query("SELECT Id, Config FROM Sources WHERE Connector = 'pncp'");
  for (const p of pncp) {
    let cfg = {}; try { cfg = JSON.parse(p.Config || '{}'); } catch (_) { cfg = {}; }
    cfg.requirePrincipal = true;
    await pool.query('UPDATE Sources SET Config = ? WHERE Id = ?', [JSON.stringify(cfg), p.Id]);
  }
  // CAF: certificado mal instalado en su servidor
  const [caf] = await pool.query("SELECT Id, Config FROM Sources WHERE Url LIKE '%caf.com%'");
  for (const c of caf) {
    let cfg = {}; try { cfg = JSON.parse(c.Config || '{}'); } catch (_) { cfg = {}; }
    cfg.ignoreTlsErrors = true;
    await pool.query('UPDATE Sources SET Config = ? WHERE Id = ?', [JSON.stringify(cfg), c.Id]);
  }

  await recheckNew(pool, 'v2.1');
  await pool.query("INSERT INTO AppSettings (SettingKey, SettingValue) VALUES ('patch_2_1', NOW())");
}

async function migrate() {
  const missing = assertConfig().filter(m => m.startsWith('DB_'));
  if (missing.length) throw new Error(`Falta configurar en .env: ${missing.join(', ')}`);
  const pool = getPool();
  log(`base de datos: ${env.db.database}@${env.db.host}`);
  await createBaseTables(pool);
  const { statusAdded } = await addV2Columns(pool);
  if (statusAdded) await migrateLegacyStatus(pool);
  await seedRoles(pool);
  await seedAdmin(pool);
  await seedCountries(pool);
  await seedKeywords(pool);
  if (statusAdded) await rescoreExisting(pool);
  await upsertSources(pool);
  await patch21(pool);
  await patch22(pool);
  // v2.3: palabra clave obligatoria en el título
  const [[p23]] = await pool.query("SELECT COUNT(*) AS n FROM AppSettings WHERE SettingKey = 'patch_2_3'");
  if (!p23.n) {
    await recheckNew(pool, 'v2.3');
    await pool.query("INSERT INTO AppSettings (SettingKey, SettingValue) VALUES ('patch_2_3', NOW())");
  }
  await pool.query("INSERT IGNORE INTO AppSettings (SettingKey, SettingValue) VALUES ('schema_version', '2')");
  log('listo ✔');
}

if (require.main === module) {
  migrate()
    .then(() => close())
    .catch(async e => { console.error('[migrate] ERROR:', e.message); await close(); process.exit(1); });
}

module.exports = { migrate };
