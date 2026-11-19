/**
 * @file servicios/validar.js
 * @description Validación de datos recibidos. Cada función devuelve el valor
 * limpio o lanza ErrorApi 400 con un mensaje claro.
 */
'use strict';

const { ErrorApi } = require('../middleware/errores');

const falla = (mensaje) => { throw new ErrorApi(400, mensaje); };

/**
 * Redondeo comercial a centavos (medio centavo hacia arriba). Math.round(n * 100)
 * falla con valores como 1.005 o 2.175, cuyo producto queda en 100.4999… por la
 * representación binaria; toPrecision(12) elimina ese ruido antes de redondear.
 */
const redondear = (n) => Math.round(Number((n * 100).toPrecision(12))) / 100;
const vacio = (v) => v === undefined || v === null || String(v).trim() === '';

/**
 * Texto con longitud mínima y máxima.
 * @returns {string|null}
 */
function texto(valor, campo, { min = 0, max = 255, obligatorio = false } = {}) {
  if (vacio(valor)) {
    if (obligatorio) falla(`${campo} es obligatorio.`);
    return null;
  }
  const limpio = String(valor).trim().replace(/\s+/g, ' ');
  if (limpio.length < min) falla(`${campo} debe tener al menos ${min} caracteres.`);
  if (limpio.length > max) falla(`${campo} admite como máximo ${max} caracteres.`);
  return limpio;
}

/** Texto largo que conserva saltos de línea. */
function textoLargo(valor, campo, max = 500) {
  if (vacio(valor)) return null;
  const limpio = String(valor).trim();
  if (limpio.length > max) falla(`${campo} admite como máximo ${max} caracteres.`);
  return limpio;
}

/** Número entero dentro de un rango. */
function entero(valor, campo, { min = -Infinity, max = Infinity, obligatorio = true } = {}) {
  if (vacio(valor)) {
    if (obligatorio) falla(`${campo} es obligatorio.`);
    return null;
  }
  const n = Number(valor);
  if (!Number.isInteger(n) || n < min || n > max) falla(`${campo} no es válido.`);
  return n;
}

/** Importe con dos decimales (no negativo por omisión). */
function importe(valor, campo, { min = 0, max = 1e7, obligatorio = true } = {}) {
  if (vacio(valor)) {
    if (obligatorio) falla(`${campo} es obligatorio.`);
    return null;
  }
  const n = Number(valor);
  if (!Number.isFinite(n) || n < min || n > max) falla(`${campo} no es válido.`);
  return redondear(n);
}

/**
 * ¿'AAAA-MM-DD' es un día real del calendario? Date.parse() acepta días como
 * el 31 de abril o el 30 de febrero (los recorre al mes siguiente), por eso
 * se reconstruye la fecha y se compara con el texto original.
 */
function fechaExiste(texto) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(texto))) return false;
  const d = new Date(texto + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === texto;
}

/** Fecha 'AAAA-MM-DD'. */
function fecha(valor, campo, obligatorio = true) {
  if (vacio(valor)) {
    if (obligatorio) falla(`${campo} es obligatoria.`);
    return null;
  }
  const t = String(valor).slice(0, 10);
  if (!fechaExiste(t)) falla(`${campo} no es una fecha válida.`);
  return t;
}

/** Hora 'HH:MM' → 'HH:MM:00'. */
function hora(valor, campo, obligatorio = true) {
  if (vacio(valor)) {
    if (obligatorio) falla(`${campo} es obligatoria.`);
    return null;
  }
  const m = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(String(valor));
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) falla(`${campo} no es una hora válida.`);
  return `${m[1]}:${m[2]}:00`;
}

/** Uno de los valores permitidos. */
function opcion(valor, campo, permitidos) {
  if (!permitidos.includes(valor)) falla(`${campo} no es válido.`);
  return valor;
}

/** Teléfono de 10 dígitos (se quitan espacios y guiones). */
function telefono(valor, campo = 'El teléfono', obligatorio = true) {
  if (vacio(valor)) {
    if (obligatorio) falla(`${campo} es obligatorio.`);
    return null;
  }
  const digitos = String(valor).replace(/\D/g, '');
  if (digitos.length !== 10) falla(`${campo} debe tener 10 dígitos.`);
  return digitos;
}

const LETRAS_DIAS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

/**
 * Días de la semana como texto 'L,M,X' (en orden L→D, sin repetir).
 * Acepta arreglo o texto separado por comas.
 * @returns {string|null} null si viene vacío.
 */
function dias(valor, campo, obligatorio = false) {
  const lista = (Array.isArray(valor) ? valor : String(valor || '').split(','))
    .map((d) => String(d).trim().toUpperCase()).filter(Boolean);
  if (!lista.length) {
    if (obligatorio) falla(`${campo}: marca al menos un día.`);
    return null;
  }
  if (lista.some((d) => !LETRAS_DIAS.includes(d))) falla(`${campo} no es válido.`);
  return LETRAS_DIAS.filter((d) => lista.includes(d)).join(',');
}

/** Usuario para iniciar sesión: letras, números, punto, guion; 3 a 30. */
function usuario(valor) {
  const u = texto(valor, 'El usuario', { min: 3, max: 30, obligatorio: true }).toLowerCase();
  if (!/^[a-zñ0-9._-]+$/.test(u)) falla('El usuario solo puede tener letras, números, punto y guion, sin espacios.');
  return u;
}

/** Contraseña de al menos 3 caracteres. */
function contrasena(valor, campo = 'La contraseña') {
  if (vacio(valor)) falla(`${campo} es obligatoria.`);
  const c = String(valor);
  if (c.length < 3) falla(`${campo} debe tener al menos 3 caracteres.`);
  if (c.length > 100) falla(`${campo} es demasiado larga.`);
  return c;
}

module.exports = { redondear, fechaExiste, texto, textoLargo, entero, importe, fecha, hora, opcion, telefono, dias, usuario, contrasena, LETRAS_DIAS };
