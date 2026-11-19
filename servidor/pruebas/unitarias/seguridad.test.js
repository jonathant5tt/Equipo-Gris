/**
 * Pruebas unitarias · seguridad/contrasenas.js y seguridad/jwt.js
 * Componente crítico: inicio de sesión y control de acceso por rol (todos los
 * casos de uso requieren sesión).
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const contrasenas = require('../../src/seguridad/contrasenas');
const jwt = require('../../src/seguridad/jwt');

describe('Contraseñas con scrypt (seguridad/contrasenas.js)', () => {
  it('PU-SEG-01 cifrar: formato scrypt$N$r$p$sal$hash y sal distinta en cada cifrado', async () => {
    const a = await contrasenas.cifrar('Barberia2026');
    const b = await contrasenas.cifrar('Barberia2026');
    assert.match(a, /^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    assert.notEqual(a, b, 'dos cifrados de la misma contraseña no deben coincidir');
    assert.ok(!a.includes('Barberia2026'), 'nunca se guarda la contraseña en claro');
  });

  it('PU-SEG-02 verificar: acepta la contraseña correcta y rechaza la incorrecta', async () => {
    const guardado = await contrasenas.cifrar('Barberia2026');
    assert.equal(await contrasenas.verificar('Barberia2026', guardado), true);
    assert.equal(await contrasenas.verificar('barberia2026', guardado), false);
    assert.equal(await contrasenas.verificar('', guardado), false);
  });

  it('PU-SEG-03 verificar: un valor guardado dañado nunca abre la sesión ni rompe el servidor', async () => {
    const danados = [
      '',
      null,
      'texto-plano',
      'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$',          // sin hash: no debe aceptar cualquier contraseña
      'scrypt$abc$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA',        // parámetros no numéricos
      'scrypt$3$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAA'   // N no es potencia de 2
    ];
    for (const guardado of danados) {
      assert.equal(await contrasenas.verificar('cualquiera', guardado), false, `debió rechazar «${guardado}»`);
    }
  });
});

describe('Tokens de sesión JWT (seguridad/jwt.js)', () => {
  const sesion = { id: 1, rol: 'Cajero', nombre: 'Ana', usuario: 'ana' };

  it('PU-SEG-04 firmar y verificar: el token conserva los datos de la sesión', () => {
    const token = jwt.firmar(sesion);
    assert.equal(token.split('.').length, 3);
    const datos = jwt.verificar(token);
    assert.equal(datos.rol, 'Cajero');
    assert.equal(datos.usuario, 'ana');
    assert.ok(datos.exp > Date.now() / 1000);
  });

  it('PU-SEG-05 un token alterado (cambio de rol) se rechaza', () => {
    const [enc, , firma] = jwt.firmar(sesion).split('.');
    const falso = Buffer.from(JSON.stringify({ ...sesion, rol: 'Dueño', exp: 9999999999 })).toString('base64url');
    assert.equal(jwt.verificar(`${enc}.${falso}.${firma}`), null);
  });

  it('PU-SEG-06 token vencido, vacío o con formato incorrecto: null', (t) => {
    const token = jwt.firmar(sesion);
    t.mock.method(Date, 'now', () => Date.prototype.valueOf.call(new Date('2099-01-01')));
    assert.equal(jwt.verificar(token), null, 'vencido');
    t.mock.restoreAll();
    for (const malo of [undefined, '', 'abc', 'a.b', 'a.b.c', `${token}x`]) assert.equal(jwt.verificar(malo), null);
  });
});
