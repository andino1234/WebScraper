'use strict';

const { env } = require('../../config/env');
const { formatMdy, addDays } = require('../../lib/dates');
const { sleep } = require('../../lib/http');

const API = 'https://api.sam.gov/opportunities/v2/search';

/** EE. UU.: contratos federales en SAM.gov. Requiere SAM_API_KEY (gratuita). */
module.exports = {
  id: 'samgov',
  label: 'API SAM.gov',
  async fetch({ http, config, log }) {
    if (!env.scraping.samApiKey) throw new Error('Falta SAM_API_KEY en el archivo .env (clave gratuita de sam.gov).');
    const days = Number(config.days || 14);
    const naics = Array.isArray(config.naics) && config.naics.length ? config.naics : [null];
    const byId = new Map();
    for (const code of naics) {
      const params = {
        api_key: env.scraping.samApiKey,
        postedFrom: formatMdy(addDays(new Date(), -days)),
        postedTo: formatMdy(new Date()),
        limit: 1000
      };
      if (code) params.ncode = code;
      const data = await http.getJson(API, { params });
      const list = data?.opportunitiesData || [];
      for (const o of list) {
        if (/award/i.test(o.type || '') || byId.has(o.noticeId)) continue;
        const pop = o.placeOfPerformance?.country?.name || null;
        byId.set(o.noticeId, {
          title: o.title,
          url: o.uiLink || `https://sam.gov/opp/${o.noticeId}/view`,
          description: [
            o.fullParentPathName && `Agencia: ${o.fullParentPathName}`,
            o.type && `Tipo: ${o.type}`,
            o.naicsCode && `NAICS: ${o.naicsCode}`,
            o.typeOfSetAsideDescription && `Reservado para: ${o.typeOfSetAsideDescription}`,
            pop && `Lugar de ejecución: ${pop}`
          ].filter(Boolean).join('\n'),
          explicitCountry: pop && !/united states/i.test(pop) ? pop : null,
          deadline: o.responseDeadLine || null,
          publishedAt: o.postedDate || null,
          reference: o.solicitationNumber || o.noticeId,
          buyer: (o.fullParentPathName || '').split('.')[0] || 'Gobierno de EE. UU.',
          category: o.type || 'Contrato federal'
        });
      }
      log(`NAICS ${code || 'todos'}: ${list.length} avisos`);
      await sleep(500);
    }
    return [...byId.values()];
  }
};
