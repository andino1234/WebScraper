'use strict';

const axios = require('axios');
const { env } = require('../config/env');
const { getPool } = require('../db/pool');
const { logger } = require('../lib/logger');

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString('es-GT', { day: '2-digit', month: 'short', year: 'numeric' }) : 'sin fecha';
}

async function sendTelegram(text) {
  const { telegramToken, telegramChatId } = env.alerts;
  if (!telegramToken || !telegramChatId) return false;
  await axios.post(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
    chat_id: telegramChatId, text, parse_mode: 'HTML', disable_web_page_preview: true
  }, { timeout: 15000 });
  return true;
}

async function sendEmail(subject, html) {
  const a = env.alerts;
  if (!a.smtpHost || !a.emailTo) return false;
  const nodemailer = require('nodemailer');
  const transport = nodemailer.createTransport({
    host: a.smtpHost, port: a.smtpPort, secure: a.smtpPort === 465,
    auth: a.smtpUser ? { user: a.smtpUser, pass: a.smtpPass } : undefined
  });
  await transport.sendMail({ from: a.smtpFrom || a.smtpUser, to: a.emailTo, subject, html });
  return true;
}

const escape = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/** Envía un solo resumen con las oportunidades nuevas de prioridad Alta o Crítica. */
async function sendDigest(items) {
  if (!items || !items.length) return;
  const top = items.slice(0, 25);
  const link = id => `${env.baseUrl}/?abrir=${id}`;
  const lines = top.map(i => `• <b>${escape(i.level)}</b> · ${escape(i.country)} · cierra ${fmtDate(i.deadline)}\n  <a href="${link(i.id)}">${escape(i.title.slice(0, 140))}</a>`);
  const extra = items.length > top.length ? `\n…y ${items.length - top.length} más.` : '';
  const text = `🔔 <b>${items.length} oportunidades nuevas de prioridad alta</b>\n\n${lines.join('\n')}${extra}`;
  const html = `<h2>${items.length} oportunidades nuevas de prioridad alta</h2><ul>${top.map(i =>
    `<li><b>${escape(i.level)}</b> · ${escape(i.country)} · cierra ${fmtDate(i.deadline)}<br><a href="${link(i.id)}">${escape(i.title)}</a> <small>(${escape(i.source)})</small></li>`).join('')}</ul>`;

  const pool = getPool();
  for (const [channel, send] of [['telegram', () => sendTelegram(text)], ['email', () => sendEmail(`Licitaciones: ${items.length} nuevas de prioridad alta`, html)]]) {
    try {
      const sent = await send();
      if (!sent) continue;
      await pool.query('INSERT INTO Alerts (OpportunityId, Channel, Status, SentAt) VALUES ?', [top.map(i => [i.id, channel, 'Sent', new Date()])]);
      await pool.query('UPDATE Opportunities SET IsAlertSent = 1 WHERE Id IN (?)', [top.map(i => i.id)]);
    } catch (e) {
      logger.error(`No se pudo enviar alerta por ${channel}: ${e.message}`);
    }
  }
}

module.exports = { sendDigest, sendTelegram, sendEmail };
