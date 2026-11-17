'use strict';

/**
 * Catálogo de fuentes recomendadas para Centroamérica, el Caribe, México, EE. UU. y Brasil.
 * La migración (npm run migrate) agrega las que falten; nunca borra fuentes existentes.
 *
 * connector:
 *   worldbank  API pública de avisos de adquisiciones del Banco Mundial
 *   idb        API de oportunidades activas del BID
 *   ungm       Buscador de avisos de Naciones Unidas (UNGM)
 *   pncp       API oficial de compras públicas de Brasil (Portal Nacional de Contratações Públicas)
 *   grantsgov  API pública de Grants.gov (EE. UU.)
 *   samgov     API de SAM.gov (EE. UU.). Requiere SAM_API_KEY en .env
 *   html       Página web con un listado de convocatorias (configurable)
 *   rss        Canal RSS/Atom
 *
 * config (JSON) para html:
 *   include       Regex que debe cumplir el texto o la URL del enlace para considerarlo convocatoria
 *   hrefInclude   Regex que debe cumplir la URL del enlace (opcional)
 *   exclude       Regex para descartar enlaces
 *   followDetail  Abrir cada convocatoria para leer descripción, país y fecha límite (por defecto: sí)
 *   maxItems      Máximo de enlaces a revisar (por defecto 40)
 *   table         { row, title, country, deadline, link } columnas (índice) de una tabla HTML
 *   useBrowser    Usar Chrome (para páginas que se arman con JavaScript)
 */

const CATALOG = [
  // ---------- Bancos y organismos multilaterales (API) ----------
  {
    name: 'Banco Mundial', connector: 'worldbank', country: null, category: 'Multilateral',
    url: 'https://projects.worldbank.org/en/projects-operations/procurement',
    config: { pages: 5 }, active: true,
    notes: 'API oficial. Se filtran avisos de la región y se excluyen adjudicaciones.'
  },
  {
    name: 'BID', connector: 'idb', country: null, category: 'Multilateral',
    url: 'https://beo-procurement.iadb.org/en/home',
    config: { pages: 10 }, active: true,
    notes: 'Oportunidades activas de consultoría del BID (API).'
  },
  {
    name: 'Naciones Unidas (UNGM)', connector: 'ungm', country: null, category: 'Multilateral',
    url: 'https://www.ungm.org/Public/Notice',
    config: { pages: 5 }, active: true,
    notes: 'Avisos de todas las agencias ONU (PNUD, UNICEF, OIM, UNOPS, ACNUR, OPS...).'
  },
  {
    name: 'Banco de Desarrollo del Caribe (CDB)', connector: 'html', country: 'Regional Caribe', category: 'Multilateral',
    url: 'https://www.caribank.org/work-with-us/procurement/procurement-notices',
    config: { table: { row: 'table tbody tr', title: 0, country: 2, deadline: 4 }, followDetail: true, maxItems: 40 },
    active: true, notes: 'Tabla de avisos vigentes con país y fecha límite.'
  },
  {
    name: 'PNUD - Avisos de adquisiciones', connector: 'html', country: null, category: 'Multilateral',
    url: 'https://procurement-notices.undp.org/',
    config: { hrefInclude: 'view_negotiation|view_notice|nego_id', include: '.', followDetail: true, maxItems: 60 },
    active: true, notes: 'Si el sitio bloquea (403), activar useBrowser en la configuración.'
  },
  {
    name: 'BCIE - Adquisiciones en curso', connector: 'html', country: 'Regional Centroamérica', category: 'Multilateral',
    url: 'https://www.bcie.org/adquisiciones-institucionales/en-curso',
    config: { followDetail: true, maxItems: 40 }, active: true
  },

  // ---------- Estados Unidos ----------
  {
    name: 'EE. UU. - Grants.gov', connector: 'grantsgov', country: 'Estados Unidos', category: 'Gobierno',
    url: 'https://www.grants.gov/search-grants',
    config: {
      keywords: ['evaluation', 'research', 'survey', 'assessment', 'baseline', 'monitoring and evaluation',
        'Central America', 'Caribbean', 'Latin America', 'Mexico', 'Brazil', 'Guatemala', 'Honduras', 'El Salvador', 'Haiti', 'Dominican Republic'],
      requirePrincipal: true
    },
    active: true, notes: 'API pública sin clave. Convocatorias de subvenciones federales abiertas a empresas (no solo universidades). Busca con las palabras clave principales.'
  },
  {
    name: 'EE. UU. - SAM.gov (contratos federales)', connector: 'samgov', country: 'Estados Unidos', category: 'Gobierno',
    url: 'https://sam.gov/search/?index=opp',
    config: { days: 14, naics: ['541910', '541720', '541611', '541618', '541690', '541990'] },
    active: false, notes: 'Requiere una clave gratuita: crea una en sam.gov (Account Details > Public API Key) y ponla en SAM_API_KEY. NAICS 541910 = investigación de mercados, 541720 = investigación en ciencias sociales, 5416xx = consultoría.'
  },

  // ---------- Brasil ----------
  {
    name: 'Brasil - PNCP (compras públicas)', connector: 'pncp', country: 'Brasil', category: 'Gobierno',
    url: 'https://pncp.gov.br/app/editais',
    config: { maxPages: 40, daysAhead: 90, requirePrincipal: true },
    active: true, notes: 'API oficial del Portal Nacional de Contratações Públicas. Licitaciones con recepción de propuestas abierta. Usa las palabras clave en portugués.'
  },

  // ---------- Portales nacionales de compras (páginas web, experimentales) ----------
  {
    name: 'Guatecompras', connector: 'html', country: 'Guatemala', category: 'Gobierno',
    url: 'https://www.guatecompras.gt/concursos/consultaConcursos.aspx',
    config: { useBrowser: true, followDetail: true, maxItems: 40 }, active: false,
    notes: 'Portal armado con JavaScript: necesita Chrome en el servidor (CHROME_PATH).'
  },
  {
    name: 'HonduCompras', connector: 'html', country: 'Honduras', category: 'Gobierno',
    url: 'https://honducompras.gob.hn/',
    config: { useBrowser: true, followDetail: true }, active: false,
    notes: 'Portal armado con JavaScript: necesita Chrome en el servidor.'
  },
  {
    name: 'COMPRASAL', connector: 'html', country: 'El Salvador', category: 'Gobierno',
    url: 'https://www.comprasal.gob.sv/comprasal_web/',
    config: { useBrowser: true, followDetail: true }, active: false,
    notes: 'Portal armado con JavaScript: necesita Chrome en el servidor.'
  },
  {
    name: 'SICOP Costa Rica', connector: 'html', country: 'Costa Rica', category: 'Gobierno',
    url: 'https://www.sicop.go.cr/',
    config: { useBrowser: true, followDetail: true }, active: false,
    notes: 'Portal armado con JavaScript: necesita Chrome en el servidor.'
  },
  {
    name: 'PanamaCompra', connector: 'html', country: 'Panamá', category: 'Gobierno',
    url: 'https://www.panamacompra.gob.pa/Inicio/',
    config: { useBrowser: true, followDetail: true }, active: false,
    notes: 'Portal armado con JavaScript: necesita Chrome en el servidor.'
  },
  {
    name: 'Compras Dominicana (DGCP)', connector: 'html', country: 'República Dominicana', category: 'Gobierno',
    url: 'https://comunidad.comprasdominicana.gob.do/Public/Tendering/ContractNoticeManagement/Index',
    config: { useBrowser: true, followDetail: true }, active: false,
    notes: 'Portal armado con JavaScript: necesita Chrome en el servidor.'
  },
  {
    name: 'ComprasMX', connector: 'html', country: 'México', category: 'Gobierno',
    url: 'https://comprasmx.buengobierno.gob.mx/',
    config: { useBrowser: true, followDetail: true }, active: false,
    notes: 'Portal armado con JavaScript: necesita Chrome en el servidor.'
  }
];

/** Conector equivalente para los tipos de scraper de la versión anterior. */
const LEGACY_CONNECTOR = {
  worldbank: 'worldbank', 'banco mundial': 'worldbank', bancomundial: 'worldbank',
  bid: 'idb', iadb: 'idb',
  ungm: 'ungm',
  rss: 'rss'
};

// Fuentes de la versión anterior que no son páginas de licitaciones (portadas, bolsas de empleo,
// buscadores de pago o proyectos). Se desactivan en la migración; se pueden reactivar desde Fuentes.
const LEGACY_DEACTIVATE = {
  'Latinobarómetro': 'Es la portada del sitio, no publica licitaciones.',
  'Cruz Roja Internacional': 'Es la portada del sitio, no publica licitaciones.',
  'CEPAL': 'Es la portada del sitio, no publica licitaciones.',
  'Banco Mundial - Proyectos': 'Lista proyectos, no licitaciones. Los avisos del Banco Mundial ya vienen por la API.',
  'Página de tenders': 'Agregador de pago (requiere suscripción).',
  'Global tenders': 'Agregador de pago (requiere suscripción).',
  'JICA': 'Buscador de préstamos, no publica convocatorias.',
  'RDS': 'Bolsa de empleo, no licitaciones.',
  'Naciones Unidas': 'Duplicado: UNGM ya cubre todas las agencias de la ONU.'
};

module.exports = { CATALOG, LEGACY_CONNECTOR, LEGACY_DEACTIVATE };
