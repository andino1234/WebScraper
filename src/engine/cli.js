'use strict';

/**
 * Ejecutar la búsqueda desde la terminal:
 *   npm run scrape                  -> todas las fuentes activas
 *   npm run scrape:source -- 19     -> una fuente por Id (aunque esté inactiva)
 */
const { runAll, runSource, REASONS } = require('./pipeline');
const { sendDigest } = require('../services/alerts');
const { close } = require('../db/pool');

function print(r) {
  const detail = Object.entries(REASONS).filter(([k]) => r[k]).map(([k, label]) => `${label}: ${r[k]}`).join(' · ');
  console.log(`\n■ ${r.name} [${r.status}] ${r.summary}${detail ? `\n  ${detail}` : ''}`);
}

(async () => {
  const idx = process.argv.indexOf('--source');
  try {
    if (idx > -1) {
      const id = Number(process.argv[idx + 1]);
      if (!id) throw new Error('Indica el Id de la fuente: npm run scrape:source -- 19');
      print(await runSource({ Id: id }, { triggered: 'manual' }));
    } else {
      const out = await runAll({ force: true, triggered: 'manual' });
      out.results.forEach(print);
      await sendDigest(out.newHigh);
    }
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    await close();
  }
})();
