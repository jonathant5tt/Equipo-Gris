/**
 * @file config.js
 * @description Configuración global del front end de Engreídos Barbershop.
 *
 * Dirección del servidor (back end Node.js + MySQL):
 *  - Si la interfaz se abre desde el propio servidor (http://localhost:3000 o
 *    http://IP-de-la-PC:3000), la API está en la misma dirección.
 *  - En la app de Android (o abriendo los archivos sin servidor) la dirección
 *    se configura una vez en la pantalla de inicio de sesión o en
 *    Ajustes → Servidor, y se guarda en el dispositivo.
 *
 * Debe cargarse antes que cualquier otro script propio.
 */
(function () {
  'use strict';

  var CLAVE_SERVIDOR = 'engreidos.servidor';

  /** Lee la dirección guardada del servidor (o null). */
  function servidorGuardado() {
    try { return JSON.parse(window.localStorage.getItem(CLAVE_SERVIDOR) || 'null'); } catch (e) { return null; }
  }

  var enServidor = /^https?:$/.test(window.location.protocol);
  var esApp = !!window.EngreidosAndroid;
  // Abierto desde el servidor: la API está en la misma dirección.
  // Abierto como archivo en la computadora: se intenta el servidor local.
  // App de Android: la dirección se configura (o se busca) en el inicio de sesión.
  var servidor = servidorGuardado() || (enServidor ? window.location.origin : (esApp ? '' : 'http://localhost:3000'));

  /**
   * @typedef {Object} ConfiguracionApp
   * @property {string}  NOMBRE                Nombre comercial.
   * @property {string}  VERSION               Versión del sistema.
   * @property {string}  SERVIDOR              Dirección del servidor, ej. "http://192.168.1.70:3000" ('' = sin configurar).
   * @property {string}  API_URL               SERVIDOR + "/api".
   * @property {boolean} ES_APP_ANDROID        true dentro de la app de Android (puente nativo disponible).
   * @property {number}  TIEMPO_ESPERA_MS      Tiempo máximo de espera por petición.
   * @property {number}  INTERVALO_SALUD_MS    Cada cuánto se verifica la conexión con el servidor.
   * @property {string}  ZONA_HORARIA          Zona horaria del negocio.
   * @property {string}  MONEDA                Código ISO de la moneda.
   * @property {number}  TAMANO_PAGINA         Registros por página en el historial.
   * @property {number}  FOTO_MAXIMO_PX        Lado mayor de las fotos antes de enviarlas.
   * @property {string}  PAGINA_LOGIN / PAGINA_PANEL / PAGINA_MANTENIMIENTO
   * @property {string}  MENSAJE_MANTENIMIENTO Texto por omisión si el Dueño no escribe un mensaje.
   */

  /** @type {ConfiguracionApp} */
  var CONFIG = {
    NOMBRE: 'Engreídos Barbershop',
    VERSION: '3.4.0',

    // ---- Conexión con el back end ------------------------------------------
    SERVIDOR: servidor,
    API_URL: servidor ? servidor.replace(/\/+$/, '') + '/api' : '',
    ES_APP_ANDROID: !!window.EngreidosAndroid,
    TIEMPO_ESPERA_MS: 20000,
    INTERVALO_SALUD_MS: 30000,
    /** Cada cuánto se pregunta al servidor si hubo cambios desde otro equipo. */
    INTERVALO_SINCRONIA_MS: 3000,

    // ---- Formatos regionales -----------------------------------------------
    ZONA_HORARIA: 'America/Mexico_City',
    MONEDA: 'MXN',

    // ---- Listados y archivos -----------------------------------------------
    TAMANO_PAGINA: 20,
    FOTO_MAXIMO_PX: 1280,

    // ---- Páginas clave -----------------------------------------------------
    PAGINA_LOGIN: 'index.html',
    PAGINA_PANEL: 'panel.html',
    PAGINA_MANTENIMIENTO: 'mantenimiento.html',

    // ---- Textos del sistema ------------------------------------------------
    MENSAJE_MANTENIMIENTO: 'El sistema se encuentra temporalmente suspendido. Intenta de nuevo más tarde o comunícate con el administrador.'
  };

  /**
   * Guarda la dirección del servidor y recarga la pantalla para usarla.
   * @param {string|null} url  null = volver a la dirección automática.
   */
  window.guardarServidor = function (url) {
    try {
      if (url) window.localStorage.setItem(CLAVE_SERVIDOR, JSON.stringify(String(url).trim().replace(/\/+$/, '')));
      else window.localStorage.removeItem(CLAVE_SERVIDOR);
    } catch (e) { /* almacenamiento no disponible */ }
  };

  window.APP_CONFIG = Object.freeze(CONFIG);
})();
