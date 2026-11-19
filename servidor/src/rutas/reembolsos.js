/**
 * @file rutas/reembolsos.js
 * @description Reembolsos (devolución total o parcial de una venta).
 *
 *   GET  /api/reembolsos?desde=&hasta=      C D   Reembolsos del periodo (con sus renglones)
 *   GET  /api/reembolsos/venta/:id          C D   Venta con lo ya reembolsado y lo disponible por renglón
 *   POST /api/reembolsos                    C D   { ID_Venta, Renglones: [{ ID_Detalle, Cantidad }], Motivo,
 *                                                   MetodoDevolucion, RegresarInventario, Contrasena }
 *
 * Reglas:
 *  - Se autoriza con la contraseña de la cuenta con sesión.
 *  - Se devuelve lo que el cliente pagó por cada pieza (importe con descuento).
 *  - No se puede devolver más de lo vendido en cada renglón.
 *  - RegresarInventario suma los productos devueltos a las existencias.
 *  - Si se reembolsa la membresía comprada en esa venta, se desactiva la
 *    membresía del cliente.
 *  - El reembolso entra en el corte de caja del turno en que se hace; si se
 *    devuelve en efectivo, se resta del efectivo esperado.
 */
'use strict';

const express = require('../lib/web');
const db = require('../db');
const v = require('../servicios/validar');
const contrasenas = require('../seguridad/contrasenas');
const { redondear } = require('../servicios/precios');
const { ROLES, TABLA_ROL, requiereSesion, permitir, firma } = require('../middleware/autenticacion');
const { ErrorApi, envolver } = require('../middleware/errores');

const router = express.Router();
router.use(requiereSesion, permitir(ROLES.DUENO, ROLES.CAJERO));

const METODOS = ['Efectivo', 'Tarjeta', 'Transferencia'];

/**
 * Venta con sus renglones y cuánto queda por reembolsar en cada uno.
 * @param {Object} tx  db o transacción
 */
async function ventaParaReembolso(tx, idVenta, bloquear) {
  const venta = await tx.uno(
    `SELECT v.ID_Venta, v.NumeroFactura, v.FechaHoraCobro, v.Subtotal, v.Descuento, v.ImporteTotal, v.MetodoPago, v.ID_Cliente,
            COALESCE(c.Nombre, 'Cliente 0') AS NombreCliente
       FROM VENTA v LEFT JOIN CLIENTE c ON c.ID_Cliente = v.ID_Cliente WHERE v.ID_Venta = ?${bloquear ? ' FOR UPDATE' : ''}`, [idVenta]);
  if (!venta) throw new ErrorApi(404, 'La venta no existe.');
  const detalle = await tx.consultar(
    `SELECT d.ID_Detalle, d.TipoItem, d.NombreItem, d.PrecioUnitario, d.Cantidad, d.Descuento, d.Importe, d.Beneficio,
            d.ID_Producto, d.ID_Membresia, d.VenceMembresia, b.Nombre AS NombreBarbero
       FROM DETALLE_VENTA d LEFT JOIN BARBERO b ON b.ID_Barbero = d.ID_Barbero WHERE d.ID_Venta = ? ORDER BY d.ID_Detalle`, [idVenta]);
  const devuelto = await tx.consultar(
    `SELECT rd.ID_Detalle, SUM(rd.Cantidad) AS Cantidad, SUM(rd.Importe) AS Importe
       FROM REEMBOLSO_DETALLE rd JOIN REEMBOLSO r ON r.ID_Reembolso = rd.ID_Reembolso
      WHERE r.ID_Venta = ? GROUP BY rd.ID_Detalle`, [idVenta]);
  const mapa = new Map(devuelto.map((x) => [x.ID_Detalle, x]));
  venta.Detalle = detalle.map((d) => {
    const ya = mapa.get(d.ID_Detalle) || { Cantidad: 0, Importe: 0 };
    return {
      ...d, PrecioUnitario: Number(d.PrecioUnitario), Descuento: Number(d.Descuento), Importe: Number(d.Importe),
      CantidadReembolsada: Number(ya.Cantidad), ImporteReembolsado: Number(ya.Importe),
      CantidadDisponible: d.Cantidad - Number(ya.Cantidad), ImporteDisponible: redondear(Number(d.Importe) - Number(ya.Importe))
    };
  });
  venta.Reembolsado = redondear(venta.Detalle.reduce((s, d) => s + d.ImporteReembolsado, 0));
  venta.Disponible = redondear(venta.Detalle.reduce((s, d) => s + d.ImporteDisponible, 0));
  return venta;
}

router.get('/venta/:id', envolver(async (req, res) => {
  res.json(await ventaParaReembolso(db, v.entero(req.params.id, 'La venta', { min: 1 })));
}));

router.get('/', envolver(async (req, res) => {
  const desde = v.fecha(req.query.desde, 'La fecha inicial');
  const hasta = v.fecha(req.query.hasta || req.query.desde, 'La fecha final');
  const lista = await db.consultar(
    `SELECT r.ID_Reembolso, r.ID_Venta, r.Fecha, r.Monto, r.MetodoDevolucion, r.Motivo, r.RegresaInventario, r.RealizadoPor, r.ID_Corte,
            v.NumeroFactura, COALESCE(c.Nombre, 'Cliente 0') AS NombreCliente
       FROM REEMBOLSO r JOIN VENTA v ON v.ID_Venta = r.ID_Venta LEFT JOIN CLIENTE c ON c.ID_Cliente = v.ID_Cliente
      WHERE DATE(r.Fecha) BETWEEN ? AND ? ORDER BY r.Fecha DESC, r.ID_Reembolso DESC`, [desde, hasta]);
  if (lista.length) {
    const det = await db.consultar(
      `SELECT rd.ID_Reembolso, rd.Cantidad, rd.Importe, d.NombreItem, d.TipoItem
         FROM REEMBOLSO_DETALLE rd JOIN DETALLE_VENTA d ON d.ID_Detalle = rd.ID_Detalle WHERE rd.ID_Reembolso IN (?)`,
      [lista.map((x) => x.ID_Reembolso)]);
    for (const r of lista) {
      const propios = det.filter((d) => d.ID_Reembolso === r.ID_Reembolso);
      r.Concepto = propios.map((d) => (d.Cantidad > 1 ? d.Cantidad + ' x ' : '') + d.NombreItem).join(', ');
      r.Monto = Number(r.Monto);
      r.RegresaInventario = !!Number(r.RegresaInventario);
    }
  }
  const suma = (m) => redondear(lista.filter((r) => !m || r.MetodoDevolucion === m).reduce((s, r) => s + Number(r.Monto), 0));
  res.json({ registros: lista, resumen: { Numero: lista.length, Total: suma(), PorMetodo: { Efectivo: suma('Efectivo'), Tarjeta: suma('Tarjeta'), Transferencia: suma('Transferencia') } } });
}));

router.post('/', envolver(async (req, res) => {
  const b = req.body || {};
  const idVenta = v.entero(b.ID_Venta, 'La venta', { min: 1 });
  const motivo = v.texto(b.Motivo, 'El motivo', { min: 3, max: 255, obligatorio: true });
  const metodo = v.opcion(b.MetodoDevolucion, 'La forma de devolución', METODOS);
  const renglones = Array.isArray(b.Renglones) ? b.Renglones : [];
  if (!renglones.length) throw new ErrorApi(400, 'Elige al menos un concepto para reembolsar.');

  // Autorización: contraseña de la cuenta con sesión.
  const { tabla, id } = TABLA_ROL[req.usuario.rol];
  const cuenta = await db.uno(`SELECT Contrasena FROM ${tabla} WHERE ${id} = ?`, [req.usuario.id]);
  if (!cuenta || !(await contrasenas.verificar(String(b.Contrasena || ''), cuenta.Contrasena))) {
    throw new ErrorApi(403, 'Contraseña incorrecta. No se hizo el reembolso.');
  }

  const resultado = await db.transaccion(async (tx) => {
    const venta = await ventaParaReembolso(tx, idVenta, true);
    const partes = [];
    const vistos = new Set();
    for (const [i, r] of renglones.entries()) {
      const idDetalle = v.entero(r.ID_Detalle, `Concepto ${i + 1}`, { min: 1 });
      const d = venta.Detalle.find((x) => x.ID_Detalle === idDetalle);
      if (!d || vistos.has(idDetalle)) throw new ErrorApi(400, `Concepto ${i + 1}: no pertenece a esta venta.`);
      vistos.add(idDetalle);
      const cantidad = v.entero(r.Cantidad == null ? d.CantidadDisponible : r.Cantidad, `Concepto ${i + 1}: la cantidad`, { min: 1 });
      if (cantidad > d.CantidadDisponible) {
        throw new ErrorApi(409, d.CantidadDisponible
          ? `«${d.NombreItem}»: solo quedan ${d.CantidadDisponible} por reembolsar.` : `«${d.NombreItem}» ya fue reembolsado.`);
      }
      // Lo pagado por pieza; la última pieza se lleva el resto para no perder centavos.
      const importe = cantidad === d.CantidadDisponible ? d.ImporteDisponible : redondear(d.Importe / d.Cantidad * cantidad);
      partes.push({ d, cantidad, importe });
    }
    const monto = redondear(partes.reduce((s, p) => s + p.importe, 0));
    if (monto <= 0) throw new ErrorApi(400, 'Esos conceptos no tuvieron costo para el cliente: no hay importe que devolver.');

    const regresar = !!b.RegresarInventario && partes.some((p) => p.d.TipoItem === 'Producto' && p.d.ID_Producto);
    const ins = await tx.consultar(
      `INSERT INTO REEMBOLSO (ID_Venta, Monto, MetodoDevolucion, Motivo, RegresaInventario, RealizadoPor) VALUES (?, ?, ?, ?, ?, ?)`,
      [idVenta, monto, metodo, motivo, regresar ? 1 : 0, firma(req.usuario)]);
    let membresiaCancelada = false;
    for (const p of partes) {
      await tx.consultar('INSERT INTO REEMBOLSO_DETALLE (ID_Reembolso, ID_Detalle, Cantidad, Importe) VALUES (?, ?, ?, ?)',
        [ins.insertId, p.d.ID_Detalle, p.cantidad, p.importe]);
      if (regresar && p.d.TipoItem === 'Producto' && p.d.ID_Producto) {
        await tx.consultar('UPDATE PRODUCTO SET Stock = Stock + ? WHERE ID_Producto = ?', [p.cantidad, p.d.ID_Producto]);
        const prod = await tx.uno('SELECT Stock FROM PRODUCTO WHERE ID_Producto = ?', [p.d.ID_Producto]);
        await tx.consultar(
          `INSERT INTO MOVIMIENTO_INVENTARIO (ID_Producto, Tipo, Cantidad, StockFinal, Motivo, RealizadoPor, ID_Venta)
           VALUES (?, 'Entrada', ?, ?, ?, ?, ?)`,
          [p.d.ID_Producto, p.cantidad, prod.Stock, `Devolución por reembolso de ${venta.NumeroFactura}`, firma(req.usuario), idVenta]);
      }
      if (p.d.TipoItem === 'Membresía' && venta.ID_Cliente) {
        const r = await tx.consultar(
          `UPDATE CLIENTE SET EstadoMembresia = 'Inactiva' WHERE ID_Cliente = ? AND ID_Membresia = ? AND EstadoMembresia = 'Activa'`,
          [venta.ID_Cliente, p.d.ID_Membresia]);
        membresiaCancelada = membresiaCancelada || r.affectedRows > 0;
      }
    }
    return { ID_Reembolso: ins.insertId, Monto: monto, MetodoDevolucion: metodo, RegresaInventario: regresar, MembresiaCancelada: membresiaCancelada };
  });
  res.status(201).json({ ...resultado, Venta: await ventaParaReembolso(db, idVenta) });
}));

module.exports = router;
