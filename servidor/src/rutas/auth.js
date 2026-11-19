/**
 * @file rutas/auth.js
 * @description Inicio y cierre de sesión.
 *
 *   POST /api/auth/login      { usuario, contrasena } → { token, usuario }
 *   POST /api/auth/logout     → 204
 *   GET  /api/auth/yo         → datos de la sesión actual
 *   GET  /api/auth/inicial    → { RequiereDueno } (true si aún no hay cuenta del Dueño)
 *   POST /api/auth/primer-dueno { Nombre, Usuario, Contrasena } → { token, usuario }
 *        Solo funciona mientras no exista ninguna cuenta de Dueño (primer uso).
 */
'use strict';

const express = require('../lib/web');
const db = require('../db');
const v = require('../servicios/validar');
const jwt = require('../seguridad/jwt');
const contrasenas = require('../seguridad/contrasenas');
const { ROLES, TABLA_ROL, requiereSesion } = require('../middleware/autenticacion');
const { ErrorApi, envolver } = require('../middleware/errores');

const router = express.Router();

/** Intentos fallidos por usuario (freno simple contra ataques de fuerza bruta). */
const intentos = new Map();
const MAX_INTENTOS = 5;
const ESPERA_MS = 5 * 60 * 1000;

router.post('/login', envolver(async (req, res) => {
  const usuario = String((req.body && req.body.usuario) || '').trim().toLowerCase();
  const contrasena = String((req.body && req.body.contrasena) || '');
  if (!usuario || !contrasena) throw new ErrorApi(400, 'Escribe tu usuario y contraseña.');

  const registro = intentos.get(usuario);
  if (registro && registro.cuenta >= MAX_INTENTOS && Date.now() - registro.ultimo < ESPERA_MS) {
    throw new ErrorApi(429, 'Demasiados intentos. Espera 5 minutos e inténtalo de nuevo.');
  }

  // El usuario puede estar en cualquiera de las tres tablas de cuentas.
  let encontrado = null;
  for (const rol of [ROLES.DUENO, ROLES.CAJERO, ROLES.BARBERO]) {
    const { tabla, id } = TABLA_ROL[rol];
    const fila = await db.uno(
      `SELECT ${id} AS id, Nombre, Usuario, Contrasena FROM ${tabla} WHERE Usuario = ? AND Activo = 1`, [usuario]);
    if (fila) { encontrado = { ...fila, rol }; break; }
  }

  const valido = encontrado && await contrasenas.verificar(contrasena, encontrado.Contrasena);
  if (!valido) {
    intentos.set(usuario, { cuenta: ((registro && registro.cuenta) || 0) + 1, ultimo: Date.now() });
    throw new ErrorApi(401, 'Usuario o contraseña incorrectos.');
  }
  intentos.delete(usuario);

  const sesion = { id: encontrado.id, nombre: encontrado.Nombre, usuario: encontrado.Usuario, rol: encontrado.rol };
  res.json({ token: jwt.firmar(sesion), usuario: sesion });
}));

router.post('/logout', (req, res) => res.status(204).end());

/** ¿Falta crear la cuenta del Dueño? (primer uso del sistema) */
async function requiereDueno() {
  const fila = await db.uno('SELECT COUNT(*) AS n FROM ADMINISTRADOR WHERE Activo = 1');
  return !Number(fila.n);
}

router.get('/inicial', envolver(async (req, res) => {
  res.json({ RequiereDueno: await requiereDueno() });
}));

router.post('/primer-dueno', envolver(async (req, res) => {
  if (!(await requiereDueno())) throw new ErrorApi(409, 'La cuenta del Dueño ya existe. Inicia sesión.');
  const b = req.body || {};
  const nombre = v.texto(b.Nombre, 'El nombre completo', { min: 3, max: 100, obligatorio: true });
  const usuario = v.usuario(b.Usuario);
  const clave = v.contrasena(b.Contrasena);
  for (const { tabla } of Object.values(TABLA_ROL)) {
    if (await db.uno(`SELECT 1 FROM ${tabla} WHERE Usuario = ?`, [usuario])) {
      throw new ErrorApi(409, `El usuario «${usuario}» ya está en uso. Elige otro.`);
    }
  }
  const r = await db.consultar('INSERT INTO ADMINISTRADOR (Nombre, Usuario, Contrasena) VALUES (?, ?, ?)',
    [nombre, usuario, await contrasenas.cifrar(clave)]);
  const sesion = { id: r.insertId, nombre, usuario, rol: ROLES.DUENO };
  res.status(201).json({ token: jwt.firmar(sesion), usuario: sesion });
}));

router.get('/yo', requiereSesion, (req, res) => res.json(req.usuario));

module.exports = router;
