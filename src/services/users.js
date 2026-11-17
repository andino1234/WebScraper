'use strict';

const bcrypt = require('bcryptjs');
const { query, one } = require('../db/pool');

async function list() {
  return query(`SELECT u.Id, u.FullName, u.Email, u.IsActive, u.CreatedAt, r.Name AS RoleName
                FROM Users u JOIN Roles r ON r.Id = u.RoleId ORDER BY u.IsActive DESC, u.FullName`);
}

async function roleId(name) {
  const r = await one('SELECT Id FROM Roles WHERE Name = ? LIMIT 1', [name === 'Administrador' ? 'Administrador' : 'Empleado']);
  return r.Id;
}

async function findByEmail(email) {
  return one(`SELECT u.Id, u.FullName, u.Email, u.PasswordHash, u.IsActive, r.Name AS RoleName
              FROM Users u JOIN Roles r ON r.Id = u.RoleId WHERE u.Email = ? LIMIT 1`, [String(email || '').trim()]);
}

function checkPassword(pw) {
  if (String(pw || '').length < 8) throw Object.assign(new Error('La contraseña debe tener al menos 8 caracteres'), { status: 400 });
}

async function create({ fullName, email, password, role }) {
  if (!String(fullName || '').trim() || !/^\S+@\S+\.\S+$/.test(String(email || ''))) {
    throw Object.assign(new Error('Nombre y correo válidos son obligatorios'), { status: 400 });
  }
  checkPassword(password);
  if (await findByEmail(email)) throw Object.assign(new Error('Ya existe un usuario con ese correo'), { status: 409 });
  await query('INSERT INTO Users (FullName, Email, PasswordHash, RoleId, IsActive, CreatedAt) VALUES (?, ?, ?, ?, 1, NOW())',
    [String(fullName).trim(), String(email).trim(), await bcrypt.hash(password, 10), await roleId(role)]);
}

async function update(id, { role, active, password }) {
  if (role) await query('UPDATE Users SET RoleId = ?, UpdatedAt = NOW() WHERE Id = ?', [await roleId(role), id]);
  if (active !== undefined) await query('UPDATE Users SET IsActive = ?, UpdatedAt = NOW() WHERE Id = ?', [active ? 1 : 0, id]);
  if (password) {
    checkPassword(password);
    await query('UPDATE Users SET PasswordHash = ?, UpdatedAt = NOW() WHERE Id = ?', [await bcrypt.hash(password, 10), id]);
  }
}

async function changeOwnPassword(id, current, next) {
  const u = await one('SELECT PasswordHash FROM Users WHERE Id = ?', [id]);
  if (!u || !(await bcrypt.compare(String(current || ''), u.PasswordHash))) {
    throw Object.assign(new Error('La contraseña actual no es correcta'), { status: 400 });
  }
  checkPassword(next);
  await query('UPDATE Users SET PasswordHash = ?, UpdatedAt = NOW() WHERE Id = ?', [await bcrypt.hash(next, 10), id]);
}

module.exports = { list, findByEmail, create, update, changeOwnPassword };
