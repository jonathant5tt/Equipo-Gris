/**
 * @file rutas/cierres.js
 * @description Cierre de caja (corte). La barbería tiene una sola caja: el
 * corte incluye TODAS las ventas y reembolsos que aún no tienen corte, los
 * haya hecho el cajero o el dueño.
 *
 *   GET  /api/cierres/resumen    C D   Turno actual: ventas y reembolsos sin corte, con todos los totales
 *   POST /api/cierres            C D   { EfectivoContado, Arqueo?, Observaciones? } → corte registrado
 *   GET  /api/cierres?limite=10  C D   Cortes anteriores
 *   GET  /api/cierres/:id        C D   Un corte con el mismo desglose (para consultarlo o exportarlo)
 *
 * Contenido del reporte (resumen y corte):
 *   Periodo (Desde–Hasta), responsable, fondo inicial
 *   VentasBrutas − Descuentos = TotalIngresos (ventas cobradas)
 *   − TotalReembolsos = IngresoNeto
 *   PorMetodo y Operaciones (efectivo, tarjeta, transferencia) y ReembolsosPorMetodo
 *   EfectivoEsperado = FondoInicial + ventas en efectivo − reembolsos en efectivo
 *   EfectivoContado, Diferencia (sobrante o faltante), Arqueo (billetes y monedas)
 *   PorTipo (servicios, productos, membresías), PorBarbero, PorCajero, ProductosVendidos
 *   Ventas[] y Reembolsos[], ticket promedio
 */
'use strict';

const express = require('../lib/web');
const db = require('../db');
const v = require('../servicios/validar');
const f = require('../servicios/fechas');
const { redondear } = require('../servicios/precios');
const { DENOMINACIONES, totales, leerArqueo } = require('../servicios/caja');
const { ROLES, requiereSesion, permitir, firma } = require('../middleware/autenticacion');
const { ErrorApi, envolver } = require('../middleware/errores');

const router = express.Router();
router.use(requiereSesion, permitir(ROLES.DUENO, ROLES.CAJERO));

/**
 * Ventas y reembolsos sin corte (o los de un corte).
 * @param {Object} tx
 * @param {boolean} [bloquear]
 * @param {number} [idCorte]
 */
async function operaciones(tx, bloquear, idCorte) {
  const filtro = (alias) => (idCorte ? `${alias}.ID_Corte = ?` : `${alias}.ID_Corte IS NULL`);
  const parametros = idCorte ? [idCorte] : [];
  const ventas = await tx.consultar(
    `SELECT v.ID_Venta, v.NumeroFactura, v.FechaHoraCobro, v.Subtotal, v.ImporteTotal, v.Descuento, v.MetodoPago, v.CobradoPor,
            COALESCE(c.Nombre, 'Cliente 0') AS NombreCliente
       FROM VENTA v LEFT JOIN CLIENTE c ON c.ID_Cliente = v.ID_Cliente
      WHERE ${filtro('v')} ORDER BY v.FechaHoraCobro, v.ID_Venta${bloquear ? ' FOR UPDATE' : ''}`, parametros);
  let detalle = [];
  if (ventas.length) {
    detalle = await tx.consultar(
      `SELECT d.ID_Venta, d.TipoItem, d.NombreItem, d.Cantidad, d.Importe, d.Descuento, b.Nombre AS NombreBarbero
         FROM DETALLE_VENTA d LEFT JOIN BARBERO b ON b.ID_Barbero = d.ID_Barbero
        WHERE d.ID_Venta IN (?) ORDER BY d.ID_Detalle`, [ventas.map((x) => x.ID_Venta)]);
    for (const venta of ventas) {
      const propios = detalle.filter((d) => d.ID_Venta === venta.ID_Venta);
      venta.Concepto = ((propios[0] || {}).NombreItem || '') + (propios.length > 1 ? ` + ${propios.length - 1} más` : '');
      venta.Servicios = propios.filter((d) => d.TipoItem === 'Servicio').reduce((s, d) => s + d.Cantidad, 0);
      venta.Productos = propios.filter((d) => d.TipoItem === 'Producto').reduce((s, d) => s + d.Cantidad, 0);
    }
  }
  const reembolsos = await tx.consultar(
    `SELECT r.ID_Reembolso, r.Fecha, r.Monto, r.MetodoDevolucion, r.Motivo, r.RealizadoPor, v.NumeroFactura,
            COALESCE(c.Nombre, 'Cliente 0') AS NombreCliente
       FROM REEMBOLSO r JOIN VENTA v ON v.ID_Venta = r.ID_Venta LEFT JOIN CLIENTE c ON c.ID_Cliente = v.ID_Cliente
      WHERE ${filtro('r')} ORDER BY r.Fecha, r.ID_Reembolso${bloquear ? ' FOR UPDATE' : ''}`, parametros);
  reembolsos.forEach((r) => { r.Monto = Number(r.Monto); });
  return { ventas, detalle, reembolsos };
}

async function fondoCaja(tx) {
  const e = await tx.uno('SELECT FondoCaja FROM ESTABLECIMIENTO WHERE ID_Local = 1');
  return Number((e && e.FondoCaja) || 0);
}

router.get('/resumen', envolver(async (req, res) => {
  const o = await operaciones(db);
  const ahora = f.ahora();
  res.json({ ...totales(o, await fondoCaja(db)), Ventas: o.ventas, Reembolsos: o.reembolsos, Responsable: req.usuario.nombre,
    Hasta: `${ahora.fecha} ${ahora.hora}`, Denominaciones: DENOMINACIONES });
}));

router.post('/', envolver(async (req, res) => {
  const b = req.body || {};
  const contado = v.importe(b.EfectivoContado, 'El efectivo contado');
  const observaciones = v.textoLargo(b.Observaciones, 'Las observaciones', 500);
  const { arqueo } = leerArqueo(b.Arqueo);
  const id = await db.transaccion(async (tx) => {
    const o = await operaciones(tx, true);
    if (!o.ventas.length && !o.reembolsos.length) throw new ErrorApi(409, 'No hay ventas ni reembolsos pendientes de corte.');
    const t = totales(o, await fondoCaja(tx));
    const esDueno = req.usuario.rol === ROLES.DUENO;
    const r = await tx.consultar(
      `INSERT INTO CIERRE_CAJA (NumeroVentas, TotalIngresos, TotalEfectivo, TotalTarjeta, TotalTransferencia,
                                FondoInicial, EfectivoContado, Diferencia, ID_Cajero, ID_Admin, RealizadoPor,
                                Desde, VentasBrutas, TotalDescuentos, NumeroReembolsos, TotalReembolsos, ReembolsosEfectivo, Arqueo, Observaciones)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [t.NumeroVentas, t.TotalIngresos, t.PorMetodo.Efectivo, t.PorMetodo.Tarjeta, t.PorMetodo.Transferencia,
        t.FondoInicial, contado, redondear(contado - t.EfectivoEsperado),
        esDueno ? null : req.usuario.id, esDueno ? req.usuario.id : null, firma(req.usuario),
        t.Desde, t.VentasBrutas, t.Descuentos, t.NumeroReembolsos, t.TotalReembolsos, t.ReembolsosPorMetodo.Efectivo,
        arqueo ? JSON.stringify(arqueo) : null, observaciones]);
    if (o.ventas.length) await tx.consultar('UPDATE VENTA SET ID_Corte = ? WHERE ID_Venta IN (?)', [r.insertId, o.ventas.map((x) => x.ID_Venta)]);
    if (o.reembolsos.length) await tx.consultar('UPDATE REEMBOLSO SET ID_Corte = ? WHERE ID_Reembolso IN (?)', [r.insertId, o.reembolsos.map((x) => x.ID_Reembolso)]);
    return r.insertId;
  });
  res.status(201).json(await corteCompleto(id));
}));

/** Un corte guardado con todo su desglose. */
async function corteCompleto(id) {
  const corte = await db.uno('SELECT * FROM CIERRE_CAJA WHERE ID_Corte = ?', [id]);
  if (!corte) throw new ErrorApi(404, 'El corte no existe.');
  const o = await operaciones(db, false, id);
  const t = totales(o, Number(corte.FondoInicial || 0));
  let arqueo = null;
  try { arqueo = corte.Arqueo ? JSON.parse(corte.Arqueo) : null; } catch (e) { arqueo = null; }
  return {
    ...t, ...corte, Arqueo: arqueo, Descuentos: t.Descuentos, Desde: corte.Desde || t.Desde, Hasta: corte.FechaCorte,
    EfectivoEsperado: t.EfectivoEsperado, Ventas: o.ventas, Reembolsos: o.reembolsos
  };
}

router.get('/', envolver(async (req, res) => {
  const limite = v.entero(req.query.limite || 10, 'El límite', { min: 1, max: 100 });
  res.json(await db.consultar('SELECT * FROM CIERRE_CAJA ORDER BY FechaCorte DESC, ID_Corte DESC LIMIT ?', [limite]));
}));

router.get('/:id', envolver(async (req, res) => {
  res.json(await corteCompleto(v.entero(req.params.id, 'El corte', { min: 1 })));
}));

module.exports = router;
