/**
 * Pruebas unitarias · servicios/validar.js
 * Componente crítico: toda la información que llega a la API pasa por estas
 * funciones antes de tocar la base de datos (CU-04, CU-05, CU-06, CU-16).
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const v = require('../../src/servicios/validar');

const error400 = (mensaje) => (e) => e.estado === 400 && (!mensaje || mensaje.test(e.message));

describe('Validación de datos (servicios/validar.js)', () => {
  it('PU-VAL-01 texto: limpia espacios repetidos y respeta longitudes', () => {
    assert.equal(v.texto('  Juan   Pérez  ', 'El nombre', { min: 3, max: 100 }), 'Juan Pérez');
    assert.throws(() => v.texto('Jo', 'El nombre', { min: 3 }), error400(/al menos 3/));
    assert.throws(() => v.texto('x'.repeat(101), 'El nombre', { max: 100 }), error400(/como máximo 100/));
    assert.throws(() => v.texto('   ', 'El nombre', { obligatorio: true }), error400(/obligatorio/));
    assert.equal(v.texto('', 'Opcional'), null);
  });

  it('PU-VAL-02 entero: acepta enteros dentro del rango y rechaza el resto', () => {
    assert.equal(v.entero('15', 'El cliente', { min: 1 }), 15);
    assert.throws(() => v.entero('1.5', 'El cliente'), error400());
    assert.throws(() => v.entero('0', 'El cliente', { min: 1 }), error400());
    assert.throws(() => v.entero('abc', 'El cliente'), error400());
    assert.equal(v.entero('', 'Opcional', { obligatorio: false }), null);
  });

  it('PU-VAL-03 importe: redondea a centavos y no admite negativos', () => {
    assert.equal(v.importe('150.456', 'El total'), 150.46);
    assert.equal(v.importe(0, 'El total'), 0);
    assert.throws(() => v.importe(-1, 'El total'), error400());
    assert.throws(() => v.importe('cien', 'El total'), error400());
  });

  it('PU-VAL-04 importe: redondea medio centavo hacia arriba (1.005 → 1.01)', () => {
    assert.equal(v.importe('1.005', 'El total'), 1.01);
    assert.equal(v.importe('5.025', 'El total'), 5.03);
  });

  it('PU-VAL-05 fecha: acepta AAAA-MM-DD válidas, incluido el 29 de febrero bisiesto', () => {
    assert.equal(v.fecha('2026-11-19', 'La fecha'), '2026-11-19');
    assert.equal(v.fecha('2026-11-19T18:30:00', 'La fecha'), '2026-11-19');
    assert.equal(v.fecha('2028-02-29', 'La fecha'), '2028-02-29');
  });

  it('PU-VAL-06 fecha: rechaza días que no existen en el calendario', () => {
    for (const malo of ['2026-02-29', '2026-02-31', '2026-04-31', '2026-11-31', '2026-13-01', '2026-00-10', '19/11/2026']) {
      assert.throws(() => v.fecha(malo, 'La fecha'), error400(/no es una fecha válida/), `debió rechazar ${malo}`);
    }
  });

  it('PU-VAL-07 hora: convierte HH:MM a HH:MM:00 y rechaza horas imposibles', () => {
    assert.equal(v.hora('09:30', 'La hora'), '09:30:00');
    assert.equal(v.hora('23:59:10', 'La hora'), '23:59:00');
    assert.throws(() => v.hora('24:00', 'La hora'), error400());
    assert.throws(() => v.hora('12:60', 'La hora'), error400());
    assert.throws(() => v.hora('9:30', 'La hora'), error400());
  });

  it('PU-VAL-08 teléfono: deja solo 10 dígitos', () => {
    assert.equal(v.telefono('228-111 0007'), '2281110007');
    assert.throws(() => v.telefono('22811100'), error400(/10 dígitos/));
    assert.throws(() => v.telefono(''), error400(/obligatorio/));
    assert.equal(v.telefono('', 'El teléfono', false), null);
  });

  it('PU-VAL-09 días: ordena L→D, quita repetidos y rechaza letras desconocidas', () => {
    assert.equal(v.dias(['s', 'L', 'x', 'L'], 'Los días'), 'L,X,S');
    assert.equal(v.dias('V,J', 'Los días'), 'J,V');
    assert.throws(() => v.dias('L,Q', 'Los días'), error400());
    assert.throws(() => v.dias([], 'Los días', true), error400(/al menos un día/));
  });

  it('PU-VAL-10 usuario y contraseña: formato de inicio de sesión', () => {
    assert.equal(v.usuario('  Caja.Uno '), 'caja.uno');
    assert.throws(() => v.usuario('con espacio'), error400(/sin espacios/));
    assert.throws(() => v.usuario('ab'), error400());
    assert.equal(v.contrasena('abc'), 'abc');
    assert.throws(() => v.contrasena('ab'), error400(/al menos 3/));
    assert.throws(() => v.contrasena('x'.repeat(101)), error400(/demasiado larga/));
  });

  it('PU-VAL-11 opción: solo valores permitidos (método de pago)', () => {
    assert.equal(v.opcion('Efectivo', 'El método', ['Efectivo', 'Tarjeta']), 'Efectivo');
    assert.throws(() => v.opcion('Cheque', 'El método', ['Efectivo', 'Tarjeta']), error400());
  });
});
