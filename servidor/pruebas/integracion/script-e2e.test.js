/**
 * Prueba de integración · scripts/probar-happy-path.js
 * Comprueba que el script de punta a punta (el que el equipo corre contra
 * MySQL real para la evidencia) funciona de principio a fin: se ejecuta como
 * proceso aparte contra el servidor levantado con la base en memoria.
 */
'use strict';

const { describe, it, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawn } = require('child_process');
const { inyectarBd } = require('../apoyo/inyectar-bd');
const { crearBdMemoria } = require('../apoyo/bd-memoria');

const puente = inyectarBd();
const fechas = require('../../src/servicios/fechas');
const contrasenas = require('../../src/seguridad/contrasenas');

mock.method(fechas, 'ahora', () => ({ fecha: '2026-11-19', hora: '09:00:00' }));
mock.method(fechas, 'hoy', () => '2026-11-19');
const app = require('../../src/app');

let servidor;

function correrScript(args) {
  return new Promise((resolver) => {
    const hijo = spawn(process.execPath, [path.join(__dirname, '../../scripts/probar-happy-path.js'), ...args]);
    let salida = '';
    hijo.stdout.on('data', (d) => { salida += d; });
    hijo.stderr.on('data', (d) => { salida += d; });
    hijo.on('close', (codigo) => resolver({ codigo, salida }));
  });
}

describe('Script E2E del Happy Path (scripts/probar-happy-path.js)', () => {
  before(async () => {
    const clave = await contrasenas.cifrar('dueno123');
    puente.usar(crearBdMemoria((t) => t.ADMINISTRADOR.push({ ID_Admin: 1, Nombre: 'Dueño', Usuario: 'dueno', Contrasena: clave, Activo: 1 })));
    await new Promise((listo) => { servidor = app.listen(0, '127.0.0.1', listo); });
  });
  after(() => new Promise((listo) => servidor.close(listo)));

  it('E2E-SCR-01 Sin --base-de-pruebas no hace nada y explica el uso', async () => {
    const r = await correrScript(['--usuario', 'dueno', '--contrasena', 'dueno123']);
    assert.equal(r.codigo, 2);
    assert.match(r.salida, /base de datos de pruebas/);
  });

  it('E2E-SCR-02 Recorre los 10 pasos, con corte de caja, y deja limpio el catálogo', async () => {
    const url = `http://127.0.0.1:${servidor.address().port}`;
    const r = await correrScript(['--base-de-pruebas', '--con-cierre', '--url', url, '--usuario', 'dueno', '--contrasena', 'dueno123']);
    assert.equal(r.codigo, 0, r.salida);
    assert.match(r.salida, /Resultado: 10 de 10 pasos correctos/);
    assert.match(r.salida, /Limpieza: 4 de 4 registros/);
    const t = puente.actual.tablas;
    assert.equal(t.VENTA.length, 1);
    assert.equal(t.CIERRE_CAJA.length, 1);
    assert.equal(t.SERVICIO.at(-1).Activo, 0, 'el servicio de prueba quedó dado de baja');
  });
});
