/**
 * @file servicios/cambios.js
 * @description Contadores de cambios para que las pantallas abiertas en otros
 * dispositivos (computadora y teléfonos) se actualicen solas.
 *
 * Cada vez que alguien guarda algo, sube el contador de su tema. Las
 * pantallas preguntan cada pocos segundos (GET /api/sincronizar) y, si el
 * número cambió, vuelven a cargar sus datos.
 *
 *   citas     citas, horarios y avisos
 *   ventas    cobros, reembolsos y cortes
 *   catalogo  servicios, productos, membresías, descuentos, cuentas y negocio
 *   clientes  clientes y fotos
 */
'use strict';

const inicio = Date.now();
const contadores = { citas: 0, ventas: 0, catalogo: 0, clientes: 0 };

/** Tema al que pertenece una ruta de la API. */
function temaDe(ruta) {
  if (/^\/api\/(citas|barberos|avisos)/.test(ruta)) return 'citas';
  if (/^\/api\/(ventas|reembolsos|cierres)/.test(ruta)) return 'ventas';
  if (/^\/api\/clientes/.test(ruta)) return 'clientes';
  return 'catalogo';
}

/** Registra un cambio (lo llama app.js después de cada POST/PUT/PATCH/DELETE correcto). */
function marcar(ruta) {
  const tema = temaDe(String(ruta || ''));
  contadores[tema]++;
  // Un cobro también cambia las citas (quedan pagadas) y las existencias.
  if (tema === 'ventas') { contadores.citas++; contadores.catalogo++; }
  if (tema === 'citas') contadores.clientes++;
}

/** Estado actual: { servidor, citas, ventas, catalogo, clientes }. */
const estado = () => ({ servidor: inicio, ...contadores });

module.exports = { marcar, estado, temaDe };
