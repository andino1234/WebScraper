'use strict';

const axios = require('axios');
const https = require('https');
const cheerio = require('cheerio');
const { squish } = require('./text');

// Encabezados de navegador real: varios portales responden 403 a "bots".
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
  'Accept-Language': 'es-419,es;q=0.9,en;q=0.8,pt;q=0.7',
  'Cache-Control': 'no-cache'
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

function describeHttpError(error) {
  const status = error?.response?.status;
  if (status === 403) return 'El sitio bloqueó la consulta (403). Puede requerir navegador o tener protección anti-bots.';
  if (status === 404) return 'La página ya no existe (404). Revisa la URL de la fuente.';
  if (status === 400) return 'El sitio rechazó la consulta (400). Probablemente cambió su formato.';
  if (status === 429) return 'Demasiadas consultas (429). El sitio pide esperar.';
  if (status >= 500) return `El sitio tuvo un error interno (${status}). Suele ser temporal.`;
  if (error?.code === 'ECONNABORTED' || /timeout/i.test(error?.message || '')) return 'El sitio tardó demasiado en responder (tiempo agotado).';
  if (error?.code === 'ENOTFOUND') return 'No se encontró el dominio. Revisa la URL.';
  if (/certificate/i.test(error?.message || '')) return 'El sitio tiene mal instalado su certificado de seguridad. Si confías en el sitio, activa "ignoreTlsErrors" en su configuración.';
  if (error?.code === 'ECONNREFUSED' || error?.code === 'ECONNRESET') return 'El sitio rechazó la conexión.';
  return error?.message || String(error);
}

/**
 * Cliente HTTP con reintentos (errores 5xx, 429 y tiempos agotados) y
 * manejo simple de cookies (para sitios que exigen una sesión previa, como UNGM).
 */
function createClient({ timeout = 30000, retries = 2, headers = {}, ignoreTlsErrors = false } = {}) {
  const cookies = new Map();
  // Solo para sitios públicos con el certificado mal instalado (opción por fuente).
  const httpsAgent = ignoreTlsErrors ? new https.Agent({ rejectUnauthorized: false }) : undefined;

  function cookieHeader() {
    return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  function storeCookies(res) {
    const set = res?.headers?.['set-cookie'];
    if (!set) return;
    for (const line of set) {
      const [pair] = line.split(';');
      const idx = pair.indexOf('=');
      if (idx > 0) cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
  }

  async function request(config) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await axios({
          timeout,
          maxRedirects: 5,
          validateStatus: s => s >= 200 && s < 300,
          ...(httpsAgent ? { httpsAgent } : {}),
          ...config,
          headers: {
            ...BROWSER_HEADERS,
            ...headers,
            ...(cookies.size ? { Cookie: cookieHeader() } : {}),
            ...(config.headers || {})
          }
        });
        storeCookies(res);
        return res;
      } catch (error) {
        storeCookies(error.response);
        lastError = error;
        const status = error?.response?.status;
        const retriable = !status || status >= 500 || status === 429;
        if (!retriable || attempt === retries) break;
        // 429 = "demasiadas consultas": respetar Retry-After o esperar bastante más.
        const retryAfter = Number(error?.response?.headers?.['retry-after']);
        const wait = status === 429 ? (retryAfter > 0 ? Math.min(retryAfter, 60) * 1000 : 15000 * (attempt + 1)) : 1500 * (attempt + 1);
        await sleep(wait);
      }
    }
    const err = new Error(describeHttpError(lastError));
    err.status = lastError?.response?.status;
    err.cause = lastError;
    throw err;
  }

  return {
    request,
    get: (url, config = {}) => request({ ...config, method: 'GET', url }),
    post: (url, data, config = {}) => request({ ...config, method: 'POST', url, data }),
    async getJson(url, config = {}) {
      const res = await request({ ...config, method: 'GET', url, headers: { Accept: 'application/json', ...(config.headers || {}) } });
      return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    },
    async getHtml(url, config = {}) {
      const res = await request({ ...config, method: 'GET', url, responseType: 'text' });
      return { html: String(res.data), $: cheerio.load(String(res.data)), finalUrl: res.request?.res?.responseUrl || url };
    },
    cookies
  };
}

/** Texto visible principal de una página, sin menús ni scripts. */
function pageText($) {
  $('script, style, noscript, svg, iframe, nav, header, footer, form, .menu, .navbar, #menu, .breadcrumb, .cookie, [role="navigation"]').remove();
  const main = $('main, article, [role="main"], .content, #content, .entry-content, .post-content').first();
  const text = squish((main.length ? main : $('body')).text());
  return text;
}

module.exports = { createClient, pageText, describeHttpError, sleep, BROWSER_HEADERS };
