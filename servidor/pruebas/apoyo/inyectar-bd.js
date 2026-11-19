/**
 * @file pruebas/apoyo/inyectar-bd.js
 * @description Sustituye el módulo «src/db.js» por un puente hacia una base
 * de datos en memoria. Debe llamarse ANTES de requerir rutas, middleware o
 * app.js. Cada archivo de prueba corre en su propio proceso, así que el
 * cambio no afecta a otros archivos.
 */
'use strict';

const Module = require('module');

function inyectarBd() {
  const ruta = require.resolve('../../src/db');
  const puente = {
    actual: null,
    usar(bd) { puente.actual = bd; return bd; },
    consultar: (...a) => puente.actual.consultar(...a),
    uno: (...a) => puente.actual.uno(...a),
    transaccion: (...a) => puente.actual.transaccion(...a)
  };
  const modulo = new Module(ruta);
  modulo.filename = ruta;
  modulo.loaded = true;
  modulo.exports = puente;
  require.cache[ruta] = modulo;
  return puente;
}

module.exports = { inyectarBd };
