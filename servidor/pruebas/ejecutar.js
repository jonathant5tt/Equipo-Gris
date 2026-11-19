#!/usr/bin/env node
/**
 * @file pruebas/ejecutar.js
 * @description Ejecuta todas las pruebas (*.test.js) con el ejecutor de
 * pruebas incluido en Node.js (node:test). No necesita npm install.
 *
 *   npm test                      Todas las pruebas
 *   npm test -- --cobertura       Además, reporte de cobertura (Node 20+)
 *   npm test -- unitarias         Solo los archivos cuya ruta contiene «unitarias»
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const raiz = __dirname;
const argumentos = process.argv.slice(2);
const cobertura = argumentos.includes('--cobertura');
const filtros = argumentos.filter((a) => !a.startsWith('--'));

function buscar(carpeta) {
  return fs.readdirSync(carpeta, { withFileTypes: true }).flatMap((e) => {
    const ruta = path.join(carpeta, e.name);
    if (e.isDirectory()) return e.name === 'apoyo' ? [] : buscar(ruta);
    return e.name.endsWith('.test.js') ? [ruta] : [];
  });
}

const archivos = buscar(raiz).sort().filter((a) => !filtros.length || filtros.some((f) => a.includes(f)));
if (!archivos.length) {
  console.error('No se encontraron pruebas.');
  process.exit(1);
}

const opciones = ['--test', '--test-reporter=spec'];
if (cobertura) {
  opciones.push('--experimental-test-coverage', '--test-coverage-include=src/**', '--test-coverage-exclude=pruebas/**');
}
const r = spawnSync(process.execPath, [...opciones, ...archivos.map((a) => path.relative(path.join(raiz, '..'), a))], {
  cwd: path.join(raiz, '..'),
  stdio: 'inherit',
  env: { ...process.env, TZ: 'America/Mexico_City' }
});
process.exit(r.status === null ? 1 : r.status);
