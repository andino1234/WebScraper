'use strict';

const { truncate, squish } = require('../../lib/text');
const { formatYmd, addDays } = require('../../lib/dates');
const { sleep } = require('../../lib/http');

const API = 'https://pncp.gov.br/api/consulta/v1/contratacoes/proposta';

/**
 * Brasil: contrataciones con recepción de propuestas abierta (API oficial PNCP).
 * config.modalities: códigos de modalidad opcionales (p. ej. [4,5,8]); vacío = todas.
 */
module.exports = {
  id: 'pncp',
  label: 'API PNCP Brasil',
  async fetch({ http, config, log }) {
    const maxPages = Math.min(Number(config.maxPages || 40), 200);
    const dataFinal = formatYmd(addDays(new Date(), Number(config.daysAhead || 90)));
    const modalities = Array.isArray(config.modalities) && config.modalities.length ? config.modalities : [null];
    const items = [];

    for (const modality of modalities) {
      for (let page = 1; page <= maxPages; page++) {
        const params = { dataFinal, pagina: page, tamanhoPagina: 50 };
        if (modality) params.codigoModalidadeContratacao = modality;
        const data = await http.getJson(API, { params, timeout: 60000 });
        const list = data?.data || [];
        for (const c of list) {
          const cnpj = c.orgaoEntidade?.cnpj;
          const url = cnpj && c.anoCompra && c.sequencialCompra
            ? `https://pncp.gov.br/app/editais/${cnpj}/${c.anoCompra}/${c.sequencialCompra}`
            : c.linkSistemaOrigem;
          if (!url || !c.objetoCompra) continue;
          const local = [c.unidadeOrgao?.municipioNome, c.unidadeOrgao?.ufSigla].filter(Boolean).join(' - ');
          items.push({
            title: truncate(c.objetoCompra, 600),
            url,
            description: [
              squish(c.objetoCompra),
              c.informacaoComplementar && squish(c.informacaoComplementar),
              c.modalidadeNome && `Modalidade: ${c.modalidadeNome}`,
              local && `Local: ${local}`,
              c.orgaoEntidade?.razaoSocial && `Órgão: ${c.orgaoEntidade.razaoSocial}`
            ].filter(Boolean).join('\n'),
            explicitCountry: 'Brasil',
            deadline: c.dataEncerramentoProposta || null,
            publishedAt: c.dataPublicacaoPncp || null,
            reference: c.numeroControlePNCP || null,
            buyer: c.orgaoEntidade?.razaoSocial || null,
            category: c.modalidadeNome || 'Licitação',
            budget: c.valorTotalEstimado ? `BRL ${Number(c.valorTotalEstimado).toLocaleString('es')}` : null
          });
        }
        const total = Number(data?.totalPaginas || 0);
        if (page === 1) log(`modalidad ${modality || 'todas'}: ${data?.totalRegistros ?? '?'} contrataciones abiertas`);
        if (!list.length || (total && page >= total)) break;
        await sleep(1200); // el PNCP limita las consultas por minuto
      }
    }
    return items;
  }
};
