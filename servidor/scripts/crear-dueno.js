/**
 * @file scripts/crear-dueno.js
 * @description Crea (o restablece) la cuenta del Dueño.
 *
 *   npm run crear-dueno
 *   npm run crear-dueno -- <usuario> <contraseña> "<Nombre completo>"
 *
 * Si el usuario ya existe como Dueño, solo cambia su contraseña (útil si se
 * olvidó). Las cuentas de cajeros y barberos se crean después desde la app:
 * Ajustes → Cuentas.
 */
'use strict';

const readline = require('readline/promises');
const db = require('../src/db');
const v = require('../src/servicios/validar');
const contrasenas = require('../src/seguridad/contrasenas');

async function preguntar() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const usuario = await rl.question('Usuario para iniciar sesión (ej. dueno): ');
  const nombre = await rl.question('Nombre completo: ');
  const clave = await rl.question('Contraseña: ');
  rl.close();
  return [usuario, clave, nombre];
}

async function principal() {
  const [usuarioTexto, claveTexto, nombreTexto] = process.argv.length >= 4 ? process.argv.slice(2) : await preguntar();
  try {
    const usuario = v.usuario(usuarioTexto);
    const clave = v.contrasena(claveTexto);
    const cifrada = await contrasenas.cifrar(clave);

    const existente = await db.uno('SELECT ID_Admin FROM ADMINISTRADOR WHERE Usuario = ?', [usuario]);
    if (existente) {
      await db.consultar('UPDATE ADMINISTRADOR SET Contrasena = ?, Activo = 1 WHERE ID_Admin = ?', [cifrada, existente.ID_Admin]);
      console.log(`✔ Se cambió la contraseña del Dueño «${usuario}».`);
    } else {
      for (const tabla of ['CAJERO', 'BARBERO']) {
        if (await db.uno(`SELECT 1 FROM ${tabla} WHERE Usuario = ?`, [usuario])) throw new Error(`El usuario «${usuario}» ya pertenece a otra cuenta.`);
      }
      const nombre = v.texto(nombreTexto || 'Dueño', 'El nombre', { min: 3, max: 100, obligatorio: true });
      await db.consultar('INSERT INTO ADMINISTRADOR (Nombre, Usuario, Contrasena) VALUES (?, ?, ?)', [nombre, usuario, cifrada]);
      console.log(`✔ Cuenta del Dueño creada. Inicia sesión con el usuario «${usuario}».`);
    }
  } catch (error) {
    console.error('✖', error.message);
    process.exitCode = 1;
  } finally {
    await db.cerrar();
  }
}

principal();
