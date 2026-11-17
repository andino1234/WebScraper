'use strict';

const path = require('path');
const fs = require('fs');
const winston = require('winston');

const dir = path.join(__dirname, '..', '..', 'logs');
try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { /* sin permisos: solo consola */ }

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.errors({ stack: true }), winston.format.json()),
  transports: [
    new winston.transports.Console({ format: winston.format.combine(winston.format.colorize(), winston.format.simple()) }),
    // Archivos rotativos: máximo 5 MB x 3 archivos, para que no crezcan sin límite
    new winston.transports.File({ filename: path.join(dir, 'error.log'), level: 'error', maxsize: 5 * 1024 * 1024, maxFiles: 3 }),
    new winston.transports.File({ filename: path.join(dir, 'app.log'), maxsize: 5 * 1024 * 1024, maxFiles: 3 })
  ]
});

module.exports = { logger };
