/**
 * @file lib/mysql.js
 * @description Cliente de MySQL 8 sin dependencias externas (solo módulos de
 * Node.js). Implementa lo que usa el servidor:
 *
 *   - Protocolo cliente/servidor de MySQL 4.1+ (texto, COM_QUERY).
 *   - Autenticación caching_sha2_password (predeterminada en MySQL 8) y
 *     mysql_native_password, con TLS cuando el servidor lo ofrece o, si no,
 *     intercambio de la contraseña cifrada con la llave pública RSA.
 *   - Marcadores «?» con escape de valores (evita la inyección de SQL).
 *   - Pool de conexiones y transacciones.
 *
 * Conversión de tipos: enteros y DECIMAL → número; DATE/DATETIME/TIME → texto
 * ('2026-11-05', '2026-11-05 18:30:00'); NULL → null.
 */
'use strict';

const net = require('net');
const tls = require('tls');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Constantes del protocolo
// ---------------------------------------------------------------------------
const CAP = {
  LONG_PASSWORD: 0x1, FOUND_ROWS: 0x2, LONG_FLAG: 0x4, CONNECT_WITH_DB: 0x8,
  PROTOCOL_41: 0x200, SSL: 0x800, TRANSACTIONS: 0x2000, SECURE_CONNECTION: 0x8000,
  MULTI_RESULTS: 0x20000, PLUGIN_AUTH: 0x80000, PLUGIN_AUTH_LENENC: 0x200000
};
const UTF8MB4_GENERAL_CI = 45;
const MAX_PAQUETE = 0xffffff;
const SERVER_MORE_RESULTS_EXISTS = 0x0008;

/** Tipos de columna numéricos. */
const TIPOS_NUMERO = new Set([0, 1, 2, 3, 4, 5, 8, 9, 13, 246]);
const TIPO_BIT = 16;

/** Nombres de los errores más comunes (como los de mysql2). */
const CODIGOS = {
  1044: 'ER_DBACCESS_DENIED_ERROR', 1045: 'ER_ACCESS_DENIED_ERROR', 1046: 'ER_NO_DB_ERROR',
  1049: 'ER_BAD_DB_ERROR', 1050: 'ER_TABLE_EXISTS_ERROR', 1054: 'ER_BAD_FIELD_ERROR',
  1062: 'ER_DUP_ENTRY', 1064: 'ER_PARSE_ERROR', 1146: 'ER_NO_SUCH_TABLE', 1205: 'ER_LOCK_WAIT_TIMEOUT',
  1213: 'ER_LOCK_DEADLOCK', 1251: 'ER_NOT_SUPPORTED_AUTH_MODE', 1264: 'ER_WARN_DATA_OUT_OF_RANGE',
  1364: 'ER_NO_DEFAULT_FOR_FIELD', 1406: 'ER_DATA_TOO_LONG', 1451: 'ER_ROW_IS_REFERENCED_2',
  1452: 'ER_NO_REFERENCED_ROW_2', 3819: 'ER_CHECK_CONSTRAINT_VIOLATED'
};

// ---------------------------------------------------------------------------
// Escape de valores
// ---------------------------------------------------------------------------
const ESCAPES = { '\0': '\\0', '\b': '\\b', '\t': '\\t', '\n': '\\n', '\r': '\\r', '\x1a': '\\Z', '"': '\\"', '\'': '\\\'', '\\': '\\\\' };

function dosDigitos(n) { return String(n).padStart(2, '0'); }

/** Convierte un valor de JavaScript a literal SQL. */
function escapar(valor) {
  if (valor === undefined || valor === null) return 'NULL';
  if (typeof valor === 'boolean') return valor ? 'true' : 'false';
  if (typeof valor === 'number') return Number.isFinite(valor) ? String(valor) : 'NULL';
  if (typeof valor === 'bigint') return valor.toString();
  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return 'NULL';
    return '\'' + valor.getFullYear() + '-' + dosDigitos(valor.getMonth() + 1) + '-' + dosDigitos(valor.getDate()) + ' ' +
      dosDigitos(valor.getHours()) + ':' + dosDigitos(valor.getMinutes()) + ':' + dosDigitos(valor.getSeconds()) + '\'';
  }
  if (Buffer.isBuffer(valor)) return 'X\'' + valor.toString('hex') + '\'';
  if (Array.isArray(valor)) {
    if (!valor.length) return 'NULL';
    return valor.map((v) => (Array.isArray(v) ? '(' + v.map(escapar).join(', ') + ')' : escapar(v))).join(', ');
  }
  if (typeof valor === 'object') {
    return Object.keys(valor).map((k) => '`' + k.replace(/`/g, '``') + '` = ' + escapar(valor[k])).join(', ');
  }
  return '\'' + String(valor).replace(/[\0\b\t\n\r\x1a"'\\]/g, (c) => ESCAPES[c]) + '\'';
}

/** Sustituye cada «?» por el siguiente valor escapado (los «?» dentro de cadenas se respetan). */
function formatear(sql, parametros) {
  if (!parametros || !parametros.length) return sql;
  let i = 0;
  let salida = '';
  let comilla = null;
  for (let p = 0; p < sql.length; p += 1) {
    const c = sql[p];
    if (comilla) {
      salida += c;
      if (c === '\\' && comilla !== '`') { salida += sql[p + 1] || ''; p += 1; } else if (c === comilla) comilla = null;
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') { comilla = c; salida += c; continue; }
    if (c === '?') {
      if (i >= parametros.length) throw new Error('Faltan valores para los marcadores «?» de la consulta.');
      salida += escapar(parametros[i]);
      i += 1;
      continue;
    }
    salida += c;
  }
  return salida;
}

// ---------------------------------------------------------------------------
// Lectura y escritura de paquetes
// ---------------------------------------------------------------------------

/** Lector secuencial de un búfer. */
class Lector {
  constructor(buf) { this.buf = buf; this.pos = 0; }
  quedan() { return this.buf.length - this.pos; }
  u8() { return this.buf[this.pos++]; }
  u16() { const v = this.buf.readUInt16LE(this.pos); this.pos += 2; return v; }
  u24() { const v = this.buf.readUIntLE(this.pos, 3); this.pos += 3; return v; }
  u32() { const v = this.buf.readUInt32LE(this.pos); this.pos += 4; return v; }
  saltar(n) { this.pos += n; }
  bytes(n) { const b = this.buf.subarray(this.pos, this.pos + n); this.pos += n; return b; }
  hastaNulo() {
    let fin = this.buf.indexOf(0, this.pos);
    if (fin < 0) fin = this.buf.length;
    const b = this.buf.subarray(this.pos, fin);
    this.pos = Math.min(fin + 1, this.buf.length);
    return b;
  }
  /** Entero de longitud codificada; null si es 0xFB (NULL). */
  lenenc() {
    const p = this.u8();
    if (p < 0xfb) return p;
    if (p === 0xfb) return null;
    if (p === 0xfc) return this.u16();
    if (p === 0xfd) return this.u24();
    const bajo = this.u32();
    const alto = this.u32();
    return alto * 0x100000000 + bajo;
  }
  textoLenenc() {
    const n = this.lenenc();
    return n === null ? null : this.bytes(n).toString('utf8');
  }
  resto() { return this.bytes(this.quedan()); }
}

function lenencBuf(n) {
  if (n < 0xfb) return Buffer.from([n]);
  if (n < 0x10000) { const b = Buffer.alloc(3); b[0] = 0xfc; b.writeUInt16LE(n, 1); return b; }
  if (n < 0x1000000) { const b = Buffer.alloc(4); b[0] = 0xfd; b.writeUIntLE(n, 1, 3); return b; }
  const b = Buffer.alloc(9); b[0] = 0xfe; b.writeUInt32LE(n % 0x100000000, 1); b.writeUInt32LE(Math.floor(n / 0x100000000), 5); return b;
}

function xor(a, b) {
  const r = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i += 1) r[i] = a[i] ^ b[i % b.length];
  return r;
}

const sha1 = (...partes) => { const h = crypto.createHash('sha1'); partes.forEach((p) => h.update(p)); return h.digest(); };
const sha256 = (...partes) => { const h = crypto.createHash('sha256'); partes.forEach((p) => h.update(p)); return h.digest(); };

/** Respuesta de autenticación según el plugin del servidor. */
function respuestaAuth(plugin, clave, semilla) {
  if (!clave) return Buffer.alloc(0);
  const pass = Buffer.from(clave, 'utf8');
  if (plugin === 'mysql_native_password') {
    const h1 = sha1(pass);
    return xor(h1, sha1(semilla, sha1(h1)));
  }
  if (plugin === 'caching_sha2_password') {
    const h1 = sha256(pass);
    return xor(h1, sha256(sha256(h1), semilla));
  }
  if (plugin === 'mysql_clear_password') return Buffer.concat([pass, Buffer.from([0])]);
  const e = new Error(`El método de autenticación «${plugin}» de MySQL no es compatible.`);
  e.code = 'ER_NOT_SUPPORTED_AUTH_MODE';
  throw e;
}

function errorDesdePaquete(paquete, sql) {
  const l = new Lector(paquete);
  l.u8();                                   // 0xFF
  const errno = l.u16();
  let sqlState = '';
  if (l.buf[l.pos] === 0x23) { l.u8(); sqlState = l.bytes(5).toString(); }
  const mensaje = l.resto().toString('utf8');
  const e = new Error(mensaje);
  e.errno = errno;
  e.code = CODIGOS[errno] || 'ER_' + errno;
  e.sqlState = sqlState;
  e.sqlMessage = mensaje;
  if (sql) e.sql = sql.length > 500 ? sql.slice(0, 500) + '…' : sql;
  return e;
}

function errorConexion(mensaje, codigo) {
  const e = new Error(mensaje);
  e.code = codigo;
  return e;
}

// ---------------------------------------------------------------------------
// Conexión
// ---------------------------------------------------------------------------
class Conexion {
  /**
   * @param {{host:string, port:number, user:string, password:string, database?:string,
   *          ssl?: boolean, conectarMs?: number, alConectar?: string[]}} opciones
   */
  constructor(opciones) {
    this.op = opciones;
    this.buffer = Buffer.alloc(0);
    this.esperando = [];        // lectores de paquetes pendientes
    this.paquetes = [];         // paquetes recibidos sin lector
    this.parcial = [];          // partes de un paquete > 16 MB
    this.seq = 0;
    this.cerrada = false;
    this.cola = Promise.resolve();
    this.ultimoUso = Date.now();
  }

  // ---- Socket ---------------------------------------------------------------
  conectar() {
    return new Promise((resolver, rechazar) => {
      const op = this.op;
      const socket = net.connect({ host: op.host, port: op.port });
      socket.setNoDelay(true);
      const temporizador = setTimeout(() => {
        socket.destroy();
        rechazar(errorConexion(`MySQL no respondió en ${op.host}:${op.port}.`, 'ETIMEDOUT'));
      }, op.conectarMs || 10000);
      socket.once('error', (e) => { clearTimeout(temporizador); rechazar(e); });
      socket.once('connect', () => {
        clearTimeout(temporizador);
        this.usarSocket(socket);
        this.autenticar().then(resolver, (e) => { this.destruir(); rechazar(e); });
      });
    });
  }

  usarSocket(socket) {
    if (this.socket) this.socket.removeAllListeners('data');
    this.socket = socket;
    socket.on('data', (d) => this.recibir(d));
    socket.on('error', (e) => this.fallar(e));
    socket.on('close', () => this.fallar(errorConexion('Se perdió la conexión con MySQL.', 'PROTOCOL_CONNECTION_LOST')));
  }

  fallar(error) {
    if (!this.cerrada) this.cerrada = true;
    const pendientes = this.esperando.splice(0);
    pendientes.forEach((p) => p.rechazar(error));
    this.errorFinal = error;
  }

  recibir(datos) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, datos]) : datos;
    while (this.buffer.length >= 4) {
      const largo = this.buffer.readUIntLE(0, 3);
      if (this.buffer.length < 4 + largo) break;
      this.seq = (this.buffer[3] + 1) % 256;
      const carga = this.buffer.subarray(4, 4 + largo);
      this.buffer = this.buffer.subarray(4 + largo);
      if (largo === MAX_PAQUETE) { this.parcial.push(Buffer.from(carga)); continue; }
      let paquete = Buffer.from(carga);
      if (this.parcial.length) { paquete = Buffer.concat([...this.parcial, paquete]); this.parcial = []; }
      const lector = this.esperando.shift();
      if (lector) lector.resolver(paquete); else this.paquetes.push(paquete);
    }
  }

  leer() {
    if (this.paquetes.length) return Promise.resolve(this.paquetes.shift());
    if (this.cerrada) return Promise.reject(this.errorFinal || errorConexion('La conexión con MySQL está cerrada.', 'PROTOCOL_CONNECTION_LOST'));
    return new Promise((resolver, rechazar) => this.esperando.push({ resolver, rechazar }));
  }

  escribir(carga) {
    let pos = 0;
    do {
      const n = Math.min(MAX_PAQUETE, carga.length - pos);
      const cab = Buffer.alloc(4);
      cab.writeUIntLE(n, 0, 3);
      cab[3] = this.seq;
      this.seq = (this.seq + 1) % 256;
      this.socket.write(Buffer.concat([cab, carga.subarray(pos, pos + n)]));
      pos += n;
      if (n === MAX_PAQUETE && pos === carga.length) {      // paquete vacío final
        const fin = Buffer.alloc(4); fin[3] = this.seq; this.seq = (this.seq + 1) % 256; this.socket.write(fin);
      }
    } while (pos < carga.length);
  }

  // ---- Saludo y autenticación ------------------------------------------------
  async autenticar() {
    const op = this.op;
    const saludo = await this.leer();
    if (saludo[0] === 0xff) throw errorDesdePaquete(saludo);
    const l = new Lector(saludo);
    const protocolo = l.u8();
    if (protocolo !== 10) throw errorConexion('El servidor no habla el protocolo de MySQL 4.1+.', 'PROTOCOL_ERROR');
    this.versionServidor = l.hastaNulo().toString();
    this.id = l.u32();
    const semilla1 = l.bytes(8);
    l.saltar(1);
    let capServidor = l.u16();
    let semilla2 = Buffer.alloc(0);
    let plugin = 'mysql_native_password';
    if (l.quedan()) {
      l.saltar(1);                          // charset
      l.saltar(2);                          // estado
      capServidor |= l.u16() << 16;
      const largoAuth = l.u8();
      l.saltar(10);
      if (capServidor & CAP.SECURE_CONNECTION) {
        semilla2 = l.bytes(Math.max(13, largoAuth - 8));
        if (semilla2[semilla2.length - 1] === 0) semilla2 = semilla2.subarray(0, semilla2.length - 1);
      }
      if (capServidor & CAP.PLUGIN_AUTH) plugin = l.hastaNulo().toString() || plugin;
    }
    let semilla = Buffer.concat([semilla1, semilla2]);

    let caps = CAP.LONG_PASSWORD | CAP.FOUND_ROWS | CAP.LONG_FLAG | CAP.PROTOCOL_41 | CAP.TRANSACTIONS |
      CAP.SECURE_CONNECTION | CAP.MULTI_RESULTS | CAP.PLUGIN_AUTH | CAP.PLUGIN_AUTH_LENENC;
    if (op.database) caps |= CAP.CONNECT_WITH_DB;
    caps &= (capServidor | CAP.CONNECT_WITH_DB);
    caps |= CAP.PROTOCOL_41;

    // TLS cuando el servidor lo ofrece (MySQL 8 lo trae activado de fábrica).
    this.tls = false;
    if (op.ssl !== false && (capServidor & CAP.SSL)) {
      caps |= CAP.SSL;
      const peticion = Buffer.alloc(32);
      peticion.writeUInt32LE(caps >>> 0, 0);
      peticion.writeUInt32LE(MAX_PAQUETE, 4);
      peticion[8] = UTF8MB4_GENERAL_CI;
      this.escribir(peticion);
      await this.subirTls();
      this.tls = true;
    }

    let auth = respuestaAuth(plugin, op.password, semilla);
    const partes = [Buffer.alloc(32)];
    partes[0].writeUInt32LE(caps >>> 0, 0);
    partes[0].writeUInt32LE(MAX_PAQUETE, 4);
    partes[0][8] = UTF8MB4_GENERAL_CI;
    partes.push(Buffer.from(op.user || '', 'utf8'), Buffer.from([0]));
    partes.push(lenencBuf(auth.length), auth);
    if (op.database) partes.push(Buffer.from(op.database, 'utf8'), Buffer.from([0]));
    partes.push(Buffer.from(plugin), Buffer.from([0]));
    this.escribir(Buffer.concat(partes));

    for (;;) {
      const p = await this.leer();
      if (p[0] === 0x00) break;                                       // OK
      if (p[0] === 0xff) throw errorDesdePaquete(p);
      if (p[0] === 0xfe) {                                            // cambio de método
        const lc = new Lector(p); lc.u8();
        plugin = lc.hastaNulo().toString();
        semilla = lc.resto();
        if (semilla[semilla.length - 1] === 0) semilla = semilla.subarray(0, semilla.length - 1);
        auth = respuestaAuth(plugin, op.password, semilla);
        this.escribir(auth);
        continue;
      }
      if (p[0] === 0x01 && plugin === 'caching_sha2_password') {
        if (p[1] === 0x03) continue;                                  // autenticación rápida: sigue un OK
        if (p[1] === 0x04) {                                          // autenticación completa
          const clave = Buffer.concat([Buffer.from(op.password || '', 'utf8'), Buffer.from([0])]);
          if (this.tls) { this.escribir(clave); continue; }
          this.escribir(Buffer.from([0x02]));                         // pide la llave pública
          const llave = await this.leer();
          if (llave[0] === 0xff) throw errorDesdePaquete(llave);
          const pem = llave.subarray(1).toString();
          const cifrada = crypto.publicEncrypt({ key: pem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING }, xor(clave, semilla));
          this.escribir(cifrada);
          continue;
        }
        // La llave pública llegó sin pedirla (algunos servidores): se usa igual.
        if (p.length > 2 && p.subarray(1, 11).toString().startsWith('-----BEGIN')) {
          const clave = Buffer.concat([Buffer.from(op.password || '', 'utf8'), Buffer.from([0])]);
          this.escribir(crypto.publicEncrypt({ key: p.subarray(1).toString(), padding: crypto.constants.RSA_PKCS1_OAEP_PADDING }, xor(clave, semilla)));
          continue;
        }
      }
      throw errorConexion('Respuesta inesperada de MySQL durante el inicio de sesión.', 'PROTOCOL_ERROR');
    }
    this.seq = 0;
    for (const sql of this.op.alConectar || []) await this.consultaDirecta(sql);
  }

  subirTls() {
    return new Promise((resolver, rechazar) => {
      const plano = this.socket;
      plano.removeAllListeners('data');
      plano.removeAllListeners('error');
      plano.removeAllListeners('close');
      const seguro = tls.connect({ socket: plano, rejectUnauthorized: false, servername: net.isIP(this.op.host) ? undefined : this.op.host });
      seguro.once('secureConnect', () => { seguro.removeListener('error', rechazar); this.usarSocket(seguro); resolver(); });
      seguro.once('error', rechazar);
    });
  }

  // ---- Consultas ------------------------------------------------------------
  /** Ejecuta las consultas en orden, una a la vez. */
  query(sql, parametros) {
    const tarea = this.cola.then(() => this.consultaDirecta(formatear(sql, parametros)));
    this.cola = tarea.catch(() => {});
    return tarea;
  }

  async consultaDirecta(sql) {
    if (this.cerrada) throw this.errorFinal || errorConexion('La conexión con MySQL está cerrada.', 'PROTOCOL_CONNECTION_LOST');
    this.ultimoUso = Date.now();
    this.seq = 0;
    this.escribir(Buffer.concat([Buffer.from([0x03]), Buffer.from(sql, 'utf8')]));
    let primero = null;
    for (;;) {
      const resultado = await this.leerResultado(sql);
      if (!primero) primero = resultado;
      if (!(resultado.estado & SERVER_MORE_RESULTS_EXISTS)) break;
    }
    return [primero.filas || primero.ok, primero.campos];
  }

  async leerResultado(sql) {
    const p = await this.leer();
    if (p[0] === 0xff) throw errorDesdePaquete(p, sql);
    if (p[0] === 0x00) {
      const l = new Lector(p); l.u8();
      const ok = { affectedRows: l.lenenc() || 0, insertId: l.lenenc() || 0, serverStatus: 0, warningStatus: 0 };
      ok.serverStatus = l.u16(); ok.warningStatus = l.u16();
      ok.changedRows = 0;
      return { ok, estado: ok.serverStatus };
    }
    if (p[0] === 0xfb) throw errorConexion('LOAD DATA LOCAL no está permitido.', 'PROTOCOL_ERROR');
    const columnas = new Lector(p).lenenc();
    const campos = [];
    for (let i = 0; i < columnas; i += 1) {
      const l = new Lector(await this.leer());
      l.textoLenenc(); l.textoLenenc(); l.textoLenenc(); l.textoLenenc();      // catálogo, esquema, tabla, tabla original
      const nombre = l.textoLenenc();
      l.textoLenenc();                                                         // nombre original
      l.lenenc();
      const charset = l.u16(); l.u32();
      const tipo = l.u8();
      campos.push({ name: nombre, columnType: tipo, characterSet: charset });
    }
    let fin = await this.leer();                                              // EOF de las columnas
    if (fin[0] === 0xff) throw errorDesdePaquete(fin, sql);
    const filas = [];
    for (;;) {
      const fila = await this.leer();
      if (fila[0] === 0xfe && fila.length < 9) { fin = fila; break; }
      if (fila[0] === 0xff) throw errorDesdePaquete(fila, sql);
      const l = new Lector(fila);
      const obj = {};
      for (const c of campos) {
        const n = l.lenenc();
        if (n === null) { obj[c.name] = null; continue; }
        const crudo = l.bytes(n);
        if (TIPOS_NUMERO.has(c.columnType)) obj[c.name] = Number(crudo.toString('latin1'));
        else if (c.columnType === TIPO_BIT) obj[c.name] = crudo.length === 1 ? crudo[0] : Buffer.from(crudo);
        else if (c.characterSet === 63 && c.columnType >= 249 && c.columnType <= 252) obj[c.name] = Buffer.from(crudo);
        else obj[c.name] = crudo.toString('utf8');
      }
      filas.push(obj);
    }
    const estado = fin.length >= 5 ? fin.readUInt16LE(3) : 0;
    return { filas, campos, estado };
  }

  beginTransaction() { return this.query('START TRANSACTION'); }
  commit() { return this.query('COMMIT'); }
  rollback() { return this.query('ROLLBACK'); }

  destruir() {
    this.cerrada = true;
    if (this.socket) this.socket.destroy();
  }

  terminar() {
    if (this.cerrada || !this.socket) return Promise.resolve();
    return new Promise((resolver) => {
      try { this.seq = 0; this.escribir(Buffer.from([0x01])); } catch (e) { /* nada */ }
      this.cerrada = true;
      this.socket.end(() => resolver());
      setTimeout(() => { this.socket.destroy(); resolver(); }, 500).unref();
    });
  }
}

// ---------------------------------------------------------------------------
// Pool
// ---------------------------------------------------------------------------
class Pool {
  /**
   * @param {Object} opciones  Las de Conexion + limite (10) e inactividadMs (10 min).
   */
  constructor(opciones) {
    this.op = opciones;
    this.limite = opciones.limite || 10;
    this.libres = [];
    this.total = 0;
    this.espera = [];
    this.cerrado = false;
    this.revision = setInterval(() => this.cerrarInactivas(), 60 * 1000);
    this.revision.unref();
  }

  /** Cierra conexiones inactivas para no chocar con wait_timeout de MySQL. */
  cerrarInactivas() {
    const limite = Date.now() - (this.op.inactividadMs || 10 * 60 * 1000);
    this.libres = this.libres.filter((c) => {
      if (c.cerrada || c.ultimoUso < limite) { this.total -= 1; c.terminar(); return false; }
      return true;
    });
  }

  async obtener() {
    if (this.cerrado) throw errorConexion('El pool de MySQL está cerrado.', 'POOL_CLOSED');
    while (this.libres.length) {
      const c = this.libres.pop();
      if (!c.cerrada) return c;
      this.total -= 1;
    }
    if (this.total < this.limite) {
      this.total += 1;
      const c = new Conexion(this.op);
      try { await c.conectar(); } catch (e) { this.total -= 1; this.despertar(); throw e; }
      return c;
    }
    return new Promise((resolver, rechazar) => this.espera.push({ resolver, rechazar }));
  }

  liberar(c) {
    if (c.cerrada) { this.total -= 1; this.despertar(); return; }
    const siguiente = this.espera.shift();
    if (siguiente) siguiente.resolver(c); else this.libres.push(c);
  }

  /** Si se liberó un lugar, atiende al siguiente en espera creando una conexión. */
  despertar() {
    const siguiente = this.espera.shift();
    if (siguiente) this.obtener().then(siguiente.resolver, siguiente.rechazar);
  }

  /** Consulta con una conexión del pool (reintenta una vez si la conexión estaba cerrada). */
  async query(sql, parametros) {
    for (let intento = 0; ; intento += 1) {
      const c = await this.obtener();
      try {
        const r = await c.query(sql, parametros);
        this.liberar(c);
        return r;
      } catch (e) {
        const perdida = c.cerrada && e.code === 'PROTOCOL_CONNECTION_LOST';
        this.liberar(c);
        if (!(perdida && intento === 0)) throw e;
      }
    }
  }

  /** Conexión exclusiva (transacciones); devolverla con release(). */
  async getConnection() {
    const c = await this.obtener();
    let liberada = false;
    return {
      query: (sql, p) => c.query(sql, p),
      beginTransaction: () => c.beginTransaction(),
      commit: () => c.commit(),
      rollback: () => c.rollback(),
      release: () => { if (!liberada) { liberada = true; this.liberar(c); } }
    };
  }

  async end() {
    this.cerrado = true;
    clearInterval(this.revision);
    const todas = this.libres.splice(0);
    this.espera.splice(0).forEach((w) => w.rechazar(errorConexion('El pool de MySQL está cerrado.', 'POOL_CLOSED')));
    await Promise.all(todas.map((c) => c.terminar()));
  }
}

function crearPool(opciones) { return new Pool(opciones); }

/** Conexión única (scripts de instalación). */
async function conectar(opciones) {
  const c = new Conexion(opciones);
  await c.conectar();
  return c;
}

module.exports = { crearPool, conectar, escapar, formatear };
