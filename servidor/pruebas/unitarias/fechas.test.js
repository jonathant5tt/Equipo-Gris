/**
 * Pruebas unitarias · servicios/fechas.js
 * Componente crítico: vencimiento de membresías (CU-05) y agenda (CU-01, CU-16).
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const f = require('../../src/servicios/fechas');

describe('Fechas del negocio (servicios/fechas.js)', () => {
  it('PU-FEC-01 sumarMeses: respeta el fin de mes (31 ene + 1 mes = 28 feb)', () => {
    assert.equal(f.sumarMeses('2026-01-31', 1), '2026-02-28');
    assert.equal(f.sumarMeses('2028-01-31', 1), '2028-02-29');
    assert.equal(f.sumarMeses('2026-03-31', 1), '2026-04-30');
  });

  it('PU-FEC-02 sumarMeses: cruza de año y admite meses negativos', () => {
    assert.equal(f.sumarMeses('2026-12-05', 1), '2027-01-05');
    assert.equal(f.sumarMeses('2026-11-19', 12), '2027-11-19');
    assert.equal(f.sumarMeses('2026-12-05', -1), '2026-11-05');
    assert.equal(f.sumarMeses('2027-01-15', -1), '2026-12-15');
  });

  it('PU-FEC-03 sumarDias: cruza meses y años', () => {
    assert.equal(f.sumarDias('2026-11-30', 1), '2026-12-01');
    assert.equal(f.sumarDias('2026-12-31', 1), '2027-01-01');
    assert.equal(f.sumarDias('2026-03-01', -1), '2026-02-28');
  });

  it('PU-FEC-04 letraDia: letra L M X J V S D de cada fecha', () => {
    assert.equal(f.letraDia('2026-11-16'), 'L');
    assert.equal(f.letraDia('2026-11-18'), 'X');
    assert.equal(f.letraDia('2026-11-19'), 'J');
    assert.equal(f.letraDia('2026-11-22'), 'D');
  });

  it('PU-FEC-05 aMinutos / aHora: conversión de ida y vuelta', () => {
    assert.equal(f.aMinutos('18:30:00'), 1110);
    assert.equal(f.aMinutos('00:00'), 0);
    assert.equal(f.aHora(1110), '18:30');
    assert.equal(f.aHora(f.aMinutos('09:05')), '09:05');
  });

  it('PU-FEC-06 formatos para el cliente (ticket y WhatsApp)', () => {
    assert.equal(f.fechaLarga('2026-11-19'), 'jueves 19 de noviembre de 2026');
    assert.equal(f.fechaCorta('2026-11-19'), '19/11/2026');
    assert.equal(f.hora12('00:15'), '12:15 a. m.');
    assert.equal(f.hora12('12:00'), '12:00 p. m.');
    assert.equal(f.hora12('18:30:00'), '6:30 p. m.');
  });

  it('PU-FEC-07 ahora/hoy: formato AAAA-MM-DD y HH:MM:SS', () => {
    const a = f.ahora();
    assert.match(a.fecha, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(a.hora, /^\d{2}:\d{2}:\d{2}$/);
    assert.equal(f.hoy(), f.ahora().fecha);
  });
});
