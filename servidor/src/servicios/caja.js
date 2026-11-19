/**
 * @file servicios/caja.js
 * @description Cálculos del cierre de caja (corte) sin acceso a la base de
 * datos: totales del turno, agrupaciones y lectura del arqueo. Se separaron de
 * rutas/cierres.js para poder probarlos con pruebas unitarias.
 */
'use strict';

const { redondear } = require('./precios');

const METODOS = ['Efectivo', 'Tarjeta', 'Transferencia'];
/** Billetes y monedas (pesos) que se pueden contar en el arqueo. */
const DENOMINACIONES = ['1000', '500', '200', '100', '50', '20', '10', '5', '2', '1', '0.5'];

/** Agrupa y suma: [{ Nombre, Cantidad, Importe }] ordenado por importe. */
function agrupar(filas, clave, cantidad, importe) {
  const mapa = new Map();
  for (const x of filas) {
    const k = clave(x);
    if (k == null) continue;
    const g = mapa.get(k) || { Nombre: k, Cantidad: 0, Importe: 0 };
    g.Cantidad += cantidad(x); g.Importe = redondear(g.Importe + importe(x));
    mapa.set(k, g);
  }
  return [...mapa.values()].sort((a, b) => b.Importe - a.Importe || b.Cantidad - a.Cantidad);
}

/** Todos los totales del turno. */
function totales({ ventas, detalle, reembolsos }, fondo) {
  const num = (x) => Number(x || 0);
  const suma = (lista, campo, filtro = () => true) => redondear(lista.filter(filtro).reduce((s, x) => s + num(x[campo]), 0));
  const porMetodo = {}, operacionesMetodo = {}, reembolsosMetodo = {};
  for (const m of METODOS) {
    porMetodo[m] = suma(ventas, 'ImporteTotal', (x) => x.MetodoPago === m);
    operacionesMetodo[m] = ventas.filter((x) => x.MetodoPago === m).length;
    reembolsosMetodo[m] = suma(reembolsos, 'Monto', (x) => x.MetodoDevolucion === m);
  }
  const total = suma(ventas, 'ImporteTotal');
  const totalReembolsos = suma(reembolsos, 'Monto');
  const tipo = (t) => {
    const filas = detalle.filter((d) => d.TipoItem === t);
    return { Cantidad: filas.reduce((s, d) => s + d.Cantidad, 0), Importe: suma(filas, 'Importe') };
  };
  const fechas = [...ventas.map((x) => x.FechaHoraCobro), ...reembolsos.map((x) => x.Fecha)].map(String).sort();
  return {
    NumeroVentas: ventas.length,
    VentasBrutas: suma(ventas, 'Subtotal'),
    Descuentos: suma(ventas, 'Descuento'),
    TotalIngresos: total,
    NumeroReembolsos: reembolsos.length,
    TotalReembolsos: totalReembolsos,
    IngresoNeto: redondear(total - totalReembolsos),
    PorMetodo: porMetodo,
    Operaciones: operacionesMetodo,
    ReembolsosPorMetodo: reembolsosMetodo,
    Servicios: tipo('Servicio').Cantidad,
    Productos: tipo('Producto').Cantidad,
    PorTipo: { Servicios: tipo('Servicio'), Productos: tipo('Producto'), Membresias: tipo('Membresía') },
    PorBarbero: agrupar(detalle.filter((d) => d.TipoItem === 'Servicio'), (d) => d.NombreBarbero || 'Sin barbero', (d) => d.Cantidad, (d) => num(d.Importe)),
    PorCajero: agrupar(ventas, (x) => x.CobradoPor, () => 1, (x) => num(x.ImporteTotal)),
    ProductosVendidos: agrupar(detalle.filter((d) => d.TipoItem === 'Producto'), (d) => d.NombreItem, (d) => d.Cantidad, (d) => num(d.Importe)),
    TicketPromedio: ventas.length ? redondear(total / ventas.length) : 0,
    FondoInicial: fondo,
    EfectivoEsperado: redondear(fondo + porMetodo.Efectivo - reembolsosMetodo.Efectivo),
    Desde: fechas.length ? fechas[0] : null
  };
}

/** Arqueo { "500": 2, "0.5": 4 } → objeto limpio y su total. */
function leerArqueo(valor) {
  if (!valor || typeof valor !== 'object') return { arqueo: null, total: null };
  const limpio = {};
  let total = 0;
  for (const d of DENOMINACIONES) {
    const n = Number(valor[d]);
    if (Number.isInteger(n) && n > 0 && n <= 100000) { limpio[d] = n; total += n * Number(d); }
  }
  return Object.keys(limpio).length ? { arqueo: limpio, total: redondear(total) } : { arqueo: null, total: null };
}

module.exports = { METODOS, DENOMINACIONES, agrupar, totales, leerArqueo };
