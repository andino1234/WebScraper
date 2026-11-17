'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const opportunities = require('../services/opportunities');
const stats = require('../services/stats');
const sources = require('../services/sources');
const keywords = require('../services/keywords');
const users = require('../services/users');
const { getRunState } = require('../engine/pipeline');
const { signIn, signOut, requireUser, requireAdmin } = require('../middleware/auth');
const { REGIONS } = require('../config/regions');

const router = express.Router();
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- Sesión ----------
router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', { title: 'Iniciar sesión', volver: req.query.volver || '/' });
});

router.post('/login', wrap(async (req, res) => {
  const { email, password } = req.body || {};
  const user = await users.findByEmail(email);
  const ok = user && user.IsActive && await bcrypt.compare(String(password || ''), user.PasswordHash);
  if (!ok) return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
  signIn(res, req, user);
  const volver = String(req.body.volver || '/');
  res.json({ ok: true, redirect: volver.startsWith('/') && !volver.startsWith('//') ? volver : '/' });
}));

router.post('/logout', (req, res) => { signOut(res, req); res.json({ ok: true, redirect: '/login' }); });

router.use(requireUser);

// ---------- Bandeja de oportunidades ----------
router.get('/', wrap(async (req, res) => {
  const filters = { ...req.query };
  const [data, counts, options] = await Promise.all([
    opportunities.list(filters), opportunities.countsByStatus(filters), opportunities.filterOptions()
  ]);
  res.render('inbox', {
    title: 'Oportunidades', active: 'inbox', filters, data, counts, options,
    statuses: opportunities.STATUSES, regions: REGIONS, openId: Number(req.query.abrir) || null
  });
}));

router.get('/o/:id/abrir', wrap(async (req, res) => {
  const row = await opportunities.trackVisit(Number(req.params.id));
  if (!row) return res.status(404).render('error', { title: 'No encontrada', message: 'La oportunidad ya no existe.' });
  res.redirect(row.Url);
}));

router.get('/exportar', wrap(async (req, res) => {
  const rows = await opportunities.exportRows(req.query);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Oportunidades');
  const labels = Object.fromEntries(opportunities.STATUSES.map(s => [s.id, s.single]));
  ws.columns = [
    { header: 'Título', key: 'Title', width: 70 }, { header: 'Estado', key: 'Status', width: 16 },
    { header: 'Prioridad', key: 'RelevanceLevel', width: 10 }, { header: 'Puntaje', key: 'RelevanceScore', width: 9 },
    { header: 'País', key: 'CountryName', width: 20 }, { header: 'Fuente', key: 'SourceName', width: 26 },
    { header: 'Organismo', key: 'Buyer', width: 30 }, { header: 'Referencia', key: 'Reference', width: 20 },
    { header: 'Fecha límite', key: 'Deadline', width: 14 }, { header: 'Publicada', key: 'PublishedAt', width: 14 },
    { header: 'Detectada', key: 'DetectedAt', width: 14 }, { header: 'Presupuesto', key: 'Budget', width: 16 },
    { header: 'Enlace', key: 'Url', width: 50 }, { header: 'Notas', key: 'Notes', width: 40 }
  ];
  rows.forEach(r => ws.addRow({ ...r, Status: labels[r.Status] || r.Status }));
  ws.getRow(1).font = { bold: true };
  ws.autoFilter = { from: 'A1', to: 'N1' };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="oportunidades-${new Date().toISOString().slice(0, 10)}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}));

// ---------- Panel ----------
router.get('/panel', wrap(async (req, res) => {
  res.render('dashboard', { title: 'Panel', active: 'panel', d: await stats.dashboard(), run: getRunState(), regions: REGIONS });
}));

// ---------- Fuentes ----------
router.get('/fuentes', wrap(async (req, res) => {
  const [list, countries] = await Promise.all([sources.list(), sources.countries()]);
  res.render('sources', {
    title: 'Fuentes', active: 'sources', sources: list, countries, connectors: sources.CONNECTOR_OPTIONS,
    run: getRunState(), regions: REGIONS
  });
}));

router.get('/actividad', wrap(async (req, res) => {
  const sourceId = Number(req.query.fuente) || null;
  res.render('activity', { title: 'Actividad', active: 'activity', runs: await stats.recentRuns(150, sourceId), sourceId });
}));

// ---------- Administración ----------
router.get('/palabras', requireAdmin, wrap(async (req, res) => {
  res.render('keywords', { title: 'Palabras clave', active: 'keywords', ...(await keywords.list()), groups: keywords.GROUPS });
}));

router.get('/usuarios', requireAdmin, wrap(async (req, res) => {
  res.render('users', { title: 'Usuarios', active: 'users', users: await users.list() });
}));

router.get('/cuenta', (req, res) => res.render('account', { title: 'Mi cuenta', active: 'account' }));

// Rutas de la versión anterior -> nuevas
router.get(['/dashboard'], (req, res) => res.redirect('/panel'));
router.get(['/opportunities', '/applications'], (req, res) => res.redirect(req.path === '/applications' ? '/?estado=preparando' : '/'));
router.get('/sources', (req, res) => res.redirect('/fuentes'));
router.get('/keywords', (req, res) => res.redirect('/palabras'));
router.get(['/logs', '/longs', '/reports'], (req, res) => res.redirect('/actividad'));
router.get('/users', (req, res) => res.redirect('/usuarios'));

module.exports = router;
