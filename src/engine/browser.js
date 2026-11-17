'use strict';

const fs = require('fs');
const { env } = require('../config/env');

const CANDIDATES = [
  env.scraping.chromePath,
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
].filter(Boolean);

let browserPromise = null;

const path = require('path');
let loadError = null;

/** Busca puppeteer en la carpeta del proyecto y, si no está, en los módulos globales de Node. */
function loadPuppeteer() {
  const projectRoot = path.join(__dirname, '..', '..');
  const attempts = [
    () => require(require.resolve('puppeteer', { paths: [projectRoot] })),
    () => require(require.resolve('puppeteer-core', { paths: [projectRoot] })),
    () => require('puppeteer'),
    () => require(path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'puppeteer'))
  ];
  const errors = [];
  for (const attempt of attempts) {
    try { return attempt(); } catch (e) { errors.push(e.message.split('\n')[0]); }
  }
  loadError = errors[0];
  return null;
}

function chromePath(puppeteer) {
  const found = CANDIDATES.find(p => { try { return fs.existsSync(p); } catch (_) { return false; } });
  if (found) return found;
  try {
    const bundled = puppeteer.executablePath();
    if (bundled && fs.existsSync(bundled)) return bundled;
  } catch (_) { /* sin navegador descargado */ }
  return null;
}

async function getBrowser() {
  if (!browserPromise) {
    const puppeteer = loadPuppeteer();
    if (!puppeteer) {
      throw new Error(`Esta fuente necesita navegador y no se pudo cargar "puppeteer" desde ${path.join(__dirname, '..', '..', 'node_modules')} (${loadError || 'no encontrado'}).`);
    }
    const executablePath = chromePath(puppeteer);
    if (!executablePath) {
      let bundled = '';
      try { bundled = puppeteer.executablePath(); } catch (_) { /* nada */ }
      throw new Error(`Puppeteer está instalado pero no encuentra Chrome (buscado en: ${[...CANDIDATES, bundled].filter(Boolean).join(', ')}). Instala Chrome o define CHROME_PATH en .env.`);
    }
    browserPromise = puppeteer.launch({ headless: true, executablePath, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] })
      .catch(e => {
        browserPromise = null;
        const missingLib = (e.message.match(/(lib[\w.+-]+\.so[\d.]*)/) || [])[1];
        throw new Error(missingLib
          ? `Chrome no arranca: falta la librería del sistema ${missingLib}. Instala las dependencias de Chrome en el servidor.`
          : `Chrome no arranca: ${e.message.split('\n')[0]}`);
      });
  }
  return browserPromise;
}

/** Abre una página con Chrome y devuelve el HTML ya armado por JavaScript. */
async function renderPage(url, { waitMs = 2500, timeout = 60000 } = {}) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-419,es;q=0.9,en;q=0.8' });
    await page.goto(url, { waitUntil: 'networkidle2', timeout });
    await new Promise(r => setTimeout(r, waitMs));
    return await page.content();
  } finally {
    await page.close().catch(() => {});
  }
}

async function closeBrowser() {
  if (!browserPromise) return;
  try { (await browserPromise).close(); } catch (_) { /* ya cerrado */ }
  browserPromise = null;
}

module.exports = { renderPage, closeBrowser };
