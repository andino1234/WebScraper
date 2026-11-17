'use strict';

const { truncate } = require('../../lib/text');

const API = 'https://beo-procurement.iadb.org/en/views/activeOpportunities/view';

/** Oportunidades activas de consultoría del BID. */
module.exports = {
  id: 'idb',
  label: 'API BID',
  async fetch({ http, config, log }) {
    const pages = Math.min(Number(config.pages || 10), 30);
    const items = [];
    const seen = new Set();
    for (let page = 1; page <= pages; page++) {
      const data = await http.getJson(API, { params: { page } });
      const list = data?.response || [];
      const fresh = list.filter(i => !seen.has(i.nid || i.field_document_id_value));
      if (!fresh.length) break;
      for (const i of fresh) {
        seen.add(i.nid || i.field_document_id_value);
        const url = i.field_document_id_value
          ? `https://www.iadb.org/document.cfm?id=${i.field_document_id_value}`
          : i.nid ? `https://beo-procurement.iadb.org/en/node/${i.nid}` : null;
        if (!url) continue;
        items.push({
          title: truncate(i.field_title_of_consultancy_value || i.field_project_name_value || 'Consultoría BID', 900),
          url,
          description: [
            i.field_project_name_value && `Proyecto: ${i.field_project_name_value}`,
            i.sector_name && `Sector: ${i.sector_name}`,
            i.field_operation_number_value && `Operación: ${i.field_operation_number_value}`,
            i.field_financing_atn_value && `Financiamiento: ${i.field_financing_atn_value}`,
            'Tipo: Consultoría'
          ].filter(Boolean).join('\n'),
          explicitCountry: i.country_name || null,
          deadline: i.field_deadline_date_value || null,
          publishedAt: i.field_publication_date_value || null,
          reference: i.field_procurement_process_number_value || i.field_operation_number_value || null,
          buyer: 'BID',
          category: 'Consultoría'
        });
      }
      log(`página ${page}: ${fresh.length} oportunidades`);
    }
    return items;
  }
};
