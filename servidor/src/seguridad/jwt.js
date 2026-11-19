/**
 * @file seguridad/jwt.js
 * @description Tokens de sesión JWT firmados con HMAC-SHA256 (HS256).
 *
 * El token viaja en la cabecera «Authorization: Bearer <token>» y contiene
 * { id, rol, nombre, usuario, exp }. No se guarda nada en el servidor.
 */
'use strict';

const crypto = require('crypto');
const config = require('../config');

const base64url = (datos) => Buffer.from(datos).toString('base64url');

function firmarTexto(texto) {
  return crypto.createHmac('sha256', config.JWT_SECRETO).update(texto).digest('base64url');
}

/**
 * @param {Object} datos  Información pública de la sesión.
 * @returns {string} Token JWT.
 */
function firmar(datos) {
  const encabezado = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const exp = Math.floor(Date.now() / 1000) + config.JWT_HORAS * 3600;
  const cuerpo = base64url(JSON.stringify({ ...datos, exp }));
  return `${encabezado}.${cuerpo}.${firmarTexto(`${encabezado}.${cuerpo}`)}`;
}

/**
 * @param {string} token
 * @returns {Object|null} Datos del token o null si es inválido o venció.
 */
function verificar(token) {
  const partes = String(token || '').split('.');
  if (partes.length !== 3) return null;
  const [encabezado, cuerpo, firma] = partes;
  const esperada = Buffer.from(firmarTexto(`${encabezado}.${cuerpo}`));
  const recibida = Buffer.from(firma);
  if (esperada.length !== recibida.length || !crypto.timingSafeEqual(esperada, recibida)) return null;
  try {
    const datos = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'));
    if (!datos.exp || datos.exp < Date.now() / 1000) return null;
    return datos;
  } catch {
    return null;
  }
}

module.exports = { firmar, verificar };
