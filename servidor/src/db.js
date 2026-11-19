/**
 * @file db.js
 * @description Conexión a MySQL con un pool de conexiones (lib/mysql.js).
 *
 * - Las fechas llegan como texto ('2026-11-05', '2026-11-05 18:30:00') para
 *   evitar conversiones de zona horaria; las columnas DECIMAL llegan como número.
 * - Cada conexión fija su zona horaria para que NOW() y CURDATE() coincidan
 *   con la hora del negocio.
 * - db.instalar() crea la base de datos y sus tablas si todavía no existen
 *   (ejecuta base-de-datos/esquema.sql), así no hace falta hacerlo a mano.
 *
 * Todas las consultas usan marcadores «?»: los valores se escapan y así se
 * evita la inyección de SQL.
 */
'use strict';

const fs = require('fs');
const mysql = require('./lib/mysql');
const config = require('./config');

const zona = /^[+-]\d{2}:\d{2}$/.test(config.ZONA_HORARIA_MYSQL) ? config.ZONA_HORARIA_MYSQL : '-06:00';
const opcionesServidor = {
  host: config.BD.host,
  port: config.BD.port,
  user: config.BD.user,
  password: config.BD.password,
  alConectar: ['SET NAMES utf8mb4', `SET time_zone = '${zona}'`]
};

const pool = mysql.crearPool({ ...opcionesServidor, database: config.BD.database, limite: 10 });

/**
 * Crea un objeto con los mismos métodos de consulta, sea sobre el pool o
 * sobre una conexión dentro de una transacción.
 * @param {{query: Function}} origen
 */
function ayudantes(origen) {
  return {
    /** @returns {Promise<Array<Object>|Object>} Filas (SELECT) o resultado (INSERT/UPDATE). */
    async consultar(sql, parametros) {
      const [resultado] = await origen.query(sql, parametros);
      return resultado;
    },
    /** @returns {Promise<Object|null>} Primera fila o null. */
    async uno(sql, parametros) {
      const [filas] = await origen.query(sql, parametros);
      return filas[0] || null;
    }
  };
}

const db = ayudantes(pool);

/**
 * Ejecuta varias operaciones como una sola transacción: si algo falla se
 * deshacen todas.
 * @template T
 * @param {(tx: {consultar: Function, uno: Function}) => Promise<T>} trabajo
 * @returns {Promise<T>}
 */
db.transaccion = async function transaccion(trabajo) {
  const conexion = await pool.getConnection();
  try {
    await conexion.beginTransaction();
    const resultado = await trabajo(ayudantes(conexion));
    await conexion.commit();
    return resultado;
  } catch (error) {
    await conexion.rollback().catch(() => {});
    throw error;
  } finally {
    conexion.release();
  }
};

/**
 * Divide un script SQL en sentencias (respeta cadenas y quita comentarios).
 * @param {string} texto
 * @returns {string[]}
 */
function dividirSql(texto) {
  const sentencias = [];
  let actual = '';
  let comilla = null;
  for (let i = 0; i < texto.length; i += 1) {
    const c = texto[i];
    if (comilla) {
      actual += c;
      if (c === '\\') { actual += texto[i + 1] || ''; i += 1; } else if (c === comilla) comilla = null;
      continue;
    }
    if (c === '-' && texto[i + 1] === '-' && /\s/.test(texto[i + 2] || ' ')) { while (i < texto.length && texto[i] !== '\n') i += 1; actual += '\n'; continue; }
    if (c === '#') { while (i < texto.length && texto[i] !== '\n') i += 1; actual += '\n'; continue; }
    if (c === '/' && texto[i + 1] === '*') { const fin = texto.indexOf('*/', i + 2); i = fin < 0 ? texto.length : fin + 1; actual += ' '; continue; }
    if (c === '\'' || c === '"' || c === '`') { comilla = c; actual += c; continue; }
    if (c === ';') { if (actual.trim()) sentencias.push(actual.trim()); actual = ''; continue; }
    actual += c;
  }
  if (actual.trim()) sentencias.push(actual.trim());
  return sentencias;
}

/** Nombre de base de datos seguro para usarlo entre acentos graves. */
function nombreBase() {
  const nombre = config.BD.database;
  if (!/^[A-Za-z0-9_$]+$/.test(nombre)) throw new Error(`BD_NOMBRE «${nombre}» no es válido (usa letras, números y _).`);
  return nombre;
}

/**
 * Crea la base de datos y sus tablas si no existen, o actualiza una base
 * creada con una versión anterior.
 * @returns {Promise<'creada'|'existente'|'actualizada'>}
 *   'actualizada' → db.cambiosAplicados describe lo que se actualizó.
 */
db.instalar = async function instalar() {
  const nombre = nombreBase();
  const conexion = await mysql.conectar(opcionesServidor);
  try {
    await conexion.query(`CREATE DATABASE IF NOT EXISTS \`${nombre}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    await conexion.query(`USE \`${nombre}\``);
    const [[fila]] = await conexion.query(
      "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ? AND LOWER(table_name) IN ('establecimiento','cliente','venta')", [nombre]);
    if (Number(fila.n) > 0) {
      db.cambiosAplicados = await actualizar(conexion, nombre);
      return db.cambiosAplicados.length ? 'actualizada' : 'existente';
    }

    for (const sql of sentenciasEsquema()) {
      if (/^(DROP\s+DATABASE|CREATE\s+DATABASE|USE)\b/i.test(sql)) continue;
      await conexion.query(sql);
    }
    return 'creada';
  } finally {
    await conexion.terminar();
  }
};

/** Sentencias de base-de-datos/esquema.sql. */
function sentenciasEsquema() {
  return dividirSql(fs.readFileSync(config.ESQUEMA_SQL, 'utf8'));
}

/**
 * Actualiza, sin perder datos, una base de datos creada con una versión
 * anterior del sistema. Cada paso revisa antes si hace falta, así que se
 * ejecuta en cada arranque sin cambiar nada cuando ya está al día.
 *
 * v3.2  · PRODUCTO.Categoria (beneficios por categoría, ej. «Bebida»).
 *       · MEMBRESIA_BENEFICIO flexible: servicio, producto, categoría, todos los
 *         productos o texto; usos por visita o por mes; etiqueta y orden.
 *         Los beneficios anteriores se conservan y el «descuento en productos»
 *         de cada plan se convierte en un beneficio «Todos los productos».
 *       · DETALLE_VENTA.ID_Beneficio (cuenta los usos de cada beneficio).
 *
 * @param {Object} conexion  Conexión con la base ya seleccionada (USE).
 * @param {string} nombre    Nombre de la base de datos.
 * @returns {Promise<string[]>} Descripción de los cambios aplicados.
 */
async function actualizar(conexion, nombre) {
  const cambios = [];
  /** Columnas de una tabla en minúsculas (vacío si la tabla no existe). */
  const columnas = async (tabla) => {
    const [filas] = await conexion.query(
      'SELECT COLUMN_NAME AS c FROM information_schema.columns WHERE table_schema = ? AND LOWER(table_name) = LOWER(?)', [nombre, tabla]);
    return new Set(filas.map((f) => String(f.c).toLowerCase()));
  };
  const existe = async (tabla) => (await columnas(tabla)).size > 0;

  // 1) Categoría de productos.
  if (!(await columnas('PRODUCTO')).has('categoria')) {
    await conexion.query('ALTER TABLE PRODUCTO ADD COLUMN Categoria VARCHAR(40) NULL AFTER NombreProducto');
    cambios.push('categoría de productos');
  }

  // 2) Beneficio usado en cada renglón de venta.
  if (!(await columnas('DETALLE_VENTA')).has('id_beneficio')) {
    await conexion.query('ALTER TABLE DETALLE_VENTA ADD COLUMN ID_Beneficio INT NULL AFTER UsaBeneficio, ADD INDEX ix_detalle_beneficio (ID_Beneficio)');
    await conexion.query('ALTER TABLE DETALLE_VENTA MODIFY Beneficio VARCHAR(255) NULL');
    cambios.push('uso de beneficios por renglón');
  }

  // 3) Beneficios de membresía flexibles. Se respalda la tabla anterior
  //    (MEMBRESIA_BENEFICIO_V1), se crea la nueva y se copian los datos.
  //    Si algo se interrumpe, el respaldo sigue ahí y se reanuda al arrancar.
  const respaldo = 'MEMBRESIA_BENEFICIO_V1';
  const hayRespaldo = await existe(respaldo);
  const actuales = await columnas('MEMBRESIA_BENEFICIO');
  if (hayRespaldo || (actuales.size && !actuales.has('aplica'))) {
    if (actuales.size && !actuales.has('aplica')) {
      // La tabla anterior sigue ahí: se (re)copia completa al respaldo antes de quitarla.
      if (!hayRespaldo) {
        await conexion.query(
          `CREATE TABLE ${respaldo} (ID_Beneficio INT NOT NULL PRIMARY KEY, ID_Membresia INT NOT NULL, ID_Servicio INT NOT NULL,
             Tipo VARCHAR(20) NOT NULL, Porcentaje DECIMAL(5,2) NOT NULL, UsosPorMes INT NULL) ENGINE=InnoDB`);
      }
      await conexion.query(`DELETE FROM ${respaldo}`);
      await conexion.query(
        `INSERT INTO ${respaldo} (ID_Beneficio, ID_Membresia, ID_Servicio, Tipo, Porcentaje, UsosPorMes)
         SELECT ID_Beneficio, ID_Membresia, ID_Servicio, Tipo, Porcentaje, UsosPorMes FROM MEMBRESIA_BENEFICIO`);
      await conexion.query('DROP TABLE MEMBRESIA_BENEFICIO');
    }
    if (!(await existe('MEMBRESIA_BENEFICIO'))) {
      const crear = sentenciasEsquema().find((x) => /^CREATE\s+TABLE\s+MEMBRESIA_BENEFICIO\s*\(/i.test(x));
      await conexion.query(crear);
    }
    await conexion.query('DELETE FROM MEMBRESIA_BENEFICIO');
    await conexion.query(
      `INSERT INTO MEMBRESIA_BENEFICIO (ID_Beneficio, ID_Membresia, Aplica, ID_Servicio, Tipo, Porcentaje, Usos, Periodo, Orden)
       SELECT r.ID_Beneficio, r.ID_Membresia, 'Servicio', r.ID_Servicio, r.Tipo, r.Porcentaje, r.UsosPorMes, 'Mes', r.ID_Beneficio
         FROM ${respaldo} r
         JOIN MEMBRESIA m ON m.ID_Membresia = r.ID_Membresia
         JOIN SERVICIO s ON s.ID_Servicio = r.ID_Servicio`);
    if ((await columnas('MEMBRESIA')).has('descuentoproductos')) {
      await conexion.query(
        `INSERT INTO MEMBRESIA_BENEFICIO (ID_Membresia, Aplica, Tipo, Porcentaje, Periodo, Orden)
         SELECT ID_Membresia, 'Productos', 'Descuento', DescuentoProductos, 'Mes', 100000
           FROM MEMBRESIA WHERE DescuentoProductos > 0`);
    }
    await conexion.query(`DROP TABLE ${respaldo}`);
    cambios.push('beneficios de membresía flexibles');
  }

  // 4) El descuento en productos ya es un beneficio: se quita la columna.
  if ((await columnas('MEMBRESIA')).has('descuentoproductos')) {
    try { await conexion.query('ALTER TABLE MEMBRESIA DROP CHECK chk_membresia_productos'); } catch (e) { /* ya no existe */ }
    try {
      await conexion.query('ALTER TABLE MEMBRESIA DROP COLUMN DescuentoProductos');
    } catch (e) {
      // No impide trabajar: el sistema ya no usa esta columna.
      console.warn('  Aviso: no se pudo quitar MEMBRESIA.DescuentoProductos (' + e.message + ').');
    }
  }
  // ---- v3.4: descuentos, reembolsos, cierre completo y bot de WhatsApp ----
  const crearTabla = async (tabla) => {
    if (await existe(tabla)) return false;
    const crear = sentenciasEsquema().find((x) => new RegExp('^CREATE\\s+TABLE\\s+' + tabla + '\\s*\\(', 'i').test(x));
    await conexion.query(crear);
    return true;
  };
  const agregarColumnas = async (tabla, columnas_) => {
    const actuales_ = await columnas(tabla);
    let n = 0;
    for (const [nombreCol, definicion] of columnas_) {
      if (actuales_.has(nombreCol.toLowerCase())) continue;
      await conexion.query(`ALTER TABLE ${tabla} ADD COLUMN ${nombreCol} ${definicion}`);
      n++;
    }
    return n;
  };
  if (await crearTabla('DESCUENTO')) cambios.push('descuentos');
  if (await agregarColumnas('DETALLE_VENTA', [['ID_Descuento', 'INT NULL']])) cambios.push('descuento por renglón');
  let reembolsos = await crearTabla('REEMBOLSO');
  reembolsos = (await crearTabla('REEMBOLSO_DETALLE')) || reembolsos;
  if (reembolsos) cambios.push('reembolsos');
  if (await agregarColumnas('CIERRE_CAJA', [
    ['Desde', 'DATETIME NULL'], ['VentasBrutas', 'DECIMAL(12,2) NOT NULL DEFAULT 0'], ['TotalDescuentos', 'DECIMAL(12,2) NOT NULL DEFAULT 0'],
    ['NumeroReembolsos', 'INT NOT NULL DEFAULT 0'], ['TotalReembolsos', 'DECIMAL(12,2) NOT NULL DEFAULT 0'],
    ['ReembolsosEfectivo', 'DECIMAL(12,2) NOT NULL DEFAULT 0'], ['Arqueo', 'VARCHAR(600) NULL'], ['Observaciones', 'VARCHAR(500) NULL']
  ])) cambios.push('cierre de caja completo');
  if (await agregarColumnas('ESTABLECIMIENTO', [
    ['HorarioAtencion', 'VARCHAR(600) NULL'], ['UbicacionMapa', 'VARCHAR(255) NULL'], ['InfoCitas', 'VARCHAR(300) NULL'],
    ['BotActivo', 'BOOLEAN NOT NULL DEFAULT FALSE'], ['BotBienvenida', 'VARCHAR(500) NULL'],
    ['WhatsAppVerifyToken', 'VARCHAR(80) NULL'], ['WhatsAppAppSecret', 'VARCHAR(80) NULL']
  ])) cambios.push('horario del negocio y bot de WhatsApp');
  if (await crearTabla('WHATSAPP_CHAT')) cambios.push('conversaciones del bot');
  return cambios;
}

db.cambiosAplicados = [];

/** Comprueba la conexión. */
db.probar = () => pool.query('SELECT 1');

/** Cierra el pool (scripts). */
db.cerrar = () => pool.end();

db.dividirSql = dividirSql;

module.exports = db;
