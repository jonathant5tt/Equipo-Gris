/**
 * @file config.js
 * @description Configuración del servidor leída de «servidor/.env»
 * (ver .env.example). Funciona con Node.js 18 o superior y sin dependencias.
 *
 * Si falta JWT_SECRETO se genera uno y se guarda en .env, para que las
 * sesiones no se cierren cada vez que se reinicia el servidor.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RAIZ_SERVIDOR = path.resolve(__dirname, '..');
const ARCHIVO_ENV = path.join(RAIZ_SERVIDOR, '.env');

/** Lee un archivo .env sencillo: CLAVE=valor (admite comillas y comentarios #). */
function leerEnv(archivo) {
  const valores = {};
  let texto;
  try { texto = fs.readFileSync(archivo, 'utf8'); } catch (e) { return null; }
  for (const linea of texto.replace(/^﻿/, '').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(linea);
    if (!m || linea.trim().startsWith('#')) continue;
    let valor = m[2];
    const comillas = /^(['"])(.*)\1$/.exec(valor);
    if (comillas) valor = comillas[2];
    else valor = valor.replace(/\s+#.*$/, '');
    valores[m[1]] = valor;
  }
  return valores;
}

const archivo = leerEnv(ARCHIVO_ENV);
if (!archivo) console.warn('[config] No se encontró servidor/.env; se usan los valores por omisión.');
// Las variables del sistema tienen prioridad sobre el archivo.
const env = Object.assign({}, archivo || {}, process.env);

/** Zona horaria del negocio: afecta «hoy», horarios de citas y folios. */
const ZONA_HORARIA = env.ZONA_HORARIA || 'America/Mexico_City';
process.env.TZ = ZONA_HORARIA;

let jwtSecreto = env.JWT_SECRETO;
if (!jwtSecreto || jwtSecreto.startsWith('cambia-esta')) {
  jwtSecreto = crypto.randomBytes(48).toString('hex');
  if (archivo) {
    try {
      let texto = fs.readFileSync(ARCHIVO_ENV, 'utf8');
      texto = /^\s*JWT_SECRETO\s*=.*$/m.test(texto)
        ? texto.replace(/^\s*JWT_SECRETO\s*=.*$/m, 'JWT_SECRETO=' + jwtSecreto)
        : texto.replace(/\s*$/, '\n') + 'JWT_SECRETO=' + jwtSecreto + '\n';
      fs.writeFileSync(ARCHIVO_ENV, texto);
    } catch (e) {
      console.warn('[config] No se pudo guardar JWT_SECRETO en .env:', e.message);
    }
  }
}

module.exports = Object.freeze({
  /** Versión del sistema (package.json). */
  VERSION: require('../package.json').version,
  ARCHIVO_ENV,
  PUERTO: Number(env.PUERTO || 3000),

  BD: Object.freeze({
    host: env.BD_HOST || 'localhost',
    port: Number(env.BD_PUERTO || 3306),
    user: env.BD_USUARIO || 'root',
    password: env.BD_CONTRASENA || '',
    database: env.BD_NOMBRE || 'engreidos'
  }),

  ZONA_HORARIA,
  ZONA_HORARIA_MYSQL: env.ZONA_HORARIA_MYSQL || '-06:00',

  JWT_SECRETO: jwtSecreto,
  JWT_HORAS: Number(env.JWT_HORAS || 12),

  WHATSAPP_API_VERSION: env.WHATSAPP_API_VERSION || 'v23.0',
  /** Dirección de la API de Meta (solo cambia en pruebas). */
  WHATSAPP_API_URL: (env.WHATSAPP_API_URL || 'https://graph.facebook.com').replace(/\/+$/, ''),

  /** Carpeta de la interfaz web (la carpeta padre de «servidor»). */
  CARPETA_WEB: path.resolve(RAIZ_SERVIDOR, '..'),
  /** Script de la base de datos (se ejecuta solo si la base no existe). */
  ESQUEMA_SQL: path.resolve(RAIZ_SERVIDOR, '..', 'base-de-datos', 'esquema.sql'),
  /** Carpeta donde se guardan las fotos de clientes. */
  CARPETA_FOTOS: path.join(RAIZ_SERVIDOR, 'uploads'),

  /** Tamaño máximo del cuerpo JSON (las fotos viajan en base64). */
  LIMITE_JSON: '12mb',
  /** Duración de cada bloque de la agenda, en minutos. */
  PASO_AGENDA_MIN: 30
});
