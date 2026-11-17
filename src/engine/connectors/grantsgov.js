'use strict';

const { sleep } = require('../../lib/http');
const { parseDate } = require('../../lib/dates');

const API = 'https://api.grants.gov/v1/api/search2';

/** EE. UU.: convocatorias de Grants.gov (API pública, sin clave). */
module.exports = {
  id: 'grantsgov',
  label: 'API Grants.gov',
  async fetch({ http, config, log, rules }) {
    // Busca con las palabras clave del equipo (principales y relacionadas, en inglés: Grants.gov es en inglés),
    // más los términos geográficos de la configuración de la fuente.
    const own = (rules?.principalTerms || []).filter(k => /^[\x00-\x7F]+$/.test(k) && k.length > 3).slice(0, 15);
    const extra = (Array.isArray(config.keywords) ? config.keywords : []).filter(k => /^[A-Z]/.test(k));
    const keywords = [...new Set([...own, ...extra])];
    if (!keywords.length) keywords.push('evaluation', 'research', 'survey');
    const byId = new Map();
    for (const keyword of keywords) {
      // Elegibilidad (códigos de Grants.gov): 22 empresas con fines de lucro, 23 pequeñas empresas,
      // 25 otros, 99 sin restricción. Así se excluyen las que son solo para universidades, estados o tribus.
      const body = { keyword, oppStatuses: 'forecasted|posted', rows: 100 };
      const elig = config.eligibilities === undefined ? '22|23|25|99' : config.eligibilities;
      if (elig) body.eligibilities = elig;
      const res = await http.post(API, body, { headers: { 'Content-Type': 'application/json' } });
      const hits = res.data?.data?.oppHits || [];
      for (const h of hits) {
        if (byId.has(h.id)) continue;
        byId.set(h.id, {
          title: h.title,
          url: `https://www.grants.gov/search-results-detail/${h.id}`,
          description: [
            h.agency || h.agencyName ? `Agencia: ${h.agency || h.agencyName}` : null,
            h.number && `Número: ${h.number}`,
            h.oppStatus && `Estado: ${h.oppStatus}`,
            h.docType && `Tipo: ${h.docType}`,
            `Búsqueda: ${keyword}`
          ].filter(Boolean).join('\n'),
          deadline: parseDate(h.closeDate, { preferMonthFirst: true }),
          publishedAt: parseDate(h.openDate, { preferMonthFirst: true }),
          reference: h.number || String(h.id),
          buyer: h.agency || h.agencyName || h.agencyCode || 'Gobierno de EE. UU.',
          category: 'Subvención'
        });
      }
      log(`"${keyword}": ${hits.length} resultados`);
      await sleep(300);
    }
    return [...byId.values()];
  }
};
