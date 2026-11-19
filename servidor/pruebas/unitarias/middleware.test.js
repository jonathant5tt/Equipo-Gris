/**
 * Pruebas unitarias · middleware (autenticación, permisos por rol, suspensión
 * del servicio y manejador de errores).
 * Componente crítico: protege todos los casos de uso y el CU-09
 * «Suspender / reanudar sistema».
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { inyectarBd } = require('../apoyo/inyectar-bd');
const { crearBdMemoria } = require('../apoyo/bd-memoria');

const puente = inyectarBd();
const jwt = require('../../src/seguridad/jwt');
const { requiereSesion, permitir, ROLES } = require('../../src/middleware/autenticacion');
const { bloquearSiSuspendido, reiniciarCache } = require('../../src/middleware/suspension');
const { ErrorApi, manejador } = require('../../src/middleware/errores');

/** Ejecuta un middleware y devuelve lo que pasó (next, error o respuesta). */
function ejecutar(middleware, req) {
  return new Promise((resolver) => {
    const res = {
      codigo: 200,
      status(c) { this.codigo = c; return this; },
      json(cuerpo) { resolver({ tipo: 'respuesta', codigo: this.codigo, cuerpo }); return this; }
    };
    middleware(req, res, (error) => resolver(error ? { tipo: 'error', error } : { tipo: 'siguiente' }));
  });
}
const conToken = (datos) => ({ headers: { authorization: `Bearer ${jwt.firmar(datos)}` } });

describe('Middleware de seguridad y errores', () => {
  beforeEach(() => {
    puente.usar(crearBdMemoria((t) => {
      t.CAJERO.push({ ID_Cajero: 1, Nombre: 'Ana Cajera', Usuario: 'ana', Activo: 1 });
      t.CAJERO.push({ ID_Cajero: 2, Nombre: 'Baja', Usuario: 'baja', Activo: 0 });
    }));
    reiniciarCache();
  });

  it('PU-MID-01 requiereSesion: sin token o con token inválido responde 401', async () => {
    for (const req of [{ headers: {} }, { headers: { authorization: 'Bearer basura' } }, { headers: { authorization: 'Token abc' } }]) {
      const r = await ejecutar(requiereSesion, req);
      assert.equal(r.error.estado, 401);
    }
  });

  it('PU-MID-02 requiereSesion: token válido deja la sesión en req.usuario con el nombre actual', async () => {
    const req = conToken({ id: 1, rol: ROLES.CAJERO, nombre: 'Nombre viejo', usuario: 'ana' });
    const r = await ejecutar(requiereSesion, req);
    assert.equal(r.tipo, 'siguiente');
    assert.deepEqual(req.usuario, { id: 1, rol: 'Cajero', nombre: 'Ana Cajera', usuario: 'ana' });
  });

  it('PU-MID-03 requiereSesion: una cuenta dada de baja pierde la sesión de inmediato', async () => {
    const r = await ejecutar(requiereSesion, conToken({ id: 2, rol: ROLES.CAJERO, nombre: 'Baja', usuario: 'baja' }));
    assert.equal(r.error.estado, 401);
    assert.match(r.error.message, /ya no está activa/);
  });

  it('PU-MID-04 permitir: deja pasar solo a los roles indicados', async () => {
    const soloCaja = permitir(ROLES.DUENO, ROLES.CAJERO);
    assert.equal((await ejecutar(soloCaja, { usuario: { rol: 'Cajero' } })).tipo, 'siguiente');
    assert.equal((await ejecutar(soloCaja, { usuario: { rol: 'Barbero' } })).error.estado, 403);
    assert.equal((await ejecutar(soloCaja, {})).error.estado, 403);
  });

  it('PU-MID-05 suspensión (CU-09): bloquea a cajero y barbero con 503, el Dueño sigue operando', async () => {
    puente.actual.tablas.ESTABLECIMIENTO[0].EstadoServicio = 'Suspendido';
    puente.actual.tablas.ESTABLECIMIENTO[0].MensajeMantenimiento = 'Volvemos a las 4';
    const cajero = await ejecutar(bloquearSiSuspendido, { usuario: { rol: 'Cajero' } });
    assert.equal(cajero.codigo, 503);
    assert.equal(cajero.cuerpo.mensaje, 'Volvemos a las 4');
    assert.equal((await ejecutar(bloquearSiSuspendido, { usuario: { rol: 'Dueño' } })).tipo, 'siguiente');
    reiniciarCache();
    puente.actual.tablas.ESTABLECIMIENTO[0].EstadoServicio = 'Activo';
    assert.equal((await ejecutar(bloquearSiSuspendido, { usuario: { rol: 'Barbero' } })).tipo, 'siguiente');
  });

  it('PU-MID-06 manejador de errores: traduce cada error a un código HTTP y un mensaje claro', async (t) => {
    t.mock.method(console, 'error', () => {});
    const casos = [
      [new ErrorApi(409, 'Esa cita ya fue cobrada.'), 409, 'Esa cita ya fue cobrada.'],
      [Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' }), 409, 'Ya existe un registro con esos datos.'],
      [Object.assign(new Error('fk'), { errno: 1451 }), 409, 'No se puede eliminar porque tiene registros relacionados.'],
      [Object.assign(new Error('grande'), { type: 'entity.too.large' }), 413, 'El archivo es demasiado grande.'],
      [Object.assign(new Error('bd'), { code: 'ECONNREFUSED' }), 503, 'No hay conexión con la base de datos.'],
      [new Error('inesperado'), 500, 'Ocurrió un error en el servidor. Intenta de nuevo.']
    ];
    t.mock.method(console, 'warn', () => {});
    for (const [error, codigo, mensaje] of casos) {
      const r = await new Promise((resolver) => manejador(error, { method: 'GET', originalUrl: '/api/x' }, {
        status(c) { this.c = c; return this; }, json(cuerpo) { resolver({ codigo: this.c, cuerpo }); }
      }));
      assert.equal(r.codigo, codigo);
      assert.equal(r.cuerpo.mensaje, mensaje);
    }
  });
});
