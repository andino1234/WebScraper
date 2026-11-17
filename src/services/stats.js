'use strict';

const { query, one } = require('../db/pool');

async function dashboard() {
  const kpi = await one(`
    SELECT
      SUM(Status = 'nueva' AND (Deadline IS NULL OR Deadline >= CURDATE())) AS porRevisar,
      SUM(Status = 'nueva' AND DetectedAt >= CURDATE()) AS nuevasHoy,
      SUM(Status = 'nueva' AND RelevanceLevel IN ('Alta','Crítica') AND (Deadline IS NULL OR Deadline >= CURDATE())) AS prioritarias,
      SUM(Status IN ('interesa','preparando') AND Deadline >= CURDATE() AND Deadline <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)) AS vencenSemana,
      SUM(Status = 'interesa' AND (Deadline IS NULL OR Deadline >= CURDATE())) AS interesa,
      SUM(Status = 'preparando') AS preparando,
      SUM(Status = 'enviada') AS enviadas,
      SUM(Status = 'ganada') AS ganadas
    FROM Opportunities`);

  const urgent = await query(`
    SELECT o.Id, o.Title, o.Deadline, o.Status, o.RelevanceLevel, c.Name AS CountryName, c.IsoCode AS CountryIso
    FROM Opportunities o LEFT JOIN Countries c ON c.Id = o.CountryId
    WHERE o.Status IN ('interesa','preparando') AND o.Deadline >= CURDATE()
    ORDER BY o.Deadline ASC LIMIT 8`);

  const top = await query(`
    SELECT o.Id, o.Title, o.Deadline, o.RelevanceLevel, o.RelevanceScore, c.Name AS CountryName, c.IsoCode AS CountryIso, s.Name AS SourceName
    FROM Opportunities o LEFT JOIN Countries c ON c.Id = o.CountryId LEFT JOIN Sources s ON s.Id = o.SourceId
    WHERE o.Status = 'nueva' AND (o.Deadline IS NULL OR o.Deadline >= CURDATE())
    ORDER BY o.RelevanceScore DESC, o.DetectedAt DESC LIMIT 6`);

  const perDay = await query(`
    SELECT DATE(DetectedAt) AS d, COUNT(*) AS n FROM Opportunities
    WHERE DetectedAt >= DATE_SUB(CURDATE(), INTERVAL 13 DAY) GROUP BY DATE(DetectedAt)`);
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
    const hit = perDay.find(r => new Date(r.d).toDateString() === d.toDateString());
    days.push({ date: d, n: hit ? Number(hit.n) : 0 });
  }

  const byRegion = await query(`
    SELECT COALESCE(Region,'?') AS Region, COUNT(*) AS n FROM Opportunities
    WHERE Status IN ('nueva','interesa','preparando') AND (Deadline IS NULL OR Deadline >= CURDATE())
    GROUP BY Region ORDER BY n DESC`);

  const health = await one(`
    SELECT SUM(IsActive = 1) AS activas,
           SUM(IsActive = 1 AND LastStatus = 'ok') AS ok,
           SUM(IsActive = 1 AND LastStatus = 'vacio') AS vacias,
           SUM(IsActive = 1 AND LastStatus = 'error') AS conError,
           SUM(IsActive = 1 AND LastRunAt IS NULL) AS sinCorrer,
           MAX(LastRunAt) AS ultima
    FROM Sources`);
  const failing = await query(`
    SELECT Id, Name, LastStatus, LastError, ConsecutiveFailures FROM Sources
    WHERE IsActive = 1 AND LastStatus IN ('error','vacio') ORDER BY ConsecutiveFailures DESC, Name LIMIT 6`);

  return { kpi, urgent, top, days, byRegion, health, failing };
}

async function recentRuns(limit = 100, sourceId = null) {
  return query(`
    SELECT r.*, s.Name AS SourceName FROM SourceRuns r JOIN Sources s ON s.Id = r.SourceId
    ${sourceId ? 'WHERE r.SourceId = ?' : ''} ORDER BY r.Id DESC LIMIT ?`, sourceId ? [sourceId, limit] : [limit]);
}

async function teamReport(days = 30) {
  return query(`
    SELECT h.ToStatus, COUNT(*) AS n FROM StatusHistory h
    WHERE h.CreatedAt >= DATE_SUB(NOW(), INTERVAL ? DAY) GROUP BY h.ToStatus`, [days]);
}

module.exports = { dashboard, recentRuns, teamReport };
