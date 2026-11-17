/**
 * Licitaciones Insight Latam — servidor Express (API REST + interfaz web).
 *
 * @author Ariel Geovanny Andino Chinchilla
 * @see    https://github.com/andino1234
 */
'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const { env, assertConfig } = require('./config/env');
const { logger } = require('./lib/logger');
const { loadUser, csrf } = require('./middleware/auth');
const viewHelpers = require('./lib/viewHelpers');

const missing = assertConfig();
if (missing.length) {
  console.error(`\nFalta configurar en .env:\n  - ${missing.join('\n  - ')}\n`);
  process.exit(1);
}

const app = express();
app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.locals.h = viewHelpers;

app.use(helmet({ contentSecurityPolicy: false, frameguard: false, crossOriginEmbedderPolicy: false }));
app.use((req, res, next) => {
  // Permite mostrar la app dentro del Portal Insight Latam y de Microsoft Teams.
  res.setHeader('Content-Security-Policy', `frame-ancestors ${env.frameAncestors}`);
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { maxAge: env.isProduction ? '1d' : 0 }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1500, standardHeaders: true, legacyHeaders: false }));
app.post(['/login', '/api/auth/login'], rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: { error: 'Demasiados intentos. Espera unos minutos.' } }));

app.get('/salud', (req, res) => res.json({ ok: true, version: '2.0.0', hora: new Date().toISOString() }));
app.get('/health', (req, res) => res.json({ ok: true }));

app.use(loadUser);
app.use(csrf);
app.use(require('./routes/web'));
app.use('/api', require('./routes/api'));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'No encontrado' });
  res.status(404).render('error', { title: 'No encontrado', message: 'Esta página no existe.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) logger.error(`${req.method} ${req.originalUrl}: ${err.stack || err.message}`);
  const message = status >= 500 && env.isProduction ? 'Ocurrió un error inesperado. Ya quedó registrado.' : err.message;
  if (req.path.startsWith('/api/') || req.xhr) return res.status(status).json({ error: message });
  res.status(status).render('error', { title: 'Error', message });
});

if (require.main === module) {
  // La migración es segura de repetir: al arrancar deja la base de datos al día
  // (así no hace falta ejecutar "npm run migrate" a mano en el servidor).
  const prepare = process.env.AUTO_MIGRATE === 'false'
    ? Promise.resolve()
    : require('./db/migrate').migrate().catch(e => {
      logger.error(`No se pudo preparar la base de datos: ${e.message}`);
      process.exit(1);
    });
  prepare.then(() => {
    app.listen(env.port, () => {
      logger.info(`Licitaciones v2 escuchando en el puerto ${env.port}`);
      if (process.env.DISABLE_SCHEDULER !== 'true') require('./engine/scheduler').startScheduler();
    });
  });
}

module.exports = app;
