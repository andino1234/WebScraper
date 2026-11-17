'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const opportunities = require('../services/opportunities');
const sources = require('../services/sources');
const keywords = require('../services/keywords');
const users = require('../services/users');
const stats = require('../services/stats');
const { runSource, getRunState, REASONS } = require('../engine/pipeline');
const { runAndNotify } = require('../engine/scheduler');
const { signIn, requireUser, requireAdmin } = require('../middleware/auth');
const { logger } = require('../lib/logger');

const router = express.Router();
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Compatibilidad con integraciones de la versión anterior (Portal Insight Latam)
router.post('/auth/login', wrap(async (req, res) => {
  const user = await users.findByEmail(req.body?.email);
  const ok = user && user.IsActive && await bcrypt.compare(String(req.body?.password || ''), user.PasswordHash);
  if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });
  signIn(res, req, user);
  res.json({ ok: true, user: { id: user.Id, fullName: user.FullName, email: user.Email, role: user.RoleName } });
}));
router.get('/auth/me', requireUser, (req, res) => res.json({ user: req.user }));

router.use(requireUser);

// ---------- Oportunidades ----------
router.get('/oportunidades', wrap(async (req, res) => res.json(await opportunities.list(req.query))));

router.get('/oportunidades/:id/panel', wrap(async (req, res) => {
  const item = await opportunities.get(Number(req.params.id));
  if (!item) return res.status(404).send('<div class="drawer-empty">Esta oportunidad ya no existe.</div>');
  res.render('partials/detail', { o: item, statuses: opportunities.STATUSES, layout: false });
}));

router.post('/oportunidades/estado', wrap(async (req, res) => {
  const { ids, status } = req.body || {};
  const result = await opportunities.setStatus(ids, status, req.user.id);
  res.json(result);
}));

router.post('/oportunidades/deshacer', wrap(async (req, res) => {
  await opportunities.restore(req.body?.previous, req.user.id);
  res.json({ ok: true });
}));

router.post('/oportunidades/:id/notas', wrap(async (req, res) => {
  await opportunities.setNotes(Number(req.params.id), req.body?.notes);
  res.json({ ok: true });
}));

router.get('/contadores', wrap(async (req, res) => res.json(await opportunities.countsByStatus(req.query))));

// ---------- Búsqueda ----------
router.get('/busqueda/estado', (req, res) => res.json(getRunState()));

router.post('/busqueda', requireAdmin, (req, res) => {
  const state = getRunState();
  if (state.isRunning) return res.json({ ok: false, message: `Ya hay una búsqueda en curso (${state.current || 'iniciando'}).` });
  runAndNotify({ force: true, triggered: 'manual' }).catch(e => logger.error(e));
  res.json({ ok: true, message: 'Búsqueda iniciada. Puedes seguir trabajando; los resultados aparecerán solos.' });
});

// ---------- Fuentes ----------
router.get('/fuentes/:id/corridas', wrap(async (req, res) => res.json(await stats.recentRuns(15, Number(req.params.id)))));

router.post('/fuentes/:id/probar', requireAdmin, wrap(async (req, res) => {
  if (getRunState().isRunning) return res.status(409).json({ error: 'Hay una búsqueda general en curso. Intenta cuando termine.' });
  const result = await runSource({ Id: Number(req.params.id) }, { triggered: 'prueba' });
  res.json({ ...result, reasons: REASONS });
}));

router.post('/fuentes', requireAdmin, wrap(async (req, res) => res.json({ id: await sources.create(req.body || {}) })));
router.put('/fuentes/:id', requireAdmin, wrap(async (req, res) => { await sources.update(Number(req.params.id), req.body || {}); res.json({ ok: true }); }));
router.post('/fuentes/:id/activa', requireAdmin, wrap(async (req, res) => { await sources.setActive(Number(req.params.id), Boolean(req.body?.active)); res.json({ ok: true }); }));
router.delete('/fuentes/:id', requireAdmin, wrap(async (req, res) => { await sources.remove(Number(req.params.id)); res.json({ ok: true }); }));
router.get('/fuentes/:id', requireAdmin, wrap(async (req, res) => res.json(await sources.get(Number(req.params.id)))));

// ---------- Palabras clave ----------
router.post('/palabras/probar', wrap(async (req, res) => res.json(await keywords.tryText(req.body?.text))));
router.post('/palabras', requireAdmin, wrap(async (req, res) => res.json({ id: await keywords.create(req.body || {}) })));
router.patch('/palabras/:id', requireAdmin, wrap(async (req, res) => { await keywords.update(Number(req.params.id), req.body || {}); res.json({ ok: true }); }));
router.post('/palabras/:id/lista-negra', requireAdmin, wrap(async (req, res) => { await keywords.moveToExclusions(Number(req.params.id)); res.json({ ok: true }); }));
router.delete('/palabras/:id', requireAdmin, wrap(async (req, res) => { await keywords.remove(Number(req.params.id)); res.json({ ok: true }); }));
router.post('/exclusiones', requireAdmin, wrap(async (req, res) => { await keywords.addExclusion(req.body || {}); res.json({ ok: true }); }));
router.delete('/exclusiones/:id', requireAdmin, wrap(async (req, res) => { await keywords.removeExclusion(Number(req.params.id)); res.json({ ok: true }); }));

// ---------- Usuarios ----------
router.post('/usuarios', requireAdmin, wrap(async (req, res) => { await users.create(req.body || {}); res.json({ ok: true }); }));
router.patch('/usuarios/:id', requireAdmin, wrap(async (req, res) => {
  if (Number(req.params.id) === req.user.id && (req.body?.active === false || req.body?.role === 'Empleado')) {
    return res.status(400).json({ error: 'No puedes desactivarte ni quitarte el rol de administrador a ti mismo.' });
  }
  await users.update(Number(req.params.id), req.body || {});
  res.json({ ok: true });
}));
router.post('/cuenta/clave', wrap(async (req, res) => {
  await users.changeOwnPassword(req.user.id, req.body?.current, req.body?.next);
  res.json({ ok: true });
}));

module.exports = router;
