/**
 * @file pruebas/apoyo/reloj.js
 * @description Fija la fecha y hora «del negocio» durante una prueba para que
 * los resultados no dependan del día en que se ejecutan.
 */
'use strict';

const fechas = require('../../src/servicios/fechas');

/**
 * @param {import('node:test').TestContext} t
 * @param {string} fecha  'AAAA-MM-DD'
 * @param {string} [hora] 'HH:MM:SS'
 */
function fijarReloj(t, fecha, hora = '09:00:00') {
  t.mock.method(fechas, 'ahora', () => ({ fecha, hora }));
  t.mock.method(fechas, 'hoy', () => fecha);
}

module.exports = { fijarReloj };
