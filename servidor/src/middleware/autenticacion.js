/**
 * @file middleware/autenticacion.js
 * @description Protección de rutas: sesión obligatoria y permisos por rol.
 *
 * Roles: 'Dueño' (tabla ADMINISTRADOR), 'Cajero' (CAJERO), 'Barbero' (BARBERO).
 * En cada petición se confirma que la cuenta siga activa: si el Dueño elimina
 * una cuenta, su sesión deja de funcionar de inmediato.
 */
'use strict';

const jwt = require('../seguridad/jwt');
const db = require('../db');
const { ErrorApi, envolver } = require('./errores');

const ROLES = Object.freeze({ DUENO: 'Dueño', CAJERO: 'Cajero', BARBERO: 'Barbero' });

/** Tabla y llave primaria de cada rol. */
const TABLA_ROL = Object.freeze({
  [ROLES.DUENO]: { tabla: 'ADMINISTRADOR', id: 'ID_Admin' },
  [ROLES.CAJERO]: { tabla: 'CAJERO', id: 'ID_Cajero' },
  [ROLES.BARBERO]: { tabla: 'BARBERO', id: 'ID_Barbero' }
});

/** Exige un token válido y deja la sesión en req.usuario. */
const requiereSesion = envolver(async (req, res, next) => {
  if (req.usuario) return next();   // ya validada por un middleware anterior
  const cabecera = req.headers.authorization || '';
  const token = cabecera.startsWith('Bearer ') ? cabecera.slice(7) : null;
  const datos = jwt.verificar(token);
  if (!datos || !TABLA_ROL[datos.rol]) throw new ErrorApi(401, 'Tu sesión terminó. Inicia sesión de nuevo.');

  const { tabla, id } = TABLA_ROL[datos.rol];
  const cuenta = await db.uno(`SELECT Nombre FROM ${tabla} WHERE ${id} = ? AND Activo = 1`, [datos.id]);
  if (!cuenta) throw new ErrorApi(401, 'Tu cuenta ya no está activa.');

  req.usuario = { id: datos.id, rol: datos.rol, nombre: cuenta.Nombre, usuario: datos.usuario };
  next();
});

/**
 * Permite el paso solo a los roles indicados.
 * @param {...string} roles
 */
const permitir = (...roles) => (req, res, next) => {
  if (!req.usuario || !roles.includes(req.usuario.rol)) {
    return next(new ErrorApi(403, 'Tu rol no tiene permiso para esta acción.'));
  }
  next();
};

/** Texto «Nombre (Rol)» para bitácoras. */
const firma = (usuario) => `${usuario.nombre} (${usuario.rol})`;

module.exports = { ROLES, TABLA_ROL, requiereSesion, permitir, firma };
