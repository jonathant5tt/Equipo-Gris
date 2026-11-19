/**
 * @file app.js
 * @description Aplicación Express: API REST en /api y la interfaz web.
 *
 *   /api/...      API (JSON). Ver docs/API.md.
 *   /uploads/...  Fotos de clientes.
 *   /assets/...   Estilos, scripts e imágenes de la interfaz.
 *   /*.html       Pantallas de la interfaz.
 *
 * Solo se publican esas carpetas: el código del servidor, la base de datos y
 * el archivo .env nunca se sirven al navegador.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const express = require('./lib/web');
const config = require('./config');
const { requiereSesion } = require('./middleware/autenticacion');
const { bloquearSiSuspendido } = require('./middleware/suspension');
const { noEncontrado, manejador } = require('./middleware/errores');

const rutaAuth = require('./rutas/auth');
const rutasEstablecimiento = require('./rutas/establecimiento');
const rutaCuentas = require('./rutas/cuentas');
const rutaClientes = require('./rutas/clientes');
const rutaBarberos = require('./rutas/barberos');
const rutaCitas = require('./rutas/citas');
const rutaCatalogos = require('./rutas/catalogos');
const rutaVentas = require('./rutas/ventas');
const rutaCierres = require('./rutas/cierres');
const rutaAvisos = require('./rutas/avisos');
const rutaDescuentos = require('./rutas/descuentos');
const rutaReembolsos = require('./rutas/reembolsos');
const rutaWhatsapp = require('./rutas/whatsapp');
const cambios = require('./servicios/cambios');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');

// ---- CORS: la app de Android y la vista previa de VS Code llaman a la API ----
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

app.use(express.json({ limit: config.LIMITE_JSON }));

// ---- La API nunca se guarda en caché y avisa de los cambios a las demás pantallas ----
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.on('finish', () => {
      if (res.statusCode < 400 && !/^\/api\/(auth|whatsapp|ventas\/calcular)/.test(req.originalUrl)) cambios.marcar(req.originalUrl);
    });
  }
  next();
});

// ---- API pública ------------------------------------------------------------
app.get('/api/salud', (req, res) => res.json({ estado: 'ok', version: config.VERSION }));
app.use('/api/auth', rutaAuth);
app.use('/api/establecimiento', rutasEstablecimiento.estado);
app.use('/api/whatsapp', rutaWhatsapp);                       // webhook de Meta (bot)

// ---- API con sesión (Cajero y Barbero se bloquean si el servicio está suspendido)
app.use('/api', requiereSesion, bloquearSiSuspendido);
app.get('/api/sincronizar', (req, res) => res.json(cambios.estado()));
app.use('/api/ajustes', rutasEstablecimiento.ajustes);
app.use('/api/cuentas', rutaCuentas);
app.use('/api/clientes', rutaClientes);
app.use('/api/barberos', rutaBarberos);
app.use('/api/citas', rutaCitas);
app.use('/api/ventas', rutaVentas);
app.use('/api/cierres', rutaCierres);
app.use('/api/avisos', rutaAvisos);
app.use('/api/descuentos', rutaDescuentos);
app.use('/api/reembolsos', rutaReembolsos);
app.use('/api', rutaCatalogos);            // /servicios, /productos, /membresias
app.use('/api', noEncontrado);

// ---- Archivos públicos ------------------------------------------------------
fs.mkdirSync(config.CARPETA_FOTOS, { recursive: true });
app.use('/uploads', express.static(config.CARPETA_FOTOS, { maxAge: '7d', dotfiles: 'deny' }));
app.use('/assets', express.static(path.join(config.CARPETA_WEB, 'assets'), { maxAge: '1h', dotfiles: 'deny' }));

/** Envía una pantalla HTML (sin caché, para que las actualizaciones se vean al instante). */
function enviarPantalla(res, archivo) {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(config.CARPETA_WEB, archivo));
}
app.get('/', (req, res) => enviarPantalla(res, 'index.html'));
app.get('/:pantalla', (req, res, next) => {
  const archivo = req.params.pantalla;
  if (!/^[a-z0-9-]+\.html$/.test(archivo) || !fs.existsSync(path.join(config.CARPETA_WEB, archivo))) return next();
  enviarPantalla(res, archivo);
});

app.use((req, res) => res.status(404).type('text').send('No encontrado'));
app.use(manejador);

module.exports = app;
