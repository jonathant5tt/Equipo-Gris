/**
 * Pruebas unitarias · servicios/precios.js (calcularVenta)
 * Componente crítico del CU-05 «Registrar cobro y emitir ticket»: es la única
 * fuente de verdad de los importes (servicios, productos, membresías,
 * beneficios, promociones y existencias).
 *
 * Fecha fija de las pruebas: jueves 19/11/2026.
 * Cliente 7 «Carlos Premier»: membresía Premier vigente hasta el 05/12/2026.
 * Cliente 8 «Diego Nuevo»: sin membresía.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { calcularVenta, inicioPeriodo, membresiaVigente, redondear } = require('../../src/servicios/precios');
const { crearBdMemoria } = require('../apoyo/bd-memoria');
const { fijarReloj } = require('../apoyo/reloj');

const HOY = '2026-11-19';
const CORTE = { TipoItem: 'Servicio', ID_Servicio: 1, ID_Barbero: 1 };
const BARBA = { TipoItem: 'Servicio', ID_Servicio: 2, ID_Barbero: 1 };
const agua = (n) => ({ TipoItem: 'Producto', ID_Producto: 10, Cantidad: n });
const cera = (n) => ({ TipoItem: 'Producto', ID_Producto: 11, Cantidad: n });
const PREMIER = { TipoItem: 'Membresía', ID_Membresia: 3 };

/** Registra en la base una venta anterior que usó un beneficio. */
function ventaAnterior(t, { fecha, idCliente, idBeneficio, idServicio, cantidad = 1 }) {
  const idVenta = t.VENTA.length + 1;
  t.VENTA.push({ ID_Venta: idVenta, ID_Cliente: idCliente, FechaHoraCobro: `${fecha} 12:00:00` });
  t.DETALLE_VENTA.push({ ID_Detalle: t.DETALLE_VENTA.length + 1, ID_Venta: idVenta, ID_Beneficio: idBeneficio,
    ID_Servicio: idServicio, Cantidad: cantidad, UsaBeneficio: 1 });
}

const rechaza = (estado, mensaje) => (e) => e.estado === estado && (!mensaje || mensaje.test(e.message));

describe('Cálculo de la venta en caja (servicios/precios.js)', () => {
  it('PU-PRE-01 Happy Path «Cliente 0»: servicio + productos sin descuentos', async (t) => {
    fijarReloj(t, HOY);
    const r = await calcularVenta(crearBdMemoria(), { ID_Cliente: null, Detalle: [CORTE, agua(2)] });
    assert.equal(r.Subtotal, 200);
    assert.equal(r.Descuento, 0);
    assert.equal(r.Total, 200);
    assert.equal(r.Membresia, null);
    assert.deepEqual(r.Lineas.map((l) => [l.NombreItem, l.Cantidad, l.Importe]), [['Corte', 1, 150], ['Agua natural', 2, 50]]);
    assert.equal(r.Lineas[0].NombreBarbero, 'Luis Barbero');
  });

  it('PU-PRE-02 Membresía vigente: corte gratis, 1 bebida gratis y 20 % en el resto de productos', async (t) => {
    fijarReloj(t, HOY);
    const r = await calcularVenta(crearBdMemoria(), { ID_Cliente: 7, Detalle: [CORTE, agua(3), cera(1)] });
    const resumen = r.Lineas.map((l) => [l.NombreItem, l.Cantidad, l.Descuento, l.Importe]);
    assert.deepEqual(resumen, [
      ['Corte', 1, 150, 0],
      ['Agua natural', 1, 25, 0],      // 1 bebida por visita: gratis
      ['Agua natural', 2, 10, 40],     // las otras 2 con 20 %
      ['Cera mate', 1, 24, 96]         // 20 % en productos
    ]);
    assert.equal(r.Subtotal, 345);
    assert.equal(r.Descuento, 209);
    assert.equal(r.Total, 136);
    assert.equal(r.Membresia.Origen, 'Vigente');
    assert.match(r.Lineas[0].Beneficio, /Premier · Cortes ilimitados: gratis \(1 de 1 por visita\)/);
  });

  it('PU-PRE-03 Límite por visita: el segundo corte del día se cobra completo y se explica', async (t) => {
    fijarReloj(t, HOY);
    const bd = crearBdMemoria((tb) => ventaAnterior(tb, { fecha: HOY, idCliente: 7, idBeneficio: 1, idServicio: 1 }));
    const r = await calcularVenta(bd, { ID_Cliente: 7, Detalle: [CORTE] });
    assert.equal(r.Total, 150);
    assert.equal(r.Lineas[0].UsaBeneficio, false);
    assert.equal(r.Lineas[0].Beneficio, 'Premier · Cortes ilimitados: límite por visita alcanzado (1 de 1)');
  });

  it('PU-PRE-04 Límite mensual: cuenta solo los usos del periodo actual de la membresía', async (t) => {
    fijarReloj(t, HOY);
    // Periodo actual: 05/11/2026 → 04/12/2026. El uso del 01/11 es del periodo anterior.
    const bd = crearBdMemoria((tb) => {
      ventaAnterior(tb, { fecha: '2026-11-01', idCliente: 7, idBeneficio: 4, idServicio: 2 });
      ventaAnterior(tb, { fecha: '2026-11-10', idCliente: 7, idBeneficio: 4, idServicio: 2 });
    });
    const primera = await calcularVenta(bd, { ID_Cliente: 7, Detalle: [BARBA] });
    assert.equal(primera.Total, 0, 'queda 1 de 2 barbas del mes');
    assert.match(primera.Lineas[0].Beneficio, /uso 2 de 2 del mes/);

    const bd2 = crearBdMemoria((tb) => {
      ventaAnterior(tb, { fecha: '2026-11-06', idCliente: 7, idBeneficio: 4, idServicio: 2 });
      ventaAnterior(tb, { fecha: '2026-11-10', idCliente: 7, idBeneficio: 4, idServicio: 2 });
    });
    const tercera = await calcularVenta(bd2, { ID_Cliente: 7, Detalle: [BARBA] });
    assert.equal(tercera.Total, 100);
    assert.match(tercera.Lineas[0].Beneficio, /límite mensual alcanzado \(2 de 2\)/);
  });

  it('PU-PRE-05 Compra de membresía: vence en un mes y sus beneficios aplican en la misma venta', async (t) => {
    fijarReloj(t, HOY);
    const r = await calcularVenta(crearBdMemoria(), { ID_Cliente: 8, Detalle: [PREMIER, CORTE] });
    assert.equal(r.Membresia.Origen, 'EnEstaVenta');
    assert.equal(r.Membresia.Renovacion, false);
    assert.equal(r.Membresia.VenceNueva, '2026-12-19');
    assert.equal(r.Membresia.InicioNuevo, HOY);
    assert.equal(r.Total, 600, 'el corte sale gratis con la membresía recién comprada');
    assert.equal(r.Membresia.Beneficios.length, 5, 'muestra todos los beneficios del cartel, incluido el de solo texto');
  });

  it('PU-PRE-06 Renovación anticipada: el mes nuevo se suma al vencimiento actual', async (t) => {
    fijarReloj(t, HOY);
    const r = await calcularVenta(crearBdMemoria(), { ID_Cliente: 7, Detalle: [PREMIER] });
    assert.equal(r.Membresia.Renovacion, true);
    assert.equal(r.Membresia.VenceActual, '2026-12-05');
    assert.equal(r.Membresia.VenceNueva, '2027-01-05');
    assert.equal(r.Membresia.InicioNuevo, '2026-10-05');
  });

  it('PU-PRE-07 Promoción mayor que el beneficio: se aplica la promoción', async (t) => {
    fijarReloj(t, HOY);
    const bd = crearBdMemoria((tb) => tb.DESCUENTO.push({ ID_Descuento: 1, Nombre: 'Buen Fin', Aplica: 'Productos', ID_Servicio: null,
      ID_Producto: null, Categoria: null, ID_Membresia: null, Tipo: 'Porcentaje', Valor: 30, Activo: 1, Eliminado: 0, FechaInicio: null, FechaFin: null }));
    const r = await calcularVenta(bd, { ID_Cliente: 7, Detalle: [cera(1)] });
    assert.equal(r.Lineas[0].Descuento, 36);
    assert.equal(r.Lineas[0].ID_Descuento, 1);
    assert.equal(r.Lineas[0].Beneficio, 'Descuento «Buen Fin»: 30 %');
  });

  it('PU-PRE-08 Redondeo comercial: 15 % de $14.50 descuenta $2.18 (no $2.17)', async (t) => {
    fijarReloj(t, HOY);
    const bd = crearBdMemoria((tb) => tb.DESCUENTO.push({ ID_Descuento: 2, Nombre: 'Gel 15', Aplica: 'Productos', ID_Servicio: null,
      ID_Producto: 12, Categoria: null, ID_Membresia: null, Tipo: 'Porcentaje', Valor: 15, Activo: 1, Eliminado: 0, FechaInicio: null, FechaFin: null }));
    const r = await calcularVenta(bd, { ID_Cliente: null, Detalle: [{ TipoItem: 'Producto', ID_Producto: 12, Cantidad: 1 }] });
    assert.equal(r.Lineas[0].Descuento, 2.18);
    assert.equal(r.Total, 12.32);
    assert.equal(redondear(1.005), 1.01);
  });

  it('PU-PRE-09 Existencias: no se vende más de lo que hay, aunque venga en dos renglones', async (t) => {
    fijarReloj(t, HOY);
    await assert.rejects(calcularVenta(crearBdMemoria(), { Detalle: [cera(3)] }), rechaza(409, /Sin existencias suficientes de «Cera mate» \(quedan 2\)/));
    await assert.rejects(calcularVenta(crearBdMemoria(), { Detalle: [cera(1), cera(2)] }), rechaza(409));
  });

  it('PU-PRE-10 Pedidos inválidos: vacío, demasiados conceptos, tipo desconocido, cantidad 0 o negativa', async (t) => {
    fijarReloj(t, HOY);
    const bd = crearBdMemoria();
    await assert.rejects(calcularVenta(bd, { Detalle: [] }), rechaza(400, /al menos un concepto/));
    await assert.rejects(calcularVenta(bd, { Detalle: Array(51).fill(CORTE) }), rechaza(400, /Demasiados/));
    await assert.rejects(calcularVenta(bd, { Detalle: [{ TipoItem: 'Regalo' }] }), rechaza(400, /tipo no válido/));
    await assert.rejects(calcularVenta(bd, { Detalle: [agua(-1)] }), rechaza(400, /cantidad no válida/));
    await assert.rejects(calcularVenta(bd, { Detalle: [agua(0)] }), rechaza(400, /cantidad no válida/));
  });

  it('PU-PRE-11 Reglas de membresía: no se vende a «Cliente 0» ni dos en la misma venta', async (t) => {
    fijarReloj(t, HOY);
    const bd = crearBdMemoria();
    await assert.rejects(calcularVenta(bd, { ID_Cliente: null, Detalle: [PREMIER] }), rechaza(400, /Cliente 0/));
    await assert.rejects(calcularVenta(bd, { ID_Cliente: 8, Detalle: [PREMIER, PREMIER] }), rechaza(400, /una membresía por venta/));
    await assert.rejects(calcularVenta(bd, { ID_Cliente: 99, Detalle: [CORTE] }), rechaza(404));
  });

  it('PU-PRE-12 Cobro de cita atendida: toma servicio y barbero de la cita y valida su estado', async (t) => {
    fijarReloj(t, HOY);
    const bd = crearBdMemoria((tb) => {
      tb.CITA.push({ ID_Cita: 1, ID_Cliente: 8, ID_Servicio: 2, ID_Barbero: 1, Estado: 'Atendida', ID_Venta: null, FechaHora: `${HOY} 10:00:00` });
      tb.CITA.push({ ID_Cita: 2, ID_Cliente: 8, ID_Servicio: 1, ID_Barbero: 1, Estado: 'Agendada', ID_Venta: null, FechaHora: `${HOY} 11:00:00` });
      tb.CITA.push({ ID_Cita: 3, ID_Cliente: 8, ID_Servicio: 1, ID_Barbero: 1, Estado: 'Atendida', ID_Venta: 50, FechaHora: `${HOY} 09:00:00` });
    });
    const r = await calcularVenta(bd, { ID_Cliente: 8, Detalle: [{ TipoItem: 'Servicio', ID_Cita: 1 }] });
    assert.equal(r.Lineas[0].NombreItem, 'Barba');
    assert.equal(r.Lineas[0].Pendiente, true);
    assert.equal(r.Total, 100);
    await assert.rejects(calcularVenta(bd, { ID_Cliente: 8, Detalle: [{ TipoItem: 'Servicio', ID_Cita: 2 }] }), rechaza(409, /atendidas/));
    await assert.rejects(calcularVenta(bd, { ID_Cliente: 8, Detalle: [{ TipoItem: 'Servicio', ID_Cita: 3 }] }), rechaza(409, /ya fue cobrada/));
    await assert.rejects(calcularVenta(bd, { ID_Cliente: 7, Detalle: [{ TipoItem: 'Servicio', ID_Cita: 1 }] }), rechaza(400, /no corresponde/));
  });

  it('PU-PRE-13 Periodo mensual y vigencia de la membresía', () => {
    assert.equal(inicioPeriodo('2026-12-05', '2026-11-19'), '2026-11-05');
    assert.equal(inicioPeriodo('2026-12-05', '2026-11-04'), '2026-10-05');
    assert.equal(inicioPeriodo('2026-11-19', '2026-11-19'), '2026-11-19');
    assert.equal(membresiaVigente({ EstadoMembresia: 'Activa', FechaVencimiento: '2026-11-19' }, '2026-11-19'), true);
    assert.equal(membresiaVigente({ EstadoMembresia: 'Activa', FechaVencimiento: '2026-11-18' }, '2026-11-19'), false);
    assert.equal(membresiaVigente({ EstadoMembresia: 'Inactiva', FechaVencimiento: '2027-01-01' }, '2026-11-19'), false);
    assert.equal(membresiaVigente(null, '2026-11-19'), false);
  });
});
