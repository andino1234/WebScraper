'use strict';

const cheerio = require('cheerio');
const { squish, isJunkTitle, truncate } = require('../../lib/text');
const { pageText } = require('../../lib/http');
const { extractDeadline, parseDate } = require('../../lib/dates');
const { renderPage } = require('../browser');

// Palabras que indican que un enlace es una convocatoria (es / en / pt / fr).
const DEFAULT_INCLUDE = [
  'licitaci', 'concurso', 'convocatoria', 'consultor', 'consultan', 't[eé]rminos de referencia', '\\btdr\\b', '\\btors?\\b',
  '\\brf[pqi]\\b', 'request for', 'expression[s]? of interest', '\\beoi\\b', 'invitation', 'tender', 'procurement', '\\bbids?\\b',
  'solicitud de (propuestas|cotizaci|expresi)', 'cotizaci', 'adquisici', 'contrataci', 'expresi[oó]n de inter[eé]s',
  'edital', 'preg[aã]o', 'chamada', 'call for', 'appel d', 'sourcing', 'evaluaci[oó]n', 'estudio', 'investigaci[oó]n',
  'encuesta', 'diagn[oó]stico', 'l[ií]nea base', 'baseline', 'assessment', 'survey', 'research', 'evaluation'
].join('|');

// Enlaces de navegación que nunca son convocatorias. Se evalúa SOLO el texto/URL del enlace,
// no toda la página (la versión anterior descartaba páginas enteras por decir "news" o "privacy policy" en el pie).
const DEFAULT_EXCLUDE = [
  'iniciar sesi', 'login', 'log in', 'sign in', 'registr', 'contact', 'about us', 'qui[eé]nes somos', 'privacy', 'privacidad',
  'cookies?', 'facebook', 'twitter', 'linkedin', 'instagram', 'youtube', 'whatsapp', 'mapa del sitio', 'sitemap',
  'suscrib', 'subscribe', 'newsletter', 'donar', 'donate', 'empleo', 'vacante', 'vacanc', 'careers?', 'internship', 'pasant'
].join('|');

const SKIP_HREF = /^(#|mailto:|tel:|javascript:)/i;
const FILE_HREF = /\.(pdf|docx?|xlsx?|zip|rar)(\?|$)/i;

function absolute(href, base) {
  try { return new URL(href, base).toString().split('#')[0]; } catch (_) { return null; }
}

function titleFromDetail($) {
  const og = squish($('meta[property="og:title"]').attr('content'));
  const h1 = squish($('h1').first().text());
  const t = squish($('title').text());
  return [h1, og, t].find(v => v && !isJunkTitle(v)) || '';
}

async function load(url, { http, useBrowser, log }) {
  if (useBrowser) {
    try {
      const html = await renderPage(url);
      return { $: cheerio.load(html), html };
    } catch (e) {
      if (!/navegador|Chrome|puppeteer/i.test(e.message)) throw e;
      // Se registra el motivo exacto para poder diagnosticarlo en Actividad.
      // Sin Chrome en el servidor: intentar como página normal en vez de fallar.
      if (log) log(`${e.message} Se intenta leer la página sin navegador.`);
    }
  }
  return http.getHtml(url);
}

function linksFromList($, baseUrl, config) {
  const include = new RegExp(config.include || DEFAULT_INCLUDE, 'i');
  const exclude = new RegExp(config.exclude || DEFAULT_EXCLUDE, 'i');
  const hrefInclude = config.hrefInclude ? new RegExp(config.hrefInclude, 'i') : null;
  const scope = config.listSelector ? $(config.listSelector) : $('body');
  const seen = new Set();
  const out = [];

  scope.find(config.linkSelector || 'a[href]').each((_, el) => {
    const a = $(el);
    const href = a.attr('href');
    if (!href || SKIP_HREF.test(href)) return;
    const url = absolute(href, baseUrl);
    if (!url || seen.has(url) || url.replace(/\/+$/, '') === baseUrl.replace(/\/+$/, '')) return;

    let text = squish(a.text()) || squish(a.attr('title'));
    // Si el enlace dice "Leer más" o "Descargar", buscar el título real:
    // 1) un encabezado dentro del bloque que lo contiene, 2) el encabezado anterior más cercano,
    // 3) el nombre del archivo.
    if (isJunkTitle(text)) {
      const block = a.closest('article, li, tr, .card, .item, .post, div');
      let heading = squish(block.find('h1, h2, h3, h4, h5, strong').first().text());
      let node = a;
      for (let i = 0; (!heading || isJunkTitle(heading)) && i < 6 && node.length; i++) {
        heading = squish(node.prevAll('h1, h2, h3, h4, h5, h6').first().text());
        node = node.parent();
      }
      if ((!heading || isJunkTitle(heading)) && FILE_HREF.test(href)) {
        heading = decodeURIComponent(href.split('/').pop().replace(/\.[a-z0-9]+(\?.*)?$/i, '')).replace(/[-_]+/g, ' ');
      }
      text = heading || text;
    }
    const probe = `${text} ${decodeURIComponent(url)}`;
    if (exclude.test(text)) return;
    if (hrefInclude && !hrefInclude.test(url)) return;
    if (!hrefInclude && !include.test(probe)) return;
    if (hrefInclude && config.include && !include.test(probe)) return;

    seen.add(url);
    out.push({ title: text, url, isFile: FILE_HREF.test(url) });
  });
  return out;
}

function rowsFromTable($, baseUrl, table) {
  const out = [];
  $(table.row || 'table tr').each((_, tr) => {
    const cells = $(tr).find('td');
    if (!cells.length) return;
    const cell = i => (i === undefined || i === null ? '' : squish(cells.eq(i).text()));
    const linkEl = (table.link !== undefined ? cells.eq(table.link) : $(tr)).find('a[href]').first();
    const url = absolute(linkEl.attr('href') || '', baseUrl);
    const title = cell(table.title ?? 0) || squish(linkEl.text());
    if (!url || !title) return;
    out.push({
      title,
      url,
      explicitCountry: table.country !== undefined ? cell(table.country) : null,
      deadline: table.deadline !== undefined ? parseDate(cell(table.deadline)) : null,
      isFile: FILE_HREF.test(url)
    });
  });
  return out;
}

async function mapLimit(list, limit, fn) {
  const results = new Array(list.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (next < list.length) {
      const i = next++;
      results[i] = await fn(list[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Lee una página con un listado de convocatorias y, opcionalmente, abre cada una
 * para obtener descripción, país y fecha límite.
 */
module.exports = {
  id: 'html',
  label: 'Página web',
  async fetch({ http, source, config, log }) {
    const listUrl = config.listUrl || source.Url;
    const useBrowser = Boolean(config.useBrowser);
    let $;
    try {
      ({ $ } = await load(listUrl, { http, useBrowser, log }));
    } catch (e) {
      // Si el sitio bloquea la consulta directa (403), reintentar automáticamente con Chrome.
      if (useBrowser || e.status !== 403) throw e;
      log('El sitio bloqueó la consulta directa; se intenta con navegador.');
      ({ $ } = await load(listUrl, { http, useBrowser: true }));
      if (!$('a[href]').length) throw e;
    }

    let candidates = config.table ? rowsFromTable($, listUrl, config.table) : linksFromList($, listUrl, config);
    const maxItems = Math.min(Number(config.maxItems || 40), 150);
    candidates = candidates.slice(0, maxItems);
    log(`${candidates.length} enlaces candidatos en el listado`);

    const followDetail = config.followDetail !== false;
    if (!followDetail) return candidates.map(c => ({ ...c, description: '' }));

    let detailErrors = 0;
    const items = await mapLimit(candidates, useBrowser ? 2 : 3, async (c) => {
      if (c.isFile) return { ...c, description: `Documento: ${c.url}` };
      try {
        let page;
        try {
          page = await load(c.url, { http, useBrowser: false });
        } catch (e) {
          // Si el sitio bloquea la consulta directa y la fuente usa navegador, abrir el detalle con Chrome.
          if (e.status !== 403) throw e;
          page = await load(c.url, { http, useBrowser: true });
        }
        const titleOnPage = titleFromDetail(page.$);
        const text = pageText(page.$);
        const title = isJunkTitle(c.title) && titleOnPage ? titleOnPage : c.title;
        return {
          ...c,
          title,
          description: truncate(text, 6000),
          deadline: c.deadline || extractDeadline(text)
        };
      } catch (e) {
        detailErrors++;
        return { ...c, description: '' };
      }
    });
    if (detailErrors) log(`${detailErrors} páginas de detalle no se pudieron abrir`);
    return items;
  },
  // Exportado para pruebas
  _linksFromList: linksFromList,
  _rowsFromTable: rowsFromTable
};
