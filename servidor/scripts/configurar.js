/**
 * @file scripts/configurar.js
 * @description Asistente de primera vez: pide los datos de MySQL, prueba la
 * conexión, guarda servidor/.env y crea la base de datos con sus tablas.
 *
 *   node scripts/configurar.js
 *   node scripts/configurar.js --usuario root --contrasena MiClave [--host localhost] [--puerto 3306] [--web 3000]
 *
 * iniciar-servidor.bat lo ejecuta solo si todavía no existe servidor/.env.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const mysql = require('../src/lib/mysql');

const RAIZ = path.resolve(__dirname, '..');
const ENV = path.join(RAIZ, '.env');
const EJEMPLO = path.join(RAIZ, '.env.example');

/** --clave valor → { clave: valor } */
function argumentos() {
  const r = {};
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i += 1) if (a[i].startsWith('--')) { r[a[i].slice(2)] = a[i + 1] === undefined ? '' : a[i + 1]; i += 1; }
  return r;
}

function preguntar(rl, texto, porOmision, oculto) {
  return new Promise((resolver) => {
    const etiqueta = texto + (porOmision !== undefined && porOmision !== '' ? ` [${porOmision}]` : '') + ': ';
    if (oculto) {
      const escribir = rl._writeToOutput;
      rl._writeToOutput = (s) => { if (s.includes(etiqueta)) escribir.call(rl, s); else escribir.call(rl, s.replace(/[^\r\n]/g, '*')); };
      rl.question(etiqueta, (r) => { rl._writeToOutput = escribir; rl.output.write('\n'); resolver(r); });
    } else {
      rl.question(etiqueta, (r) => resolver(r.trim() === '' ? String(porOmision === undefined ? '' : porOmision) : r.trim()));
    }
  });
}

function explicar(error, datos) {
  if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') return `MySQL no responde en ${datos.host}:${datos.port}. ¿Está instalado y encendido (servicio MySQL80)?`;
  if (error.code === 'ER_ACCESS_DENIED_ERROR') return `Usuario o contraseña de MySQL incorrectos para «${datos.user}».`;
  if (error.code === 'ENOTFOUND') return `No existe el equipo «${datos.host}».`;
  return error.message;
}

/** Escribe .env a partir de .env.example con los valores dados. */
function guardarEnv(valores) {
  let texto = fs.existsSync(EJEMPLO) ? fs.readFileSync(EJEMPLO, 'utf8') : '';
  for (const [clave, valor] of Object.entries(valores)) {
    // Valores con espacios, # o comillas se guardan entre comillas.
    let escrito = String(valor);
    if (/[\s#'"]/.test(escrito)) escrito = escrito.includes('"') ? `'${escrito}'` : `"${escrito}"`;
    const linea = `${clave}=${escrito}`;
    const re = new RegExp(`^\\s*${clave}\\s*=.*$`, 'm');
    texto = re.test(texto) ? texto.replace(re, () => linea) : texto.replace(/\s*$/, '\n') + linea + '\n';
  }
  fs.writeFileSync(ENV, texto);
}

async function principal() {
  const a = argumentos();
  const interactivo = a.contrasena === undefined;
  const rl = interactivo ? readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true }) : null;

  console.log('\n=== Engreídos Barbershop · Configuración inicial ===\n');
  if (interactivo) console.log('Escribe los datos de tu MySQL (Enter acepta el valor entre corchetes).\n');

  let datos = null;
  for (let intento = 1; intento <= 5; intento += 1) {
    const prueba = {
      host: a.host || (interactivo ? await preguntar(rl, 'Servidor de MySQL', 'localhost') : 'localhost'),
      port: Number(a.puerto || (interactivo ? await preguntar(rl, 'Puerto de MySQL', '3306') : 3306)),
      user: a.usuario || (interactivo ? await preguntar(rl, 'Usuario de MySQL', 'root') : 'root'),
      password: interactivo ? await preguntar(rl, 'Contraseña de MySQL', '', true) : a.contrasena
    };
    if (!Number.isInteger(prueba.port) || prueba.port < 1 || prueba.port > 65535) {
      console.log('\n✖ El puerto debe ser un número, por ejemplo 3306 o 3307.\n');
      if (!interactivo) break;
      continue;
    }
    try {
      const c = await mysql.conectar(prueba);
      const [[v]] = await c.query('SELECT VERSION() AS version');
      await c.terminar();
      console.log(`\n✔ Conexión correcta con MySQL ${v.version}.`);
      datos = prueba;
      break;
    } catch (error) {
      console.log('\n✖ ' + explicar(error, prueba) + '\n');
      if (!interactivo) break;
    }
  }
  if (!datos) {
    if (rl) rl.close();
    console.log('No se guardó la configuración. Vuelve a intentarlo cuando MySQL esté listo.\n');
    process.exitCode = 1;
    return;
  }

  const puertoWeb = a.web || (interactivo ? await preguntar(rl, 'Puerto del sistema (navegador y app)', '3000') : '3000');
  if (rl) rl.close();

  guardarEnv({
    PUERTO: puertoWeb,
    BD_HOST: datos.host,
    BD_PUERTO: datos.port,
    BD_USUARIO: datos.user,
    BD_CONTRASENA: datos.password,
    JWT_SECRETO: crypto.randomBytes(48).toString('hex')
  });
  console.log('✔ Configuración guardada en servidor/.env');

  // La configuración ya existe: ahora se puede cargar la conexión del sistema.
  const db = require('../src/db');
  try {
    const estado = await db.instalar();
    console.log(estado === 'creada' ? '✔ Base de datos «engreidos» creada con todas sus tablas.' : '✔ La base de datos ya existía; no se modificó.');
  } catch (error) {
    console.log('✖ No se pudo crear la base de datos: ' + error.message);
    process.exitCode = 1;
  } finally {
    await db.cerrar();
  }
  console.log('\nListo. Inicia el sistema con iniciar-servidor.bat (o «npm start»).\n');
}

principal().catch((e) => { console.error('✖', e.message); process.exitCode = 1; });
