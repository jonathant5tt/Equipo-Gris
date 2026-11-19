/**
 * @file servicios/mensajes.js
 * @description Textos que se envían al cliente por WhatsApp o SMS:
 * confirmación de cita y ticket de venta.
 */
'use strict';

const f = require('./fechas');

const dinero = (n) => '$' + Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Confirmación de cita.
 * @param {Object} cita  { NombreCliente, FechaHora, NombreServicio, DuracionMin, NombreBarbero }
 * @param {Object} negocio  { NombreEstablecimiento, Direccion }
 * @returns {{texto: string, parametros: string[]}}
 */
function confirmacionCita(cita, negocio) {
  const [fecha, hora] = cita.FechaHora.replace('T', ' ').split(' ');
  const parametros = [cita.NombreCliente, f.fechaLarga(fecha), f.hora12(hora), cita.NombreServicio,
    `${cita.DuracionMin} min`, cita.NombreBarbero];
  const lineas = [
    `Hola ${cita.NombreCliente}, tu cita en *${negocio.NombreEstablecimiento}* quedó confirmada:`,
    '',
    `📅 Fecha: ${parametros[1]}`,
    `🕒 Hora: ${parametros[2]}`,
    `✂️ Servicio: ${cita.NombreServicio} (${cita.DuracionMin} min)`,
    `💈 Barbero: ${cita.NombreBarbero}`
  ];
  if (negocio.Direccion) lineas.push(`📍 ${negocio.Direccion}`);
  lineas.push('', '¡Te esperamos!');
  return { texto: lineas.join('\n'), parametros };
}

/**
 * Ticket de venta en texto.
 * @param {Object} venta  Venta completa (ver rutas/ventas.js → obtenerVenta)
 * @param {Object} negocio
 */
function ticket(venta, negocio) {
  const [fecha, hora] = venta.FechaHoraCobro.split(' ');
  const l = [
    `*${negocio.NombreEstablecimiento}*`,
    `Ticket ${venta.NumeroFactura}`,
    `${f.fechaCorta(fecha)} · ${f.hora12(hora)}`,
    `Cliente: ${venta.NombreCliente}`,
    '------------------------------'
  ];
  for (const d of venta.Detalle) {
    l.push(`${d.Cantidad > 1 ? d.Cantidad + ' x ' : ''}${d.NombreItem}  ${dinero(d.PrecioUnitario * d.Cantidad)}`);
    if (d.NombreBarbero) l.push(`   Barbero: ${d.NombreBarbero}`);
    if (d.Descuento > 0) l.push(`   ${d.Beneficio || 'Descuento'}: -${dinero(d.Descuento)} → ${dinero(d.Importe)}`);
    if (d.VenceMembresia) l.push(`   Vence: ${f.fechaCorta(d.VenceMembresia)}`);
  }
  l.push('------------------------------', `Subtotal: ${dinero(venta.Subtotal)}`);
  if (venta.Descuento > 0) l.push(`Descuento: -${dinero(venta.Descuento)}`);
  l.push(`*TOTAL: ${dinero(venta.ImporteTotal)}*`, `Pago: ${venta.MetodoPago}`);
  if (venta.MetodoPago === 'Efectivo' && venta.MontoRecibido != null) {
    l.push(`Recibido: ${dinero(venta.MontoRecibido)} · Cambio: ${dinero(venta.Cambio)}`);
  }
  if (negocio.MensajeTicket) l.push('', negocio.MensajeTicket);
  return l.join('\n');
}

module.exports = { confirmacionCita, ticket, dinero };
