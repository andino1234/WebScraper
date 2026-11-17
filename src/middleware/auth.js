'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { env } = require('../config/env');

const COOKIE = 'lic_session';
const CSRF_COOKIE = 'lic_csrf';

function cookieOptions(req) {
  // Dentro de Teams/portal (iframe) el navegador exige SameSite=None + Secure.
  const secure = env.isProduction || req.secure || req.headers['x-forwarded-proto'] === 'https';
  return { httpOnly: true, secure, sameSite: secure ? 'none' : 'lax', path: '/', maxAge: 12 * 3600 * 1000 };
}

function signIn(res, req, user) {
  const token = jwt.sign({ id: user.Id, name: user.FullName, email: user.Email, role: user.RoleName }, env.jwtSecret, { expiresIn: env.jwtExpiresIn });
  res.cookie(COOKIE, token, cookieOptions(req));
}

function signOut(res, req) {
  res.clearCookie(COOKIE, { ...cookieOptions(req), maxAge: undefined });
}

/** Lee la sesión (si existe) y la deja en req.user / res.locals.user para las vistas. */
function loadUser(req, res, next) {
  const token = req.cookies?.[COOKIE] || (req.headers.authorization || '').replace(/^Bearer /, '');
  req.user = null;
  if (token) {
    try {
      const p = jwt.verify(token, env.jwtSecret);
      const role = /admin/i.test(p.role || '') ? 'Administrador' : 'Empleado';
      req.user = { id: p.id, name: p.name || p.email, email: p.email, role, isAdmin: role === 'Administrador' };
    } catch (_) { req.user = null; }
  }
  res.locals.user = req.user;
  next();
}

/** Token anti-CSRF (doble envío): cookie + encabezado X-CSRF-Token en cada POST/PUT/DELETE. */
function csrf(req, res, next) {
  let token = req.cookies?.[CSRF_COOKIE];
  if (!token) {
    token = crypto.randomBytes(24).toString('hex');
    res.cookie(CSRF_COOKIE, token, { ...cookieOptions(req), httpOnly: false });
  }
  res.locals.csrfToken = token;
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  // Login de integraciones externas (portal): no tiene cookie previa; el login en sí no expone datos.
  if (req.path === '/api/auth/login') return next();
  const sent = req.headers['x-csrf-token'] || req.body?._csrf;
  if (!sent || sent !== token) return res.status(403).json({ error: 'La sesión de seguridad expiró. Recarga la página.' });
  next();
}

const wantsJson = req => req.path.startsWith('/api/') || req.xhr || (req.headers.accept || '').includes('application/json');

function requireUser(req, res, next) {
  if (req.user) return next();
  if (wantsJson(req)) return res.status(401).json({ error: 'Tu sesión terminó. Vuelve a iniciar sesión.' });
  return res.redirect(`/login?volver=${encodeURIComponent(req.originalUrl)}`);
}

function requireAdmin(req, res, next) {
  if (req.user?.isAdmin) return next();
  if (wantsJson(req)) return res.status(403).json({ error: 'Solo un administrador puede hacer esto.' });
  return res.status(403).render('error', { title: 'Sin permiso', message: 'Esta sección es solo para administradores.' });
}

module.exports = { signIn, signOut, loadUser, csrf, requireUser, requireAdmin };
