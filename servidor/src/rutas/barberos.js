/**
 * @file rutas/barberos.js
 * @description Barberos: lista, horario e ingresos.
 *
 *   GET /api/barberos                     C D B   Barberos activos
 *   GET /api/barberos/yo                  B       Barbero con sesión
 *   PUT /api/barberos/:id/horario         D       Jornada, comida, días y actividades
 *   GET /api/barberos/:id/ingresos?dias=7 D       Servicios e ingresos por día
 */
'use strict';

const express = require('../lib/web');
const db = require('../db');
const v = require('../servicios/validar');
const f = require('../servicios/fechas');
const { ROLES, requiereSesion, permitir } = require('../middleware/autenticacion');
const { ErrorApi, envolver } = require('../middleware/errores');

const router = express.Router();
router.use(requiereSesion);

const CAMPOS = `ID_Barbero, Nombre, Usuario, Telefono, HoraEntrada, HoraSalida, ComidaInicio, ComidaFin,
                DiasTrabajo, RolesActividades, FechaRegistro`;

router.get('/', envolver(async (req, res) => {
  res.json(await db.consultar(`SELECT ${CAMPOS} FROM BARBERO WHERE Activo = 1 ORDER BY Nombre`));
}));

router.get('/yo', permitir(ROLES.BARBERO), envolver(async (req, res) => {
  res.json(await db.uno(`SELECT ${CAMPOS} FROM BARBERO WHERE ID_Barbero = ? AND Activo = 1`, [req.usuario.id]));
}));

router.put('/:id/horario', permitir(ROLES.DUENO), envolver(async (req, res) => {
  const b = req.body || {};
  const entrada = v.hora(b.HoraEntrada, 'La hora de entrada');
  const salida = v.hora(b.HoraSalida, 'La hora de salida');
  const comidaInicio = v.hora(b.ComidaInicio, 'El inicio de la comida', false);
  const comidaFin = v.hora(b.ComidaFin, 'El fin de la comida', false);
  if (salida <= entrada) throw new ErrorApi(400, 'La hora de salida debe ser posterior a la de entrada.');
  if (!!comidaInicio !== !!comidaFin) throw new ErrorApi(400, 'Captura el inicio y el fin de la comida, o deja ambos vacíos.');
  if (comidaInicio && (comidaFin <= comidaInicio || comidaInicio < entrada || comidaFin > salida)) {
    throw new ErrorApi(400, 'La comida debe quedar dentro de la jornada.');
  }
  const dias = v.dias(b.DiasTrabajo, 'Días de trabajo', true);
  const roles = v.texto(b.RolesActividades, 'Roles / actividades');

  const r = await db.consultar(
    `UPDATE BARBERO SET HoraEntrada = ?, HoraSalida = ?, ComidaInicio = ?, ComidaFin = ?, DiasTrabajo = ?,
            RolesActividades = ? WHERE ID_Barbero = ? AND Activo = 1`,
    [entrada, salida, comidaInicio, comidaFin, dias, roles, req.params.id]);
  if (!r.affectedRows) throw new ErrorApi(404, 'El barbero no existe.');

  await db.consultar('INSERT INTO AVISO (ID_Barbero, Tipo, Mensaje) VALUES (?, ?, ?)',
    [req.params.id, 'Cambio de horario',
      `Tu horario ahora es de ${f.hora12(entrada)} a ${f.hora12(salida)}, días ${dias}.`]);
  res.json(await db.uno(`SELECT ${CAMPOS} FROM BARBERO WHERE ID_Barbero = ?`, [req.params.id]));
}));

router.get('/:id/ingresos', permitir(ROLES.DUENO), envolver(async (req, res) => {
  const dias = v.entero(req.query.dias || 7, 'Los días', { min: 1, max: 90 });
  const desde = f.sumarDias(f.hoy(), -(dias - 1));
  res.json(await db.consultar(
    `SELECT DATE(v.FechaHoraCobro) AS Fecha, SUM(d.Cantidad) AS Servicios, SUM(d.Importe) AS Ingreso
       FROM DETALLE_VENTA d JOIN VENTA v ON v.ID_Venta = d.ID_Venta
      WHERE d.ID_Barbero = ? AND d.TipoItem = 'Servicio' AND DATE(v.FechaHoraCobro) >= ?
      GROUP BY DATE(v.FechaHoraCobro) ORDER BY Fecha DESC`, [req.params.id, desde]));
}));

module.exports = router;
