require('dotenv').config();
const nodemailer = require('nodemailer');
const { db } = require('./db');

const host = process.env.SMTP_HOST;
const transport = host
  ? nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
    })
  : null;

/* Sends an email, or logs it when SMTP isn't configured yet.
   Never throws — a mail problem must not lose an order. */
async function send(to, subject, body) {
  if (!to) return;
  const row = db.prepare('INSERT INTO mail_log (to_addr, subject, body) VALUES (?,?,?)').run(to, subject, body);
  if (!transport) {
    console.log('\n--- EMAIL (not sent, no SMTP configured) ---');
    console.log('To:', to, '\nSubject:', subject, '\n' + body + '\n');
    return;
  }
  try {
    await transport.sendMail({
      from: process.env.MAIL_FROM || 'Rick Ice Solutions <no-reply@rickice.com>',
      to, subject,
      text: body,
      html: '<pre style="font:14px/1.6 system-ui">' + body.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])) + '</pre>'
    });
    db.prepare('UPDATE mail_log SET sent = 1 WHERE id = ?').run(row.lastInsertRowid);
  } catch (err) {
    db.prepare('UPDATE mail_log SET error = ? WHERE id = ?').run(String(err.message || err), row.lastInsertRowid);
    console.error('Email failed:', err.message);
  }
}

/* A click-to-send WhatsApp link the shop can use from the admin panel. */
function whatsappLink(phone, message) {
  const to = String(phone || process.env.SHOP_WHATSAPP || '').replace(/[^0-9]/g, '');
  return to ? 'https://wa.me/' + to + '?text=' + encodeURIComponent(message) : '';
}

module.exports = { send, whatsappLink };
