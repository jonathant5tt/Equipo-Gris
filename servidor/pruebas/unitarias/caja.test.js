/**
 * Pruebas unitarias · servicios/caja.js
 * Componente crítico del CU-06 «Realizar cierre de caja»: totales del turno,
 * efectivo esperado y arqueo de billetes y monedas.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { totales, leerArqueo, agrupar } = require('../../src/servicios/caja');

/** Turno de ejemplo: 3 ventas (una con membresía) y un reembolso en efectivo. */
const turno = () => ({
  ventas: [
    { ID_Venta: 1, FechaHoraCobro: '2026-11-19 10:05:00', Subtotal: 200, Descuento: 0, ImporteTotal: 200, MetodoPago: 'Efectivo', CobradoPor: 'Ana (Cajero)' },
    { ID_Venta: 2, FechaHoraCobro: '2026-11-19 11:40:00', Subtotal: 345, Descuento: 209, ImporteTotal: 136, MetodoPago: 'Tarjeta', CobradoPor: 'Ana (Cajero)' },
    { ID_Venta: 3, FechaHoraCobro: '2026-11-19 09:15:00', Subtotal: 100, Descuento: 0, ImporteTotal: 100, MetodoPago: 'Transferencia', CobradoPor: 'Dueño (Dueño)' }
  ],
  detalle: [
    { ID_Venta: 1, TipoItem: 'Servicio', NombreItem: 'Corte', Cantidad: 1, Importe: 150, NombreBarbero: 'Luis' },
    { ID_Venta: 1, TipoItem: 'Producto', NombreItem: 'Agua natural', Cantidad: 2, Importe: 50, NombreBarbero: null },
    { ID_Venta: 2, TipoItem: 'Servicio', NombreItem: 'Corte', Cantidad: 1, Importe: 0, NombreBarbero: 'Luis' },
    { ID_Venta: 2, TipoItem: 'Producto', NombreItem: 'Agua natural', Cantidad: 3, Importe: 40, NombreBarbero: null },
    { ID_Venta: 2, TipoItem: 'Producto', NombreItem: 'Cera mate', Cantidad: 1, Importe: 96, NombreBarbero: null },
    { ID_Venta: 3, TipoItem: 'Servicio', NombreItem: 'Barba', Cantidad: 1, Importe: 100, NombreBarbero: 'Pedro' }
  ],
  reembolsos: [{ ID_Reembolso: 1, Fecha: '2026-11-19 12:00:00', Monto: 50, MetodoDevolucion: 'Efectivo' }]
});

describe('Cierre de caja (servicios/caja.js)', () => {
  it('PU-CAJ-01 Totales del turno: ingresos, reembolsos e ingreso neto', () => {
    const t = totales(turno(), 500);
    assert.equal(t.NumeroVentas, 3);
    assert.equal(t.VentasBrutas, 645);
    assert.equal(t.Descuentos, 209);
    assert.equal(t.TotalIngresos, 436);
    assert.equal(t.TotalReembolsos, 50);
    assert.equal(t.IngresoNeto, 386);
    assert.equal(t.TicketPromedio, 145.33);
  });

  it('PU-CAJ-02 Efectivo esperado = fondo + ventas en efectivo − reembolsos en efectivo', () => {
    const t = totales(turno(), 500);
    assert.deepEqual(t.PorMetodo, { Efectivo: 200, Tarjeta: 136, Transferencia: 100 });
    assert.deepEqual(t.Operaciones, { Efectivo: 1, Tarjeta: 1, Transferencia: 1 });
    assert.equal(t.EfectivoEsperado, 650);
  });

  it('PU-CAJ-03 Desglose por tipo, barbero, cajero y producto', () => {
    const t = totales(turno(), 0);
    assert.deepEqual(t.PorTipo.Servicios, { Cantidad: 3, Importe: 250 });
    assert.deepEqual(t.PorTipo.Productos, { Cantidad: 6, Importe: 186 });
    assert.deepEqual(t.PorBarbero, [{ Nombre: 'Luis', Cantidad: 2, Importe: 150 }, { Nombre: 'Pedro', Cantidad: 1, Importe: 100 }]);
    assert.deepEqual(t.PorCajero.map((c) => c.Nombre), ['Ana (Cajero)', 'Dueño (Dueño)']);
    assert.deepEqual(t.ProductosVendidos[0], { Nombre: 'Cera mate', Cantidad: 1, Importe: 96 });
    assert.equal(t.Desde, '2026-11-19 09:15:00', 'el periodo empieza en la operación más antigua');
  });

  it('PU-CAJ-04 Turno vacío: todo en cero sin dividir entre cero', () => {
    const t = totales({ ventas: [], detalle: [], reembolsos: [] }, 300);
    assert.equal(t.TotalIngresos, 0);
    assert.equal(t.TicketPromedio, 0);
    assert.equal(t.EfectivoEsperado, 300);
    assert.equal(t.Desde, null);
  });

  it('PU-CAJ-05 Arqueo: suma billetes y monedas válidos e ignora el resto', () => {
    const r = leerArqueo({ 1000: 1, 500: 2, 0.5: 3, 3: 9, 20: -1, 50: 'x', 100: 1.5 });
    assert.deepEqual(r.arqueo, { 1000: 1, 500: 2, 0.5: 3 });
    assert.equal(r.total, 2001.5);
    assert.deepEqual(leerArqueo(null), { arqueo: null, total: null });
    assert.deepEqual(leerArqueo({ 7: 3 }), { arqueo: null, total: null });
  });

  it('PU-CAJ-06 agrupar: suma por clave y ordena por importe', () => {
    const g = agrupar([{ k: 'A', n: 1 }, { k: 'B', n: 5 }, { k: 'A', n: 2 }, { k: null, n: 9 }], (x) => x.k, () => 1, (x) => x.n);
    assert.deepEqual(g, [{ Nombre: 'B', Cantidad: 1, Importe: 5 }, { Nombre: 'A', Cantidad: 2, Importe: 3 }]);
  });
});
