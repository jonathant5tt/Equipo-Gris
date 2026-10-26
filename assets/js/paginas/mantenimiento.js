/**
 * @file paginas/mantenimiento.js
 * @description Controlador de «Servicio en mantenimiento» (mantenimiento.html).
 *
 * Flujo:
 *   1. Muestra el mensaje del Dueño guardado localmente (al instante).
 *   2. Consulta el estado real y repite la consulta cada INTERVALO_SALUD_MS.
 *      GET /establecimiento/estado → { EstadoServicio, MensajeMantenimiento }
 *   3. Si el servicio ya está «Activo», regresa al panel (con sesión) o al
 *      inicio de sesión (sin sesión).
 *
 * El Dueño nunca ve esta pantalla: puede seguir operando con el servicio
 * suspendido para poder reanudarlo.
 */
(function () {
  'use strict';

  var U = window.Utilidades;
  var Api = window.Api;
  var CFG = window.APP_CONFIG;
  var Sesion = window.Sesion;

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    mensaje: $('mensaje'),
    reintentar: $('reintentar'),
    reintentarIcono: $('reintentar-icono'),
    cerrarSesion: $('cerrar-sesion'),
    estadoVerificacion: $('estado-verificacion')
  };

  // El Dueño no se bloquea: vuelve directo a su panel.
  if (Sesion.rol() === Sesion.ROLES.DUENO) { window.location.replace(CFG.PAGINA_PANEL); return; }

  /** @param {{MensajeMantenimiento?:string}|null} estado */
  function pintarMensaje(estado) {
    el.mensaje.textContent = (estado && estado.MensajeMantenimiento) || CFG.MENSAJE_MANTENIMIENTO;
  }

  /**
   * Consulta el estado del servicio y sale de la pantalla si ya está activo.
   * @param {boolean} [manual]  true cuando lo pidió el usuario (muestra avisos).
   */
  async function verificar(manual) {
    el.reintentarIcono.classList.add('girando');
    try {
      var estado = await U.conCarga(el.reintentar, Api.establecimiento.estado());
      if (estado && estado.EstadoServicio === 'Activo') {
        window.location.replace(Sesion.obtener() ? CFG.PAGINA_PANEL : CFG.PAGINA_LOGIN);
        return;
      }
      pintarMensaje(estado);
      if (manual) U.aviso('El servicio sigue suspendido.', 'info');
    } catch (error) {
      if (manual) U.aviso(error.message, 'error');
    } finally {
      el.reintentarIcono.classList.remove('girando');
    }
  }

  // ---- Arranque ---------------------------------------------------------------
  document.querySelectorAll('[data-version]').forEach(function (n) { n.textContent = CFG.VERSION; });
  el.cerrarSesion.hidden = !Sesion.obtener();
  el.reintentar.addEventListener('click', function () { verificar(true); });

  pintarMensaje(Sesion.estadoServicio());
  verificar(false);
  setInterval(verificar, CFG.INTERVALO_SALUD_MS);
})();
