/**
 * @file paginas/suspender-servicio.js
 * @description Controlador de «Suspender / reanudar servicio» (suspender-servicio.html).
 *
 * Flujo:
 *   1. Muestra el estado guardado y lo confirma con el servidor.
 *      GET /establecimiento/estado → { EstadoServicio, MensajeMantenimiento }
 *   2. El Dueño elige Suspender o Reanudar y confirma en la tarjeta lateral.
 *   3. Se guarda el nuevo estado.
 *      PUT /establecimiento/estado { EstadoServicio, MensajeMantenimiento }
 *
 * Mientras el estado sea «Suspendido», sesion.js envía a cajeros y barberos
 * a mantenimiento.html y el back end responde 503 a sus peticiones.
 */
(function () {
  'use strict';

  if (!window.Sesion.permitida) return;

  var U = window.Utilidades;
  var Api = window.Api;
  var CFG = window.APP_CONFIG;
  var Sesion = window.Sesion;

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    insignia: $('estado-insignia'),
    estadoTexto: $('estado-texto'),
    mensaje: $('mensaje'),
    contador: $('contador'),
    suspender: $('suspender'),
    reanudar: $('reanudar'),
    actualizarMensaje: $('actualizar-mensaje'),
    confirmacion: $('confirmacion'),
    confirmacionIcono: $('confirmacion-icono'),
    confirmacionTitulo: $('confirmacion-titulo'),
    confirmacionTexto: $('confirmacion-texto'),
    confirmar: $('confirmar'),
    cancelar: $('cancelar'),
    vistaPrevia: $('vista-previa')
  };

  /** Textos de la tarjeta de confirmación para cada acción. */
  var ACCIONES = {
    suspender: {
      estado: 'Suspendido',
      icono: 'warning',
      titulo: '¿Suspender el servicio?',
      texto: 'Se bloqueará el acceso a caja, agenda y WhatsApp. Los usuarios verán el aviso de mantenimiento.',
      exito: 'Servicio suspendido.'
    },
    reanudar: {
      estado: 'Activo',
      icono: 'play_circle',
      titulo: '¿Reanudar el servicio?',
      texto: 'Todos los usuarios podrán volver a usar el sistema de inmediato.',
      exito: 'Servicio reanudado.'
    },
    mensaje: {
      estado: 'Suspendido',
      icono: 'edit',
      titulo: '¿Actualizar el mensaje?',
      texto: 'El servicio seguirá suspendido; solo cambiará el aviso que ven los usuarios.',
      exito: 'Mensaje de mantenimiento actualizado.'
    }
  };

  var estadoActual = null;      // 'Activo' | 'Suspendido' | null (desconocido)
  var accionPendiente = null;   // Clave de ACCIONES en espera de confirmación

  /** @param {{EstadoServicio:string, MensajeMantenimiento?:string}|null} estado */
  function pintar(estado) {
    if (!estado) return;
    estadoActual = estado.EstadoServicio === 'Suspendido' ? 'Suspendido' : 'Activo';
    var suspendido = estadoActual === 'Suspendido';

    el.estadoTexto.textContent = suspendido ? 'Suspendido' : 'Activo';
    el.insignia.className = 'insignia ' + (suspendido ? 'insignia--error' : 'insignia--exito');
    el.suspender.disabled = suspendido;
    el.reanudar.disabled = !suspendido;
    el.actualizarMensaje.hidden = !suspendido;

    // No se sobrescribe lo que el Dueño esté escribiendo.
    if (document.activeElement !== el.mensaje) el.mensaje.value = estado.MensajeMantenimiento || '';
    actualizarVistaPrevia();
  }

  /** Actualiza el contador de caracteres y la vista previa del aviso. */
  function actualizarVistaPrevia() {
    el.contador.textContent = el.mensaje.value.length;
    el.vistaPrevia.textContent = el.mensaje.value.trim() || CFG.MENSAJE_MANTENIMIENTO;
  }

  /** @param {'suspender'|'reanudar'|'mensaje'} clave */
  function pedirConfirmacion(clave) {
    var a = ACCIONES[clave];
    accionPendiente = clave;
    el.confirmacionIcono.textContent = a.icono;
    el.confirmacionTitulo.textContent = a.titulo;
    el.confirmacionTexto.textContent = a.texto;
    el.confirmacion.hidden = false;
    el.confirmacion.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    el.confirmar.focus();
  }

  /** Oculta la tarjeta de confirmación sin aplicar cambios. */
  function cerrarConfirmacion() {
    accionPendiente = null;
    el.confirmacion.hidden = true;
  }

  /** Aplica la acción pendiente.  PUT /establecimiento/estado */
  async function confirmar() {
    var a = ACCIONES[accionPendiente];
    if (!a) return;
    try {
      var estado = await U.conCarga(el.confirmar, Api.establecimiento.cambiarEstado({
        EstadoServicio: a.estado,
        MensajeMantenimiento: el.mensaje.value.trim()
      }));
      pintar(estado);
      U.aviso(a.exito, 'exito');
      cerrarConfirmacion();
    } catch (error) { U.aviso(error.message, 'error'); }
  }

  // ---- Arranque ---------------------------------------------------------------
  el.mensaje.addEventListener('input', actualizarVistaPrevia);
  el.suspender.addEventListener('click', function () { pedirConfirmacion('suspender'); });
  el.reanudar.addEventListener('click', function () { pedirConfirmacion('reanudar'); });
  el.actualizarMensaje.addEventListener('click', function () { pedirConfirmacion('mensaje'); });
  el.confirmar.addEventListener('click', confirmar);
  el.cancelar.addEventListener('click', cerrarConfirmacion);

  pintar(Sesion.estadoServicio() || { EstadoServicio: 'Activo' });   // valor guardado, al instante
  Api.establecimiento.estado().then(pintar).catch(function (error) { U.aviso(error.message, 'error'); });
})();
