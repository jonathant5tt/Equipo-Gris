/**
 * @file rutas/cuentas.js
 * @description Cuentas de cajeros y barberos (solo Dueño).
 *
 *   GET    /api/cuentas                         Lista de cuentas activas (incluye dueños)
 *   POST   /api/cuentas                         { Rol, Nombre, Usuario, Contrasena, Telefono? }
 *   PUT    /api/cuentas/:rol/:id/contrasena     { Contrasena }  Cambia la contraseña
 *   DELETE /api/cuentas/:rol/:id                Da de baja la cuenta (libera el usuario)
 *
 * :rol = 'cajero' | 'barbero' | 'dueno' (el dueño solo puede cambiar su
 * contraseña, no darse de baja). Las cuentas no se borran físicamente porque
 * sus ventas y citas forman parte del historial.
 */
'use strict';

const express = require('../lib/web');
const db = require('../db');
const v = require('../servicios/validar');
const contrasenas = require('../seguridad/contrasenas');
const { ROLES, TABLA_ROL, requiereSesion, permitir } = require('../middleware/autenticacion');
const { ErrorApi, envolver } = require('../middleware/errores');

const router = express.Router();
router.use(requiereSesion, permitir(ROLES.DUENO));

const ROL_RUTA = { cajero: ROLES.CAJERO, barbero: ROLES.BARBERO, dueno: ROLES.DUENO };

/** ¿El usuario ya existe en alguna de las tres tablas? */
async function usuarioOcupado(usuario) {
  for (const { tabla } of Object.values(TABLA_ROL)) {
    if (await db.uno(`SELECT 1 FROM ${tabla} WHERE Usuario = ?`, [usuario])) return true;
  }
  return false;
}

/** @returns {{rol: string, tabla: string, id: string}} */
function rolDeRuta(texto) {
  const clave = String(texto).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const rol = ROL_RUTA[clave];
  if (!rol) throw new ErrorApi(404, 'Tipo de cuenta no válido.');
  return { rol, ...TABLA_ROL[rol] };
}

router.get('/', envolver(async (req, res) => {
  const filas = await db.consultar(
    `SELECT 'Dueño' AS Rol, ID_Admin AS ID, Nombre, Usuario, NULL AS Telefono, FechaRegistro FROM ADMINISTRADOR WHERE Activo = 1
     UNION ALL
     SELECT 'Cajero', ID_Cajero, Nombre, Usuario, Telefono, FechaRegistro FROM CAJERO WHERE Activo = 1
     UNION ALL
     SELECT 'Barbero', ID_Barbero, Nombre, Usuario, Telefono, FechaRegistro FROM BARBERO WHERE Activo = 1
     ORDER BY Rol, Nombre`);
  res.json(filas);
}));

router.post('/', envolver(async (req, res) => {
  const b = req.body || {};
  const rol = v.opcion(b.Rol, 'El rol', [ROLES.CAJERO, ROLES.BARBERO]);
  const nombre = v.texto(b.Nombre, 'El nombre', { min: 3, max: 100, obligatorio: true });
  const usuario = v.usuario(b.Usuario);
  const clave = v.contrasena(b.Contrasena);
  const telefono = v.telefono(b.Telefono, 'El teléfono', false);
  if (await usuarioOcupado(usuario)) throw new ErrorApi(409, `El usuario «${usuario}» ya está en uso. Elige otro.`);

  const cifrada = await contrasenas.cifrar(clave);
  const tabla = TABLA_ROL[rol].tabla;
  const r = await db.consultar(
    `INSERT INTO ${tabla} (Nombre, Usuario, Contrasena, Telefono) VALUES (?, ?, ?, ?)`,
    [nombre, usuario, cifrada, telefono]);
  res.status(201).json({ Rol: rol, ID: r.insertId, Nombre: nombre, Usuario: usuario, Telefono: telefono });
}));

router.put('/:rol/:id/contrasena', envolver(async (req, res) => {
  const { tabla, id } = rolDeRuta(req.params.rol);
  const cifrada = await contrasenas.cifrar(v.contrasena(req.body && req.body.Contrasena));
  const r = await db.consultar(`UPDATE ${tabla} SET Contrasena = ? WHERE ${id} = ? AND Activo = 1`, [cifrada, req.params.id]);
  if (!r.affectedRows) throw new ErrorApi(404, 'La cuenta no existe.');
  res.status(204).end();
}));

router.delete('/:rol/:id', envolver(async (req, res) => {
  const { rol, tabla, id } = rolDeRuta(req.params.rol);
  if (rol === ROLES.DUENO) throw new ErrorApi(403, 'La cuenta del dueño no se puede eliminar.');
  if (rol === ROLES.BARBERO) {
    const pendientes = await db.uno(
      `SELECT COUNT(*) AS n FROM CITA WHERE ID_Barbero = ? AND Estado IN ('Agendada','EnEspera','EnAtencion') AND FechaHora >= NOW()`,
      [req.params.id]);
    if (pendientes.n > 0) throw new ErrorApi(409, `Este barbero tiene ${pendientes.n} cita(s) próximas. Reprográmalas o cancélalas antes de eliminar la cuenta.`);
  }
  const r = await db.consultar(
    `UPDATE ${tabla} SET Activo = 0, Usuario = NULL WHERE ${id} = ? AND Activo = 1`, [req.params.id]);
  if (!r.affectedRows) throw new ErrorApi(404, 'La cuenta no existe.');
  res.status(204).end();
}));

module.exports = router;
