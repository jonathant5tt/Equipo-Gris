/**
 * @file servicios/fotos.js
 * @description Guarda y elimina fotos de clientes en servidor/uploads.
 *
 * El navegador reduce la foto (máx. 1280 px, JPEG) y la envía como «data URL»
 * en base64. Aquí se valida el tipo y el tamaño y se escribe en disco:
 *   uploads/clientes/<ID_Cliente>/<marca de tiempo>.jpg
 * La ruta pública es /uploads/clientes/<ID_Cliente>/<archivo>.
 */
'use strict';

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const { ErrorApi } = require('../middleware/errores');

const TIPOS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAXIMO_BYTES = 8 * 1024 * 1024;

/**
 * @param {number} idCliente
 * @param {string} dataUrl  'data:image/jpeg;base64,...'
 * @returns {Promise<string>} Ruta pública de la foto.
 */
async function guardarFotoCliente(idCliente, dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new ErrorApi(400, 'La foto debe ser una imagen JPG, PNG o WEBP.');
  const datos = Buffer.from(m[2], 'base64');
  if (!datos.length || datos.length > MAXIMO_BYTES) throw new ErrorApi(413, 'La foto es demasiado grande (máximo 8 MB).');

  const carpeta = path.join(config.CARPETA_FOTOS, 'clientes', String(Number(idCliente)));
  await fs.mkdir(carpeta, { recursive: true });
  const archivo = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}.${TIPOS[m[1]]}`;
  await fs.writeFile(path.join(carpeta, archivo), datos);
  return `/uploads/clientes/${Number(idCliente)}/${archivo}`;
}

/** Borra el archivo de una foto a partir de su ruta pública (si existe). */
async function borrarArchivo(url) {
  if (!url || !url.startsWith('/uploads/')) return;
  const ruta = path.join(config.CARPETA_FOTOS, url.slice('/uploads/'.length));
  if (!ruta.startsWith(config.CARPETA_FOTOS)) return;    // evita rutas fuera de uploads
  await fs.unlink(ruta).catch(() => {});
}

module.exports = { guardarFotoCliente, borrarArchivo };
