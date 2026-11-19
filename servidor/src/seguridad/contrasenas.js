/**
 * @file seguridad/contrasenas.js
 * @description Cifrado de contraseñas con scrypt (incluido en Node.js).
 *
 * Formato guardado en la columna Contrasena:
 *   scrypt$<N>$<r>$<p>$<sal base64>$<hash base64>
 * Cada contraseña tiene una sal aleatoria distinta, así que dos usuarios con
 * la misma contraseña no tienen el mismo valor guardado.
 */
'use strict';

const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const PARAMETROS = { N: 16384, r: 8, p: 1 };
const LONGITUD = 64;

/**
 * @param {string} contrasena
 * @returns {Promise<string>} Valor para guardar en la base de datos.
 */
async function cifrar(contrasena) {
  const sal = crypto.randomBytes(16);
  const hash = await scrypt(String(contrasena), sal, LONGITUD, PARAMETROS);
  return ['scrypt', PARAMETROS.N, PARAMETROS.r, PARAMETROS.p, sal.toString('base64'), hash.toString('base64')].join('$');
}

/**
 * Compara una contraseña con el valor guardado en tiempo constante.
 * @param {string} contrasena
 * @param {string} guardado
 * @returns {Promise<boolean>}
 */
async function verificar(contrasena, guardado) {
  const partes = String(guardado || '').split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false;
  const [, N, r, p, salB64, hashB64] = partes;
  const esperado = Buffer.from(hashB64, 'base64');
  const obtenido = await scrypt(String(contrasena), Buffer.from(salB64, 'base64'), esperado.length,
    { N: Number(N), r: Number(r), p: Number(p) });
  return crypto.timingSafeEqual(esperado, obtenido);
}

module.exports = { cifrar, verificar };
