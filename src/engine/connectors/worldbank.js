'use strict';

const cheerio = require('cheerio');
const { squish, truncate } = require('../../lib/text');

const API = 'https://search.worldbank.org/api/v2/procnotices';
const GROUPS = { CS: 'Servicios de consultoría', GO: 'Bienes', CW: 'Obras', NC: 'Servicios (no consultoría)' };

function htmlToText(html) {
  if (!html) return '';
  return squish(cheerio.load(`<div>${html}</div>`)('div').text());
}

/** Avisos de adquisiciones del Banco Mundial (API pública). Se leen los más recientes y se filtra la región después. */
module.exports = {
  id: 'worldbank',
  label: 'API Banco Mundial',
  async fetch({ http, config, log }) {
    const rows = 500;
    const pages = Math.min(Number(config.pages || 5), 20);
    const items = [];
    for (let page = 0; page < pages; page++) {
      const data = await http.getJson(API, {
        params: { format: 'json', rows, os: page * rows, apilang: 'en', srce: 'both' },
        timeout: 60000
      });
      const list = Array.isArray(data?.procnotices) ? data.procnotices : Object.values(data?.procnotices || {});
      if (!list.length) break;
      for (const n of list) {
        if (/award/i.test(n.notice_type || '')) continue; // adjudicaciones: ya no se puede aplicar
        const group = GROUPS[n.procurement_group] || n.procurement_group || '';
        const body = [
          n.notice_type && `Tipo: ${n.notice_type}`,
          group && `Categoría: ${group}`,
          n.procurement_method_name && `Método: ${n.procurement_method_name}`,
          n.project_name && `Proyecto: ${n.project_name}`,
          n.contact_organization && `Organismo: ${n.contact_organization}`,
          htmlToText(n.notice_text)
        ].filter(Boolean).join('\n');
        items.push({
          title: truncate(n.bid_description || n.project_name || `Aviso ${n.id}`, 900),
          url: `https://projects.worldbank.org/en/projects-operations/procurement-detail/${n.id}`,
          description: body,
          explicitCountry: [n.project_ctry_name, n.contact_ctry_name].filter(Boolean),
          deadline: n.submission_deadline_date || null,
          publishedAt: n.noticedate || n.submission_date || null,
          reference: n.bid_reference_no || n.id,
          buyer: n.contact_organization || n.borrower_name || 'Banco Mundial',
          category: group || 'Licitación'
        });
      }
      log(`página ${page + 1}: ${list.length} avisos`);
      if (list.length < rows) break;
    }
    return items;
  }
};
