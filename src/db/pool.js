'use strict';

const mysql = require('mysql2/promise');
const { env } = require('../config/env');

let pool;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      ...env.db,
      waitForConnections: true,
      connectionLimit: 10,
      charset: 'utf8mb4',
      dateStrings: false,
      timezone: 'local'
    });
  }
  return pool;
}

async function query(sql, params = []) {
  const [rows] = await getPool().query(sql, params);
  return rows;
}

async function one(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

async function close() {
  if (pool) { await pool.end(); pool = null; }
}

module.exports = { getPool, query, one, close };
