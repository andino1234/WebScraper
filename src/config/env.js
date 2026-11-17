'use strict';

const path = require('path');
const fs = require('fs');

// Cargar el .env de la carpeta del proyecto, sin importar desde qué carpeta lo arranque el panel.
const ENV_FILE = path.join(__dirname, '..', '..', '.env');
require('dotenv').config({ path: ENV_FILE });

function first(...values) {
  for (const v of values) {
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return undefined;
}

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT || 3001),
  baseUrl: process.env.BASE_URL || 'http://localhost:3001',
  timezone: process.env.TZ_SCHEDULER || 'America/Guatemala',

  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',

  db: {
    host: first(process.env.DB_HOST, process.env.DB_SERVER, process.env.MYSQL_HOST) || 'localhost',
    user: first(process.env.DB_USER, process.env.MYSQL_USER),
    password: first(process.env.DB_PASSWORD, process.env.MYSQL_PASSWORD) ?? '',
    database: first(process.env.DB_DATABASE, process.env.DB_NAME, process.env.MYSQL_DATABASE),
    port: Number(first(process.env.DB_PORT, process.env.MYSQL_PORT) || 3306)
  },

  scraping: {
    // Puntaje mínimo para guardar una oportunidad (ver src/lib/relevance.js)
    minScore: Number(process.env.MIN_SCORE || 25),
    // Solo se guardan convocatorias que tengan al menos una palabra clave EN EL TÍTULO
    // (no basta con que aparezca en la descripción o en el texto de la página).
    requireKeywordInTitle: (process.env.REQUIRE_KEYWORD_IN_TITLE || 'true') === 'true',
    // Hora (0-23) de la búsqueda completa diaria
    dailyHour: Number(process.env.SCRAPE_DAILY_HOUR || 5),
    // Si es "true" se guardan también avisos sin fecha límite detectable
    keepWithoutDeadline: (process.env.KEEP_WITHOUT_DEADLINE || 'true') === 'true',
    includeRegional: (process.env.INCLUDE_REGIONAL || 'true') === 'true',
    samApiKey: process.env.SAM_API_KEY || '',
    chromePath: first(process.env.CHROME_PATH, process.env.PUPPETEER_EXECUTABLE_PATH)
  },

  alerts: {
    telegramToken: process.env.TELEGRAM_BOT_TOKEN || '',
    telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
    smtpHost: process.env.SMTP_HOST || '',
    smtpPort: Number(process.env.SMTP_PORT || 587),
    smtpUser: process.env.SMTP_USER || '',
    smtpPass: process.env.SMTP_PASS || '',
    smtpFrom: process.env.SMTP_FROM || '',
    emailTo: process.env.ALERT_EMAIL_TO || ''
  },

  admin: {
    email: process.env.DEFAULT_ADMIN_EMAIL || 'admin@insightlatam.com',
    password: process.env.DEFAULT_ADMIN_PASSWORD || ''
  },

  frameAncestors: process.env.FRAME_ANCESTORS ||
    "'self' https://portal.insightlatam.com https://teams.microsoft.com https://*.teams.microsoft.com https://*.cloud.microsoft https://*.office.com https://*.microsoft365.com"
};

function assertConfig() {
  const missing = [];
  if (!env.jwtSecret || env.jwtSecret === 'change_this_secret') missing.push('JWT_SECRET (pon una cadena larga y aleatoria)');
  if (!env.db.user) missing.push('DB_USER');
  if (!env.db.database) missing.push('DB_DATABASE');
  if (missing.length && !fs.existsSync(ENV_FILE)) missing.unshift(`No existe el archivo ${ENV_FILE}. Copia ahí el .env de la versión anterior.`);
  return missing;
}

module.exports = { env, assertConfig };
