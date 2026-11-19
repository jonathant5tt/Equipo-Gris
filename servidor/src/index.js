/**
 * @file index.js
 * @description Arranque del servidor de Engreídos Barbershop.
 *
 *   node src/index.js   (o «npm start», o doble clic en iniciar-servidor.bat)
 *
 * Al iniciar: se conecta a MySQL, crea la base de datos si no existe,
 * desactiva las membresías vencidas (y lo repite cada hora) y muestra las
 * direcciones para abrir el sistema en la computadora y en los teléfonos.
 * No necesita «npm install»: no usa paquetes externos.
 */
'use strict';

const os = require('os');
const config = require('./config');
const db = require('./db');
const app = require('./app');

/** Membresías cuyo vencimiento ya pasó → Inactiva. */
async function vencerMembresias() {
  try {
    const r = await db.consultar(
      "UPDATE CLIENTE SET EstadoMembresia = 'Inactiva' WHERE EstadoMembresia = 'Activa' AND FechaVencimiento < CURDATE()");
    if (r.affectedRows) console.log(`[membresías] ${r.affectedRows} membresía(s) vencida(s) desactivada(s).`);
  } catch (error) {
    console.error('[membresías] No se pudieron revisar los vencimientos:', error.message);
  }
}

/** Direcciones IPv4 de la computadora en la red local. */
function direccionesLocales() {
  return Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
}

/** Explica en palabras simples por qué no se pudo usar MySQL. */
function explicarErrorMysql(error) {
  const { host, port, user } = config.BD;
  switch (error.code) {
    case 'ECONNREFUSED':
    case 'ETIMEDOUT':
    case 'EHOSTUNREACH':
      return `MySQL no está encendido o no escucha en ${host}:${port}.\n` +
        '  · Windows: abre «Servicios» (services.msc) e inicia «MySQL80», o abre MySQL Workbench.\n' +
        '  · Si MySQL usa otro puerto, cámbialo en BD_PUERTO de servidor/.env.';
    case 'ENOTFOUND':
      return `No existe el equipo «${host}». Revisa BD_HOST en servidor/.env (normalmente localhost).`;
    case 'ER_ACCESS_DENIED_ERROR':
      return `MySQL rechazó el usuario «${user}» o la contraseña.\n` +
        '  Escribe la contraseña correcta en BD_CONTRASENA de servidor/.env\n' +
        '  (o ejecuta:  node scripts/configurar.js  para escribir los datos de nuevo).';
    case 'ER_DBACCESS_DENIED_ERROR':
      return `El usuario «${user}» no tiene permiso para crear o usar la base «${config.BD.database}».`;
    default:
      return error.message;
  }
}

async function iniciar() {
  try {
    const estado = await db.instalar();
    if (estado === 'creada') console.log(`✔ Base de datos «${config.BD.database}» creada con todas sus tablas.`);
    if (estado === 'actualizada') {
      console.log(`✔ Base de datos «${config.BD.database}» actualizada a la versión ${config.VERSION}: ${db.cambiosAplicados.join(', ')}.`);
      console.log('  Tus datos (clientes, ventas, membresías) se conservaron.');
    }
    await db.probar();
  } catch (error) {
    console.error('\n✖ No se pudo usar la base de datos MySQL.');
    console.error('  ' + explicarErrorMysql(error) + '\n');
    // 2 = datos de acceso incorrectos: iniciar-servidor.bat abre el asistente.
    process.exitCode = error.code === 'ER_ACCESS_DENIED_ERROR' ? 2 : 1;
    await db.cerrar().catch(() => {});
    return;
  }

  const dueno = await db.uno('SELECT COUNT(*) AS n FROM ADMINISTRADOR WHERE Activo = 1');
  const sinDueno = !Number(dueno.n);

  await vencerMembresias();
  setInterval(vencerMembresias, 60 * 60 * 1000).unref();

  const servidor = app.listen(config.PUERTO, '0.0.0.0', () => {
    console.log('\n✔ Engreídos Barbershop está funcionando');
    console.log(`  En esta computadora:  http://localhost:${config.PUERTO}`);
    for (const ip of direccionesLocales()) {
      console.log(`  Desde el teléfono o la app (misma red Wi-Fi):  http://${ip}:${config.PUERTO}`);
    }
    if (sinDueno) console.log('\n  ➜ Primera vez: abre la dirección de arriba y crea la cuenta del Dueño.');
    console.log('\n  No cierres esta ventana mientras uses el sistema (Ctrl + C para detenerlo).\n');
  });
  servidor.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`\n✖ El puerto ${config.PUERTO} ya está en uso: probablemente el servidor ya está abierto en otra ventana.`);
      console.error('  Ciérrala, o cambia PUERTO en servidor/.env.\n');
    } else {
      console.error('\n✖ No se pudo abrir el servidor:', error.message, '\n');
    }
    process.exit(1);
  });
}

iniciar();
