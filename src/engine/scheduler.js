'use strict';

const cron = require('node-cron');
const { env } = require('../config/env');
const { runAll } = require('./pipeline');
const { sendDigest } = require('../services/alerts');
const { logger } = require('../lib/logger');

async function runAndNotify(options) {
  const out = await runAll(options);
  if (out.alreadyRunning) return out;
  await sendDigest(out.newHigh);
  return out;
}

/**
 * - Cada hora: solo las fuentes a las que ya les toca según su frecuencia.
 * - Una vez al día (SCRAPE_DAILY_HOUR): todas las fuentes activas.
 * Ya no se borra nada automáticamente: las vencidas simplemente se ocultan de la bandeja.
 */
function startScheduler() {
  const tz = env.timezone;
  cron.schedule('17 * * * *', () => runAndNotify({ force: false, triggered: 'programado' }).catch(e => logger.error(e)), { timezone: tz });
  cron.schedule(`0 ${env.scraping.dailyHour} * * *`, () => runAndNotify({ force: true, triggered: 'diario' }).catch(e => logger.error(e)), { timezone: tz });
  logger.info(`Programador activo (${tz}): revisión cada hora y búsqueda completa a las ${env.scraping.dailyHour}:00`);
}

module.exports = { startScheduler, runAndNotify };
