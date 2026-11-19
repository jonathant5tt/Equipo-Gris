/**
 * @file rutas/ventas.js
 * @description Cobro en caja, consulta de ventas y envío del ticket.
 *
 *   POST /api/ventas/calcular            C D   { ID_Cliente|null, Detalle[] } → importes sin guardar
 *   POST /api/ventas                     C D   { ID_Cliente|null, MetodoPago, MontoRecibido?, TotalEsperado, Detalle[] }
 *   GET  /api/ventas?desde=&hasta=&concepto=&buscar=&pagina=&tamano=
 *   GET  /api/ventas/:id                 C D   Venta completa para el ticket
 *   POST /api/ventas/:id/enviar          C D   { canal: 'whatsapp'|'sms', Telefono? }
 *
 * Detalle[]: { TipoItem: 'Servicio', ID_Servicio, ID_Barbero } |
 *            { TipoItem: 'Servicio', ID_Cita }   (cita atendida pendiente de pago) |
 *            { TipoItem: 'Producto', ID_Producto, Cantidad } |
 *            { TipoItem: 'Membresía', ID_Membresia }
 * ID_Cliente null = «Cliente 0» (público en general).
 */
'use strict';

const express = require('../lib/web');
const db = require('../db');
const v = require('../servicios/validar');
const { calcularVenta, redondear } = require('../servicios/precios');
const whatsapp = require('../servicios/whatsapp');
const mensajes = require('../servicios/mensajes');
const { ROLES, requiereSesion, permitir, firma } = require('../middleware/autenticacion');
const { ErrorApi, envolver } = require('../middleware/errores');

const router = express.Router();
router.use(requiereSesion, permitir(ROLES.DUENO, ROLES.CAJERO));

const METODOS = ['Efectivo', 'Tarjeta', 'Transferencia'];
const NOMBRE_CLIENTE_0 = 'Cliente 0';

/**
 * Venta completa: encabezado, cliente, renglones y datos del negocio.
 * @param {number} id
 */
async function obtenerVenta(id) {
  const venta = await db.uno(
    `SELECT v.*, c.Nombre AS NombreCliente, c.Lada, c.Telefono AS TelefonoCliente,
            (c.EstadoMembresia = 'Activa' AND c.FechaVencimiento >= CURDATE()) AS ClienteConMembresia,
            m.NombrePlan AS PlanCliente, c.FechaVencimiento AS VenceMembresiaCliente
       FROM VENTA v
       LEFT JOIN CLIENTE c ON c.ID_Cliente = v.ID_Cliente
       LEFT JOIN MEMBRESIA m ON m.ID_Membresia = c.ID_Membresia
      WHERE v.ID_Venta = ?`, [id]);
  if (!venta) throw new ErrorApi(404, 'La venta no existe.');
  venta.NombreCliente = venta.NombreCliente || NOMBRE_CLIENTE_0;
  venta.ClienteConMembresia = !!Number(venta.ClienteConMembresia);
  venta.Detalle = await db.consultar(
    `SELECT d.*, b.Nombre AS NombreBarbero FROM DETALLE_VENTA d
       LEFT JOIN BARBERO b ON b.ID_Barbero = d.ID_Barbero
      WHERE d.ID_Venta = ? ORDER BY d.ID_Detalle`, [id]);
  venta.Detalle.forEach((d) => { d.UsaBeneficio = !!Number(d.UsaBeneficio); });
  venta.Reembolsos = await db.consultar(
    'SELECT ID_Reembolso, Fecha, Monto, MetodoDevolucion, Motivo FROM REEMBOLSO WHERE ID_Venta = ? ORDER BY ID_Reembolso', [id]);
  venta.Reembolsado = redondear(venta.Reembolsos.reduce((s, r) => s + Number(r.Monto), 0));
  venta.Establecimiento = await db.uno(
    `SELECT NombreEstablecimiento, Eslogan, Direccion, Telefono, DatosFiscales, MensajeTicket, RedesSociales
       FROM ESTABLECIMIENTO WHERE ID_Local = 1`);
  return venta;
}

/** Valida el pedido recibido. */
function leerPedido(b) {
  return {
    ID_Cliente: b.ID_Cliente ? v.entero(b.ID_Cliente, 'El cliente', { min: 1 }) : null,
    Detalle: Array.isArray(b.Detalle) ? b.Detalle : []
  };
}

router.post('/calcular', envolver(async (req, res) => {
  const calculo = await calcularVenta(db, leerPedido(req.body || {}));
  delete calculo.Cliente;
  res.json(calculo);
}));

router.post('/', envolver(async (req, res) => {
  const b = req.body || {};
  const pedido = leerPedido(b);
  const metodo = v.opcion(b.MetodoPago, 'El método de pago', METODOS);
  const esperado = v.importe(b.TotalEsperado, 'El total');

  const idVenta = await db.transaccion(async (tx) => {
    const calculo = await calcularVenta(tx, pedido, { bloquear: true });
    if (Math.abs(calculo.Total - esperado) > 0.009) {
      throw new ErrorApi(409, 'Los importes cambiaron (precios, existencias o membresía). Revisa la venta antes de cobrar.', { Calculo: calculo });
    }
    let recibido = null;
    let cambio = null;
    if (metodo === 'Efectivo') {
      recibido = v.importe(b.MontoRecibido, 'El monto recibido');
      if (recibido + 0.009 < calculo.Total) throw new ErrorApi(400, 'El monto recibido es menor al total.');
      cambio = redondear(recibido - calculo.Total);
    }

    const esDueno = req.usuario.rol === ROLES.DUENO;
    const venta = await tx.consultar(
      `INSERT INTO VENTA (Subtotal, Descuento, ImporteTotal, MetodoPago, MontoRecibido, Cambio,
                          ID_Cliente, ID_Cajero, ID_Admin, CobradoPor)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [calculo.Subtotal, calculo.Descuento, calculo.Total, metodo, recibido, cambio, pedido.ID_Cliente,
        esDueno ? null : req.usuario.id, esDueno ? req.usuario.id : null, firma(req.usuario)]);
    const id = venta.insertId;
    await tx.consultar(`UPDATE VENTA SET NumeroFactura = CONCAT('T-', YEAR(FechaHoraCobro), '-', LPAD(ID_Venta, 6, '0')) WHERE ID_Venta = ?`, [id]);

    for (const l of calculo.Lineas) {
      await tx.consultar(
        `INSERT INTO DETALLE_VENTA (ID_Venta, TipoItem, NombreItem, PrecioUnitario, Cantidad, Descuento, Importe,
                                    Beneficio, UsaBeneficio, ID_Beneficio, ID_Descuento, ID_Servicio, ID_Producto, ID_Membresia, ID_Barbero, ID_Cita, VenceMembresia)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, l.TipoItem, l.NombreItem, l.PrecioUnitario, l.Cantidad, l.Descuento, l.Importe, l.Beneficio,
          l.UsaBeneficio ? 1 : 0, l.ID_Beneficio || null, l.ID_Descuento || null, l.ID_Servicio || null, l.ID_Producto || null, l.ID_Membresia || null,
          l.ID_Barbero || null, l.ID_Cita || null, l.VenceMembresia || null]);

      if (l.TipoItem === 'Producto') {
        const r = await tx.consultar('UPDATE PRODUCTO SET Stock = Stock - ? WHERE ID_Producto = ? AND Stock >= ?',
          [l.Cantidad, l.ID_Producto, l.Cantidad]);
        if (!r.affectedRows) throw new ErrorApi(409, `Sin existencias suficientes de «${l.NombreItem}».`);
        const p = await tx.uno('SELECT Stock FROM PRODUCTO WHERE ID_Producto = ?', [l.ID_Producto]);
        await tx.consultar(
          `INSERT INTO MOVIMIENTO_INVENTARIO (ID_Producto, Tipo, Cantidad, StockFinal, Motivo, RealizadoPor, ID_Venta)
           VALUES (?, 'Venta', ?, ?, ?, ?, ?)`, [l.ID_Producto, l.Cantidad, p.Stock, 'Venta en caja', firma(req.usuario), id]);
      }
      if (l.ID_Cita) {
        const r = await tx.consultar('UPDATE CITA SET ID_Venta = ? WHERE ID_Cita = ? AND ID_Venta IS NULL', [id, l.ID_Cita]);
        if (!r.affectedRows) throw new ErrorApi(409, 'Una de las citas ya fue cobrada.');
      }
    }

    // Activar o renovar la membresía del cliente.
    const m = calculo.Membresia;
    if (m && m.Origen === 'EnEstaVenta') {
      await tx.consultar(
        `UPDATE CLIENTE SET EstadoMembresia = 'Activa', ID_Membresia = ?, FechaInicio = ?, FechaVencimiento = ?
          WHERE ID_Cliente = ?`, [m.ID_Membresia, m.InicioNuevo, m.VenceNueva, pedido.ID_Cliente]);
    }
    return id;
  });

  res.status(201).json(await obtenerVenta(idVenta));
}));

router.get('/', envolver(async (req, res) => {
  const q = req.query;
  const desde = v.fecha(q.desde, 'La fecha inicial');
  const hasta = v.fecha(q.hasta || q.desde, 'La fecha final');
  const pagina = v.entero(q.pagina || 1, 'La página', { min: 1 });
  const tamano = v.entero(q.tamano || 20, 'El tamaño de página', { min: 1, max: 5000 });

  const condiciones = ['DATE(v.FechaHoraCobro) BETWEEN ? AND ?'];
  const parametros = [desde, hasta];
  if (q.concepto) {
    condiciones.push('EXISTS (SELECT 1 FROM DETALLE_VENTA x WHERE x.ID_Venta = v.ID_Venta AND x.TipoItem = ?)');
    parametros.push(v.opcion(q.concepto, 'El concepto', ['Servicio', 'Producto', 'Membresía']));
  }
  if (q.buscar) {
    const texto = String(q.buscar).trim();
    if (/^cliente\s*0$/i.test(texto)) condiciones.push('v.ID_Cliente IS NULL');
    else {
      condiciones.push('(v.NumeroFactura LIKE ? OR c.Nombre LIKE ?)');
      parametros.push(`%${texto}%`, `%${texto}%`);
    }
  }
  const donde = `FROM VENTA v LEFT JOIN CLIENTE c ON c.ID_Cliente = v.ID_Cliente WHERE ${condiciones.join(' AND ')}`;

  const total = await db.uno(`SELECT COUNT(*) AS n ${donde}`, parametros);
  const registros = await db.consultar(
    `SELECT v.ID_Venta, v.NumeroFactura, v.FechaHoraCobro, v.Subtotal, v.Descuento, v.ImporteTotal, v.MetodoPago,
            v.CobradoPor, v.ID_Cliente, COALESCE(c.Nombre, '${NOMBRE_CLIENTE_0}') AS NombreCliente
       ${donde} ORDER BY v.FechaHoraCobro DESC, v.ID_Venta DESC LIMIT ? OFFSET ?`,
    [...parametros, tamano, (pagina - 1) * tamano]);

  // Resumen de conceptos de cada venta de la página
  if (registros.length) {
    const detalles = await db.consultar(
      `SELECT d.ID_Venta, d.TipoItem, d.NombreItem, d.Cantidad, b.Nombre AS NombreBarbero
         FROM DETALLE_VENTA d LEFT JOIN BARBERO b ON b.ID_Barbero = d.ID_Barbero
        WHERE d.ID_Venta IN (?) ORDER BY d.ID_Detalle`, [registros.map((r) => r.ID_Venta)]);
    for (const r of registros) {
      const propios = detalles.filter((d) => d.ID_Venta === r.ID_Venta);
      const primero = propios[0] || {};
      r.TipoItem = primero.TipoItem || null;
      r.Concepto = (primero.NombreItem || '') + (propios.length > 1 ? ` + ${propios.length - 1} más` : '');
      r.NombreBarbero = (propios.find((d) => d.NombreBarbero) || {}).NombreBarbero || null;
    }
    // Lo que ya se le reembolsó a cada venta
    const devuelto = await db.consultar(
      'SELECT ID_Venta, SUM(Monto) AS Monto FROM REEMBOLSO WHERE ID_Venta IN (?) GROUP BY ID_Venta', [registros.map((r) => r.ID_Venta)]);
    for (const r of registros) {
      r.Reembolsado = Number((devuelto.find((d) => d.ID_Venta === r.ID_Venta) || {}).Monto || 0);
    }
  }

  const resumen = await db.uno(
    `SELECT COUNT(*) AS Transacciones, COALESCE(SUM(v.ImporteTotal), 0) AS Total, COALESCE(SUM(v.Subtotal), 0) AS Bruto,
            COALESCE(SUM(v.Descuento), 0) AS Descuentos,
            COALESCE(SUM(IF(v.MetodoPago = 'Efectivo', v.ImporteTotal, 0)), 0) AS Efectivo,
            COALESCE(SUM(IF(v.MetodoPago = 'Tarjeta', v.ImporteTotal, 0)), 0) AS Tarjeta,
            COALESCE(SUM(IF(v.MetodoPago = 'Transferencia', v.ImporteTotal, 0)), 0) AS Transferencia
       ${donde}`, parametros);
  const piezas = await db.uno(
    `SELECT COALESCE(SUM(IF(d.TipoItem = 'Servicio', d.Cantidad, 0)), 0) AS Servicios,
            COALESCE(SUM(IF(d.TipoItem = 'Producto', d.Cantidad, 0)), 0) AS Productos,
            COALESCE(SUM(IF(d.TipoItem = 'Membresía', d.Cantidad, 0)), 0) AS Membresias,
            COALESCE(SUM(IF(d.TipoItem = 'Servicio', d.Importe, 0)), 0) AS ImporteServicios,
            COALESCE(SUM(IF(d.TipoItem = 'Producto', d.Importe, 0)), 0) AS ImporteProductos,
            COALESCE(SUM(IF(d.TipoItem = 'Membresía', d.Importe, 0)), 0) AS ImporteMembresias
       FROM DETALLE_VENTA d JOIN VENTA v ON v.ID_Venta = d.ID_Venta LEFT JOIN CLIENTE c ON c.ID_Cliente = v.ID_Cliente
      WHERE ${condiciones.join(' AND ')}`, parametros);
  const n = Number(resumen.Transacciones);
  // Reembolsos hechos en el periodo (por fecha del reembolso)
  const reembolsos = await db.uno(
    `SELECT COUNT(*) AS Numero, COALESCE(SUM(Monto), 0) AS Total FROM REEMBOLSO WHERE DATE(Fecha) BETWEEN ? AND ?`, [desde, hasta]);

  res.json({
    registros, total: Number(total.n), pagina,
    resumen: {
      Transacciones: n, Bruto: Number(resumen.Bruto), Total: Number(resumen.Total), Descuentos: Number(resumen.Descuentos),
      NumeroReembolsos: Number(reembolsos.Numero), Reembolsos: Number(reembolsos.Total),
      Neto: redondear(Number(resumen.Total) - Number(reembolsos.Total)),
      Servicios: Number(piezas.Servicios), Productos: Number(piezas.Productos), Membresias: Number(piezas.Membresias),
      PorTipo: {
        Servicios: { Cantidad: Number(piezas.Servicios), Importe: Number(piezas.ImporteServicios) },
        Productos: { Cantidad: Number(piezas.Productos), Importe: Number(piezas.ImporteProductos) },
        Membresias: { Cantidad: Number(piezas.Membresias), Importe: Number(piezas.ImporteMembresias) }
      },
      TicketPromedio: n ? redondear(Number(resumen.Total) / n) : 0,
      PorMetodo: { Efectivo: Number(resumen.Efectivo), Tarjeta: Number(resumen.Tarjeta), Transferencia: Number(resumen.Transferencia) }
    }
  });
}));

router.get('/:id', envolver(async (req, res) => res.json(await obtenerVenta(req.params.id))));

router.post('/:id/enviar', envolver(async (req, res) => {
  const canal = v.opcion(req.body && req.body.canal, 'El canal', ['whatsapp', 'sms']);
  const venta = await obtenerVenta(req.params.id);
  const telefono = req.body && req.body.Telefono ? v.telefono(req.body.Telefono) : venta.TelefonoCliente;
  if (!telefono) throw new ErrorApi(400, 'Escribe el número de teléfono al que se enviará el ticket.', { PedirTelefono: true });
  const texto = mensajes.ticket(venta, venta.Establecimiento);

  if (canal === 'sms') {
    const numero = whatsapp.numeroInternacional(telefono, venta.Lada);
    return res.json({ Enviado: false, Texto: texto, Telefono: numero, Enlace: `sms:+${numero}?body=${encodeURIComponent(texto)}` });
  }
  res.json(await whatsapp.enviar({ telefono, lada: venta.Lada, texto, tipo: 'Ticket', ids: { ID_Venta: venta.ID_Venta } }));
}));

module.exports = router;
