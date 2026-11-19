/**
 * @file rutas/descuentos.js
 * @description Descuentos (promociones) que se aplican solos en caja.
 *
 *   GET    /api/descuentos              C D B   Todos (con Vigente). ?vigentes=1 → solo los que aplican hoy
 *   POST   /api/descuentos              D       { Nombre, Descripcion?, Aplica, ID_Servicio?, ID_Producto?,
 *                                                 Categoria?, ID_Membresia?, Tipo, Valor, FechaInicio?, FechaFin?, Activo? }
 *   PUT    /api/descuentos/:id          D
 *   DELETE /api/descuentos/:id          D       Baja lógica
 *
 * Aplica: 'Todo' | 'Servicios' | 'Productos' | 'Membresias'. Sin ID ni categoría
 * aplica a toda la sección. Tipo: 'Porcentaje' (1–100) | 'Monto' (pesos por pieza).
 */
'use strict';

const express = require('../lib/web');
const db = require('../db');
const v = require('../servicios/validar');
const f = require('../servicios/fechas');
const { ROLES, permitir } = require('../middleware/autenticacion');
const { ErrorApi, envolver } = require('../middleware/errores');

const router = express.Router();
const soloDueno = permitir(ROLES.DUENO);

async function listar(id) {
  const hoy = f.hoy();
  const filas = await db.consultar(
    `SELECT d.ID_Descuento, d.Nombre, d.Descripcion, d.Aplica, d.ID_Servicio, s.NombreServicio, d.ID_Producto, p.NombreProducto,
            d.Categoria, d.ID_Membresia, m.NombrePlan, d.Tipo, d.Valor, d.FechaInicio, d.FechaFin, d.Activo
       FROM DESCUENTO d
       LEFT JOIN SERVICIO s ON s.ID_Servicio = d.ID_Servicio
       LEFT JOIN PRODUCTO p ON p.ID_Producto = d.ID_Producto
       LEFT JOIN MEMBRESIA m ON m.ID_Membresia = d.ID_Membresia
      WHERE d.Eliminado = 0 ${id ? 'AND d.ID_Descuento = ?' : ''}
        AND (d.ID_Servicio IS NULL OR s.Activo = 1) AND (d.ID_Producto IS NULL OR p.Activo = 1)
        AND (d.ID_Membresia IS NULL OR m.Activo = 1)
      ORDER BY d.Activo DESC, d.ID_Descuento DESC`, id ? [id] : []);
  return filas.map((d) => {
    const activo = !!Number(d.Activo);
    const inicio = d.FechaInicio ? String(d.FechaInicio).slice(0, 10) : null;
    const fin = d.FechaFin ? String(d.FechaFin).slice(0, 10) : null;
    return {
      ...d, Valor: Number(d.Valor), Activo: activo, FechaInicio: inicio, FechaFin: fin,
      // Estado: 'Vigente' | 'En pausa' | 'Programado' (aún no empieza) | 'Terminado'
      Estado: !activo ? 'En pausa' : (inicio && inicio > hoy) ? 'Programado' : (fin && fin < hoy) ? 'Terminado' : 'Vigente',
      Vigente: activo && !(inicio && inicio > hoy) && !(fin && fin < hoy)
    };
  });
}

function datos(b) {
  const aplica = v.opcion(b.Aplica, 'La sección a la que aplica', ['Todo', 'Servicios', 'Productos', 'Membresias']);
  const tipo = v.opcion(b.Tipo, 'El tipo de descuento', ['Porcentaje', 'Monto']);
  const valor = v.importe(b.Valor, tipo === 'Porcentaje' ? 'El porcentaje' : 'El monto', tipo === 'Porcentaje' ? { min: 1, max: 100 } : { min: 0.01 });
  const inicio = v.fecha(b.FechaInicio, 'La fecha de inicio', false);
  const fin = v.fecha(b.FechaFin, 'La fecha de término', false);
  if (inicio && fin && fin < inicio) throw new ErrorApi(400, 'La fecha de término no puede ser anterior a la de inicio.');
  const id = (valorId, campo) => (valorId == null || valorId === '' ? null : v.entero(valorId, campo, { min: 1 }));
  return {
    Nombre: v.texto(b.Nombre, 'El nombre del descuento', { min: 2, max: 80, obligatorio: true }),
    Descripcion: v.textoLargo(b.Descripcion, 'La descripción', 255),
    Aplica: aplica,
    ID_Servicio: aplica === 'Servicios' ? id(b.ID_Servicio, 'El servicio') : null,
    ID_Producto: aplica === 'Productos' ? id(b.ID_Producto, 'El producto') : null,
    Categoria: aplica === 'Productos' && !b.ID_Producto ? v.texto(b.Categoria, 'La categoría', { min: 2, max: 40 }) : null,
    ID_Membresia: aplica === 'Membresias' ? id(b.ID_Membresia, 'La membresía') : null,
    Tipo: tipo, Valor: valor, FechaInicio: inicio, FechaFin: fin,
    Activo: b.Activo === undefined || b.Activo === null ? 1 : (b.Activo ? 1 : 0)
  };
}

/** Los elementos elegidos deben existir y estar activos. */
async function validarDestino(d) {
  const revisar = async (tabla, campo, valor, nombre) => {
    if (valor != null && !(await db.uno(`SELECT 1 AS ok FROM ${tabla} WHERE ${campo} = ? AND Activo = 1`, [valor]))) {
      throw new ErrorApi(400, `${nombre} ya no existe.`);
    }
  };
  await revisar('SERVICIO', 'ID_Servicio', d.ID_Servicio, 'El servicio');
  await revisar('PRODUCTO', 'ID_Producto', d.ID_Producto, 'El producto');
  await revisar('MEMBRESIA', 'ID_Membresia', d.ID_Membresia, 'La membresía');
}

const CAMPOS = ['Nombre', 'Descripcion', 'Aplica', 'ID_Servicio', 'ID_Producto', 'Categoria', 'ID_Membresia', 'Tipo', 'Valor', 'FechaInicio', 'FechaFin', 'Activo'];

router.get('/', envolver(async (req, res) => {
  const lista = await listar();
  res.json(req.query.vigentes ? lista.filter((d) => d.Vigente) : lista);
}));

router.post('/', soloDueno, envolver(async (req, res) => {
  const d = datos(req.body || {});
  await validarDestino(d);
  const r = await db.consultar(
    `INSERT INTO DESCUENTO (${CAMPOS.join(', ')}) VALUES (${CAMPOS.map(() => '?').join(', ')})`, CAMPOS.map((c) => d[c]));
  res.status(201).json((await listar(r.insertId))[0]);
}));

router.put('/:id', soloDueno, envolver(async (req, res) => {
  const d = datos(req.body || {});
  await validarDestino(d);
  const r = await db.consultar(
    `UPDATE DESCUENTO SET ${CAMPOS.map((c) => c + ' = ?').join(', ')} WHERE ID_Descuento = ? AND Eliminado = 0`,
    [...CAMPOS.map((c) => d[c]), req.params.id]);
  if (!r.affectedRows) throw new ErrorApi(404, 'El descuento no existe.');
  res.json((await listar(req.params.id))[0]);
}));

router.delete('/:id', soloDueno, envolver(async (req, res) => {
  const r = await db.consultar('UPDATE DESCUENTO SET Eliminado = 1, Activo = 0 WHERE ID_Descuento = ? AND Eliminado = 0', [req.params.id]);
  if (!r.affectedRows) throw new ErrorApi(404, 'El descuento no existe.');
  res.status(204).end();
}));

module.exports = router;
module.exports.listar = listar;
