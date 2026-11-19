/**
 * @file servicios/fechas.js
 * @description Fechas y horas en la zona horaria del negocio.
 * Todas las fechas se manejan como texto: 'AAAA-MM-DD' y 'HH:MM:SS'.
 */
'use strict';

const config = require('../config');

const formatoPartes = new Intl.DateTimeFormat('en-CA', {
  timeZone: config.ZONA_HORARIA, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
});

/** @returns {{fecha: string, hora: string}} Fecha y hora actuales del negocio. */
function ahora() {
  const p = Object.fromEntries(formatoPartes.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}:${p.second}` };
}

/** @returns {string} Fecha de hoy 'AAAA-MM-DD'. */
const hoy = () => ahora().fecha;

/**
 * Suma meses respetando el fin de mes (31 ene + 1 mes = 28/29 feb).
 * @param {string} fechaISO  'AAAA-MM-DD'
 * @param {number} meses
 * @returns {string}
 */
function sumarMeses(fechaISO, meses) {
  const [a, m, d] = fechaISO.split('-').map(Number);
  const total = a * 12 + (m - 1) + meses;
  const anio = Math.floor(total / 12);
  const mes = total % 12;
  const ultimoDia = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
  return `${anio}-${String(mes + 1).padStart(2, '0')}-${String(Math.min(d, ultimoDia)).padStart(2, '0')}`;
}

/** Suma días a una fecha 'AAAA-MM-DD'. */
function sumarDias(fechaISO, dias) {
  const f = new Date(fechaISO + 'T00:00:00Z');
  f.setUTCDate(f.getUTCDate() + dias);
  return f.toISOString().slice(0, 10);
}

/** Letra del día (L M X J V S D) de una fecha. */
function letraDia(fechaISO) {
  return ['D', 'L', 'M', 'X', 'J', 'V', 'S'][new Date(fechaISO + 'T00:00:00Z').getUTCDay()];
}

/** 'HH:MM[:SS]' → minutos desde medianoche. */
function aMinutos(horaTexto) {
  const [h, m] = String(horaTexto).split(':').map(Number);
  return h * 60 + m;
}

/** Minutos → 'HH:MM'. */
function aHora(minutos) {
  return `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** 'AAAA-MM-DD' → 'jueves 5 de noviembre de 2026'. */
function fechaLarga(fechaISO) {
  const f = new Date(fechaISO.slice(0, 10) + 'T00:00:00Z');
  return `${DIAS[f.getUTCDay()]} ${f.getUTCDate()} de ${MESES[f.getUTCMonth()]} de ${f.getUTCFullYear()}`;
}

/** 'AAAA-MM-DD' → '05/11/2026'. */
function fechaCorta(fechaISO) {
  const [a, m, d] = fechaISO.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

/** 'HH:MM[:SS]' → '6:30 p. m.' (formato de 12 horas). */
function hora12(horaTexto) {
  let [h, m] = String(horaTexto).split(':').map(Number);
  const sufijo = h < 12 ? 'a. m.' : 'p. m.';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${sufijo}`;
}

module.exports = { ahora, hoy, sumarMeses, sumarDias, letraDia, aMinutos, aHora, fechaLarga, fechaCorta, hora12 };
