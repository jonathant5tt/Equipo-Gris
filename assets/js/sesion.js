/**
 * @file sesion.js
 * @description Sesión del usuario, permisos por rol, protección de pantallas
 * y navegación declarativa (`data-nav`).
 *
 * Se carga en el <head> (sin `defer`) para que la protección de la pantalla
 * ocurra ANTES de dibujarla: si no hay sesión, el rol no tiene permiso o el
 * servicio está suspendido, se redirige sin mostrar contenido.
 *
 * Importante: esta protección es solo de experiencia de usuario. El back end
 * debe validar SIEMPRE el token y el rol en cada endpoint.
 *
 * Expone el objeto global `Sesion`.
 * Requiere: config.js
 */
(function () {
  'use strict';

  var CFG = window.APP_CONFIG;

  // ---------------------------------------------------------------------------
  // Roles y permisos
  // ---------------------------------------------------------------------------

  /** Roles del sistema. Deben coincidir con los que devuelve el back end. */
  var ROLES = Object.freeze({
    CAJERO: 'Cajero',
    DUENO: 'Dueño',
    BARBERO: 'Barbero'
  });

  var TODOS = [ROLES.CAJERO, ROLES.DUENO, ROLES.BARBERO];
  var CAJA = [ROLES.CAJERO, ROLES.DUENO];

  /**
   * Pantallas que requieren sesión y roles que pueden abrirlas.
   * Las que no aparecen aquí son públicas (inicio de sesión y mantenimiento).
   */
  var PERMISOS = Object.freeze({
    'panel.html': TODOS,
    'agendar-cita.html': TODOS,
    'nuevo-cliente.html': TODOS,
    'registrar-cobro.html': CAJA,
    'ticket-digital.html': CAJA,
    'perfil-cliente.html': CAJA,
    'cierre-caja.html': CAJA,
    'historial-ventas.html': CAJA,
    'personal-horarios.html': [ROLES.DUENO],
    'suspender-servicio.html': [ROLES.DUENO],
    'barbero-mis-citas.html': [ROLES.BARBERO],
    'barbero-perfil-cliente.html': [ROLES.BARBERO],
    'barbero-mi-horario.html': [ROLES.BARBERO]
  });

  // ---------------------------------------------------------------------------
  // Almacenamiento local
  // ---------------------------------------------------------------------------
  // Se usa localStorage. Si el navegador lo bloquea (modo privado, WebView
  // restringido), se usa window.name como respaldo: sobrevive a la navegación
  // dentro de la misma pestaña.

  var PREFIJO = 'engreidos.';
  var respaldo = {};
  try { respaldo = JSON.parse(window.name || '{}') || {}; } catch (e) { respaldo = {}; }
  if (typeof respaldo !== 'object') respaldo = {};

  var Almacen = {
    /** @param {string} clave @returns {*} */
    leer: function (clave) {
      try {
        var valor = window.localStorage.getItem(PREFIJO + clave);
        if (valor !== null) return JSON.parse(valor);
      } catch (e) { /* almacenamiento no disponible */ }
      return respaldo[clave] === undefined ? null : respaldo[clave];
    },
    /** @param {string} clave @param {*} valor  null elimina la clave. */
    guardar: function (clave, valor) {
      try {
        if (valor === null) window.localStorage.removeItem(PREFIJO + clave);
        else window.localStorage.setItem(PREFIJO + clave, JSON.stringify(valor));
      } catch (e) { /* almacenamiento no disponible */ }
      if (valor === null) delete respaldo[clave]; else respaldo[clave] = valor;
      try { window.name = JSON.stringify(respaldo); } catch (e) { /* sin respaldo */ }
    }
  };

  // ---------------------------------------------------------------------------
  // Sesión
  // ---------------------------------------------------------------------------

  /**
   * @typedef {Object} UsuarioSesion
   * @property {number|null} id       ID del usuario en su tabla (CAJERO, BARBERO o administrador).
   * @property {string}      nombre   Nombre para mostrar.
   * @property {string}      usuario  Nombre de usuario con el que inició sesión.
   * @property {string}      rol      Uno de ROLES.
   */

  /**
   * @typedef {Object} DatosSesion
   * @property {string}        token   Token de acceso (JWT) emitido por el back end.
   * @property {UsuarioSesion} usuario
   * @property {string}        inicio  Fecha ISO del inicio de sesión.
   */

  /** @returns {DatosSesion|null} */
  function obtener() { return Almacen.leer('sesion'); }

  /** @param {{token:string, usuario:UsuarioSesion}} datos */
  function guardar(datos) {
    Almacen.guardar('sesion', {
      token: datos.token,
      usuario: datos.usuario,
      inicio: new Date().toISOString()
    });
  }

  /** Borra la sesión local (el aviso al servidor lo hace Api.auth.cerrarSesion). */
  function borrar() { Almacen.guardar('sesion', null); }

  /** @returns {UsuarioSesion|null} */
  function usuario() { var s = obtener(); return s ? s.usuario : null; }

  /** @returns {string|null} */
  function rol() { var u = usuario(); return u ? u.rol : null; }

  /** @returns {string|null} */
  function token() { var s = obtener(); return s ? s.token : null; }

  // ---------------------------------------------------------------------------
  // Estado del servicio (suspendido / activo)
  // ---------------------------------------------------------------------------
  // Se guarda una copia local de la última respuesta de
  // GET /establecimiento/estado para decidir al instante si se muestra la
  // pantalla de mantenimiento. El back end responde 503 si está suspendido.

  /** @param {{EstadoServicio:string, MensajeMantenimiento?:string}} estado */
  function guardarEstadoServicio(estado) { Almacen.guardar('servicio', estado); }

  /** @returns {{EstadoServicio:string, MensajeMantenimiento?:string}|null} */
  function estadoServicio() { return Almacen.leer('servicio'); }

  /** @returns {boolean} */
  function servicioSuspendido() {
    var e = estadoServicio();
    return !!(e && e.EstadoServicio === 'Suspendido');
  }

  // ---------------------------------------------------------------------------
  // Navegación
  // ---------------------------------------------------------------------------

  /** Nombre del archivo de la pantalla actual, ej. "registrar-cobro.html". */
  var paginaActual = (function () {
    var archivo = decodeURIComponent(window.location.pathname.split('/').pop() || '');
    return /\.html?$/i.test(archivo) ? archivo : CFG.PAGINA_LOGIN;
  })();

  /** @param {string} pagina @returns {boolean} */
  function puedeAbrir(pagina) {
    var permitidos = PERMISOS[pagina.split('?')[0]];
    return !permitidos || permitidos.indexOf(rol()) !== -1;
  }

  /**
   * Resuelve un destino de `data-nav` a una URL real.
   *   "@panel"     → panel principal
   *   "@perfil"    → perfil del cliente (versión tablet o móvil según el rol)
   *   "@logout"    → cierra sesión
   *   "archivo.html?param=valor" → se usa tal cual
   * Los alias aceptan parámetros: "@perfil?cliente=7".
   * @param {string} destino
   * @returns {string}
   */
  function resolverDestino(destino) {
    var corte = destino.indexOf('?');
    var alias = corte === -1 ? destino : destino.slice(0, corte);
    var consulta = corte === -1 ? '' : destino.slice(corte);
    switch (alias) {
      case '@panel': return CFG.PAGINA_PANEL + consulta;
      case '@perfil': return (rol() === ROLES.BARBERO ? 'barbero-perfil-cliente.html' : 'perfil-cliente.html') + consulta;
      default: return destino;
    }
  }

  /** @param {string} url */
  function ir(url) { window.location.href = url; }

  /**
   * Cierra la sesión: avisa al back end (si existe) y vuelve al inicio de sesión.
   * @returns {Promise<void>}
   */
  function cerrar() {
    var aviso = (window.Api && window.Api.auth) ? window.Api.auth.cerrarSesion().catch(function () {}) : Promise.resolve();
    return aviso.then(function () {
      borrar();
      window.location.replace(CFG.PAGINA_LOGIN);
    });
  }

  /**
   * Protección de la pantalla actual. Se ejecuta inmediatamente.
   * @returns {boolean} true si la pantalla puede mostrarse.
   */
  function proteger() {
    var permitidos = PERMISOS[paginaActual];
    var sesion = obtener();

    if (permitidos) {
      if (!sesion) { window.location.replace(CFG.PAGINA_LOGIN); return false; }
      if (servicioSuspendido() && sesion.usuario.rol !== ROLES.DUENO) {
        window.location.replace(CFG.PAGINA_MANTENIMIENTO); return false;
      }
      if (permitidos.indexOf(sesion.usuario.rol) === -1) {
        window.location.replace(CFG.PAGINA_PANEL); return false;
      }
    } else if (paginaActual === CFG.PAGINA_LOGIN && sesion) {
      // Con sesión abierta no tiene caso volver a pedir credenciales.
      window.location.replace(servicioSuspendido() && sesion.usuario.rol !== ROLES.DUENO
        ? CFG.PAGINA_MANTENIMIENTO : CFG.PAGINA_PANEL);
      return false;
    }
    return true;
  }

  /*
   * Navegación declarativa: cualquier elemento con `data-nav` navega al hacer
   * clic. Se escucha en fase de captura para que tenga prioridad sobre otros
   * manejadores. Ejemplos:
   *   <button data-nav="registrar-cobro.html">…</button>
   *   <a data-nav="@panel" href="panel.html">…</a>
   *   <button data-nav="@logout">…</button>
   */
  document.addEventListener('click', function (evento) {
    var el = evento.target.closest ? evento.target.closest('[data-nav]') : null;
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
    evento.preventDefault();
    var destino = el.getAttribute('data-nav');
    if (destino === '@logout') { cerrar(); return; }
    ir(resolverDestino(destino));
  }, true);

  // Ejecutar la protección antes de que se dibuje la pantalla.
  var permitida = proteger();

  window.Sesion = Object.freeze({
    ROLES: ROLES,
    PERMISOS: PERMISOS,
    Almacen: Almacen,
    paginaActual: paginaActual,
    permitida: permitida,
    obtener: obtener,
    guardar: guardar,
    borrar: borrar,
    cerrar: cerrar,
    usuario: usuario,
    rol: rol,
    token: token,
    puedeAbrir: puedeAbrir,
    resolverDestino: resolverDestino,
    ir: ir,
    guardarEstadoServicio: guardarEstadoServicio,
    estadoServicio: estadoServicio,
    servicioSuspendido: servicioSuspendido
  });
})();
