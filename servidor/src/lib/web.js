/**
 * @file lib/web.js
 * @description Mini marco web sobre el módulo «http» de Node.js, sin
 * dependencias externas. Ofrece la misma forma de trabajo que Express 4 para
 * lo que usa el servidor:
 *
 *   const web = require('./lib/web');
 *   const app = web();                       // aplicación
 *   const router = web.Router();             // grupo de rutas
 *   router.get('/:id', (req, res, next) => res.json({ id: req.params.id }));
 *   app.use(web.json({ limit: '12mb' }));    // cuerpo JSON → req.body
 *   app.use('/api/clientes', router);
 *   app.use('/assets', web.static(carpeta, { maxAge: '1h' }));
 *   app.use((error, req, res, next) => …);   // manejador de errores (4 parámetros)
 *   app.listen(3000, '0.0.0.0', () => …);
 *
 * req: method, url, originalUrl, baseUrl, path, query, params, headers, body
 * res: status(), json(), send(), type(), sendStatus(), sendFile() + métodos de http
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json', '.pdf': 'application/pdf'
};

/** '12mb' → 12582912 · '7d' → milisegundos (según la unidad). */
function bytes(texto) {
  if (typeof texto === 'number') return texto;
  const m = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i.exec(String(texto || ''));
  if (!m) return 100 * 1024;
  return Math.round(Number(m[1]) * ({ b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 }[(m[2] || 'b').toLowerCase()]));
}
function milisegundos(texto) {
  if (typeof texto === 'number') return texto;
  const m = /^(\d+)\s*(ms|s|m|h|d)?$/i.exec(String(texto || ''));
  if (!m) return 0;
  return Number(m[1]) * ({ ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 }[(m[2] || 'ms').toLowerCase()]);
}

function escaparRegex(t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/**
 * Convierte '/clientes/:id/fotos' en expresión regular.
 * @param {string} ruta
 * @param {boolean} completa  true: la ruta debe coincidir entera; false: prefijo (use()).
 */
function compilar(ruta, completa) {
  const claves = [];
  const limpia = ruta === '/' ? '' : String(ruta).replace(/\/+$/, '');
  const patron = limpia.split('/').map((seg) => {
    if (seg.startsWith(':')) { claves.push(seg.slice(1)); return '([^/]+?)'; }
    return escaparRegex(seg);
  }).join('/');
  const regex = completa ? new RegExp('^' + patron + '/?$', 'i') : new RegExp('^' + patron + '(?=/|$)', 'i');
  return { regex, claves };
}

function decodificar(texto) {
  try { return decodeURIComponent(texto); } catch (e) { return texto; }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
function Router() {
  const capas = [];

  function router(req, res, salida) { despachar(req, res, salida); }

  function agregar(metodo, ruta, manejadores, completa) {
    if (typeof ruta === 'function' || (ruta && typeof ruta.handle === 'function')) { manejadores.unshift(ruta); ruta = '/'; }
    const planos = manejadores.flat().filter(Boolean);
    planos.forEach((m) => { if (typeof m !== 'function') throw new TypeError('El manejador de la ruta ' + ruta + ' no es una función.'); });
    capas.push({ metodo, ...compilar(ruta, completa), manejadores: planos, uso: !completa });
    return router;
  }

  router.use = (ruta, ...manejadores) => agregar(null, ruta, manejadores, false);
  for (const metodo of ['get', 'post', 'put', 'patch', 'delete', 'options']) {
    router[metodo] = (ruta, ...manejadores) => agregar(metodo.toUpperCase(), ruta, manejadores, true);
  }
  router.handle = router;

  function despachar(req, res, salida) {
    let indice = 0;
    const urlBase = req.url;
    const baseBase = req.baseUrl || '';

    function siguiente(error) {
      req.url = urlBase;
      req.baseUrl = baseBase;
      if (res.writableEnded) return;
      const ruta = (req.url.split('?')[0]) || '/';
      while (indice < capas.length) {
        const capa = capas[indice++];
        if (capa.metodo && capa.metodo !== req.method && !(capa.metodo === 'GET' && req.method === 'HEAD')) continue;
        const m = capa.regex.exec(ruta);
        if (!m) continue;
        const params = {};
        capa.claves.forEach((k, i) => { params[k] = decodificar(m[i + 1]); });
        req.params = Object.assign({}, capa.uso ? req.params : {}, params);
        if (capa.uso && m[0]) {
          const resto = req.url.slice(m[0].length);
          req.url = resto.startsWith('/') ? resto : '/' + resto;
          req.baseUrl = baseBase + m[0];
        }
        req.path = req.url.split('?')[0];
        return ejecutar(capa.manejadores, 0, error);
      }
      salida(error);
    }

    function ejecutar(lista, i, error) {
      if (i >= lista.length) return siguiente(error);
      const fn = lista[i];
      const continuar = (e) => {
        if (e === 'route') return siguiente();
        ejecutar(lista, i + 1, e || undefined);
      };
      const esDeError = fn.length === 4;
      if ((error && !esDeError) || (!error && esDeError)) return continuar(error);
      try {
        if (error) fn(error, req, res, continuar); else fn(req, res, continuar);
      } catch (e) {
        continuar(e);
      }
    }

    siguiente();
  }

  return router;
}

// ---------------------------------------------------------------------------
// Petición y respuesta
// ---------------------------------------------------------------------------
function preparar(req, res) {
  const url = new URL(req.url, 'http://local');
  req.originalUrl = req.url;
  req.baseUrl = '';
  req.path = url.pathname;
  req.query = {};
  for (const [k, v] of url.searchParams) req.query[k] = v;
  req.params = {};
  req.ip = req.socket.remoteAddress;
  req.get = (nombre) => req.headers[String(nombre).toLowerCase()];

  res.status = (codigo) => { res.statusCode = codigo; return res; };
  res.type = (tipo) => {
    const t = TIPOS['.' + String(tipo).replace(/^\./, '')] || (tipo === 'text' ? 'text/plain; charset=utf-8' : tipo);
    res.setHeader('Content-Type', t);
    return res;
  };
  res.set = (nombre, valor) => { res.setHeader(nombre, valor); return res; };
  res.send = (cuerpo) => {
    if (res.writableEnded) return res;
    if (cuerpo === undefined || cuerpo === null) cuerpo = '';
    if (typeof cuerpo === 'object' && !Buffer.isBuffer(cuerpo)) return res.json(cuerpo);
    const datos = Buffer.isBuffer(cuerpo) ? cuerpo : Buffer.from(String(cuerpo), 'utf8');
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', Buffer.isBuffer(cuerpo) ? 'application/octet-stream' : 'text/html; charset=utf-8');
    if (res.statusCode === 204 || res.statusCode === 304) { res.removeHeader('Content-Type'); res.end(); return res; }
    res.setHeader('Content-Length', datos.length);
    res.end(req.method === 'HEAD' ? undefined : datos);
    return res;
  };
  res.json = (objeto) => {
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.send(Buffer.from(JSON.stringify(objeto === undefined ? null : objeto), 'utf8'));
  };
  res.sendStatus = (codigo) => res.status(codigo).type('text').send(http.STATUS_CODES[codigo] || String(codigo));
  res.sendFile = (archivo, alTerminar) => enviarArchivo(req, res, archivo, {}, (error) => {
    if (alTerminar) return alTerminar(error);
    if (error && !res.headersSent) res.status(404).type('text').send('No encontrado');
  });
}

/** Envía un archivo con su tipo, tamaño y fecha (responde 304 si no cambió). */
function enviarArchivo(req, res, archivo, opciones, alTerminar) {
  fs.stat(archivo, (error, info) => {
    if (error || !info.isFile()) return alTerminar(error || new Error('No es un archivo'));
    const modificado = info.mtime.toUTCString();
    res.setHeader('Last-Modified', modificado);
    if (opciones.maxAge !== undefined && !res.getHeader('Cache-Control')) {
      res.setHeader('Cache-Control', 'public, max-age=' + Math.floor(milisegundos(opciones.maxAge) / 1000));
    }
    const desde = req.headers['if-modified-since'];
    if (desde && Math.floor(info.mtimeMs / 1000) <= Math.floor(Date.parse(desde) / 1000)) {
      res.statusCode = 304;
      return res.end();
    }
    res.setHeader('Content-Type', TIPOS[path.extname(archivo).toLowerCase()] || 'application/octet-stream');
    res.setHeader('Content-Length', info.size);
    if (req.method === 'HEAD') return res.end();
    const flujo = fs.createReadStream(archivo);
    flujo.on('error', (e) => { if (!res.headersSent) alTerminar(e); else res.destroy(e); });
    flujo.pipe(res);
  });
}

// ---------------------------------------------------------------------------
// Middleware incluido
// ---------------------------------------------------------------------------

/** Lee el cuerpo JSON (Content-Type: application/json) a req.body. */
function json(opciones) {
  const limite = bytes((opciones && opciones.limit) || '100kb');
  return function cuerpoJson(req, res, next) {
    req.body = req.body || {};
    const tipo = String(req.headers['content-type'] || '');
    if (req.method === 'GET' || req.method === 'HEAD' || !/application\/(.+\+)?json/i.test(tipo)) return next();
    const declarado = Number(req.headers['content-length'] || 0);
    const demasiado = () => { const e = new Error('Cuerpo demasiado grande'); e.type = 'entity.too.large'; e.status = 413; return e; };
    if (declarado > limite) { req.resume(); return next(demasiado()); }
    const partes = [];
    let total = 0;
    let terminado = false;
    req.on('data', (d) => {
      if (terminado) return;
      total += d.length;
      if (total > limite) { terminado = true; req.resume(); next(demasiado()); return; }
      partes.push(d);
    });
    req.on('end', () => {
      if (terminado) return;
      terminado = true;
      const texto = Buffer.concat(partes).toString('utf8');
      req.rawBody = texto;                 // cuerpo original (firma de webhooks)
      if (!texto.trim()) { req.body = {}; return next(); }
      try { req.body = JSON.parse(texto); } catch (e) {
        const error = new Error('JSON no válido'); error.type = 'entity.parse.failed'; error.status = 400;
        return next(error);
      }
      next();
    });
    req.on('error', (e) => { if (!terminado) { terminado = true; next(e); } });
  };
}

/** Sirve los archivos de una carpeta (sin listar directorios ni archivos ocultos). */
function estatico(carpeta, opciones) {
  const raiz = path.resolve(carpeta);
  const op = opciones || {};
  return function archivosEstaticos(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const relativa = decodificar(req.path || '/');
    if (relativa.split('/').some((s) => s.startsWith('.') && s.length > 0)) return next();
    const archivo = path.resolve(raiz, '.' + relativa);
    if (archivo !== raiz && !archivo.startsWith(raiz + path.sep)) return next();
    enviarArchivo(req, res, archivo, op, () => next());
  };
}

// ---------------------------------------------------------------------------
// Aplicación
// ---------------------------------------------------------------------------
function crearAplicacion() {
  const router = Router();

  function app(req, res) {
    preparar(req, res);
    router(req, res, (error) => {
      if (res.writableEnded) return;
      if (error) {
        console.error('[web] Error sin manejar:', error);
        if (!res.headersSent) res.status(500).type('text').send('Error interno');
        else res.end();
        return;
      }
      res.status(404).type('text').send('No encontrado');
    });
  }

  for (const m of ['use', 'get', 'post', 'put', 'patch', 'delete', 'options']) app[m] = (...a) => { router[m](...a); return app; };
  app.disable = () => app;
  app.set = () => app;
  app.listen = (puerto, host, alIniciar) => {
    const servidor = http.createServer(app);
    servidor.listen(puerto, host, alIniciar);
    return servidor;
  };
  return app;
}

module.exports = crearAplicacion;
module.exports.Router = Router;
module.exports.json = json;
module.exports.static = estatico;
