/**
 * @file config.js
 * @description Configuración global del front end de Engreídos Barbershop.
 *
 * Es el único archivo que hay que editar para conectar el front end con el
 * back end (Node.js + MySQL):
 *   1. Levantar la API REST (por ejemplo, Express en http://localhost:3000).
 *   2. Cambiar `USAR_BACKEND` a `true`.
 *   3. Ajustar `API_URL` a la dirección real del servidor.
 *
 * Mientras `USAR_BACKEND` sea `false`, las pantallas funcionan en
 * «modo sin servidor» (ver assets/js/api-sin-servidor.js): se puede navegar
 * e iniciar sesión, pero no se guarda ni se consulta información real.
 *
 * Debe cargarse antes que cualquier otro script propio.
 */
(function () {
  'use strict';

  /**
   * @typedef {Object} ConfiguracionApp
   * @property {string}  NOMBRE               Nombre comercial que se muestra en la interfaz.
   * @property {string}  VERSION              Versión del front end.
   * @property {string}  API_URL              URL base de la API REST, sin diagonal final.
   * @property {boolean} USAR_BACKEND         true = consumir la API real; false = modo sin servidor.
   * @property {number}  TIEMPO_ESPERA_MS     Tiempo máximo de espera por petición.
   * @property {number}  INTERVALO_SALUD_MS   Cada cuánto se verifica la conexión con el servidor.
   * @property {string}  LOCALE               Configuración regional para fechas y moneda.
   * @property {string}  ZONA_HORARIA         Zona horaria del negocio.
   * @property {string}  MONEDA               Código ISO de la moneda.
   * @property {number}  TASA_IVA             IVA incluido en los precios (0.16 = 16 %).
   * @property {number}  DURACION_CITA_MIN    Duración estándar de una cita, en minutos.
   * @property {number}  TAMANO_PAGINA        Registros por página en listados (historial).
   * @property {string}  PAGINA_LOGIN         Archivo de la pantalla de inicio de sesión.
   * @property {string}  PAGINA_PANEL         Archivo del panel principal.
   * @property {string}  PAGINA_MANTENIMIENTO Archivo que se muestra con el servicio suspendido.
   * @property {string}  MENSAJE_MANTENIMIENTO Texto por omisión si el Dueño no escribe un mensaje.
   */

  /** @type {ConfiguracionApp} */
  var CONFIG = {
    NOMBRE: 'Engreídos Barbershop',
    VERSION: '1.0.0',

    // ---- Conexión con el back end ------------------------------------------
    API_URL: 'http://localhost:3000/api',
    USAR_BACKEND: false,
    TIEMPO_ESPERA_MS: 15000,
    INTERVALO_SALUD_MS: 30000,

    // ---- Formatos regionales -----------------------------------------------
    LOCALE: 'es-MX',
    ZONA_HORARIA: 'America/Mexico_City',
    MONEDA: 'MXN',

    // ---- Reglas de negocio de referencia (el back end tiene la última palabra)
    TASA_IVA: 0.16,
    DURACION_CITA_MIN: 30,
    TAMANO_PAGINA: 20,

    // ---- Páginas clave -----------------------------------------------------
    PAGINA_LOGIN: 'index.html',
    PAGINA_PANEL: 'panel.html',
    PAGINA_MANTENIMIENTO: 'mantenimiento.html',

    // ---- Textos del sistema ------------------------------------------------
    MENSAJE_MANTENIMIENTO: 'El sistema se encuentra temporalmente suspendido. Intenta de nuevo más tarde o comunícate con el administrador.'
  };

  window.APP_CONFIG = Object.freeze(CONFIG);
})();
