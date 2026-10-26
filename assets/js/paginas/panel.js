/**
 * @file paginas/panel.js
 * @description Controlador del panel principal (panel.html).
 *
 * Responsabilidades:
 *   - Mostrar solo los mosaicos permitidos para el rol con sesión.
 *   - Mostrar el nombre del usuario y el estado del servicio.
 *   - (Barbero) Mostrar el siguiente turno y permitir iniciar o finalizar la
 *     atención, siguiendo el diagrama de estados de la Cita:
 *     Agendada/EnEspera → EnAtencion → Atendida.
 */
(function () {
  'use strict';

  if (!window.Sesion.permitida) return;

  var U = window.Utilidades;
  var Api = window.Api;
  var Sesion = window.Sesion;
  var ROLES = Sesion.ROLES;
  var rol = Sesion.rol();

  var el = {
    nombre: document.getElementById('nombre-usuario'),
    estadoServicio: document.getElementById('estado-servicio'),
    mosaicos: document.getElementById('mosaicos'),
    turno: document.getElementById('siguiente-turno'),
    turnoCargando: document.getElementById('turno-cargando'),
    turnoVacio: document.getElementById('turno-vacio'),
    turnoDatos: document.getElementById('turno-datos'),
    turnoFicha: document.getElementById('turno-ficha'),
    turnoAtencion: document.getElementById('turno-atencion')
  };

  /** Cita mostrada en «Siguiente turno». @type {Object|null} */
  var citaActual = null;

  // ---------------------------------------------------------------------------
  // Mosaicos por rol
  // ---------------------------------------------------------------------------

  /** Oculta lo que no corresponde al rol y numera los mosaicos visibles. */
  function aplicarPermisos() {
    document.querySelectorAll('[data-roles]').forEach(function (nodo) {
      var roles = nodo.getAttribute('data-roles').split(',');
      nodo.hidden = roles.indexOf(rol) === -1;
    });

    var visibles = Array.prototype.filter.call(el.mosaicos.children, function (m) { return !m.hidden; });
    visibles.forEach(function (mosaico, i) {
      mosaico.querySelector('.mosaico__numero').textContent = String(i + 1);
    });
    // Con 8 mosaicos (Dueño) se usan 4 columnas en pantallas anchas.
    el.mosaicos.classList.toggle('lg:grid-cols-4', visibles.length % 4 === 0);
  }

  // ---------------------------------------------------------------------------
  // Estado del servicio
  // ---------------------------------------------------------------------------

  /** @param {{EstadoServicio:string}|null} estado */
  function pintarEstadoServicio(estado) {
    var suspendido = estado && estado.EstadoServicio === 'Suspendido';
    el.estadoServicio.className = 'insignia ' + (suspendido ? 'insignia--error' : 'insignia--exito');
    el.estadoServicio.querySelector('[data-texto]').textContent = suspendido ? 'SUSPENDIDO' : 'ACTIVO';

    // Solo el Dueño puede ir a suspender o reanudar.
    var esDueno = rol === ROLES.DUENO;
    el.estadoServicio.disabled = !esDueno;
    if (esDueno) {
      el.estadoServicio.setAttribute('data-nav', 'suspender-servicio.html');
      el.estadoServicio.title = 'Suspender o reanudar el servicio';
      el.estadoServicio.style.cursor = 'pointer';
    }
  }

  /** Muestra el estado guardado al instante y luego lo confirma con el servidor.  GET /establecimiento/estado */
  async function cargarEstadoServicio() {
    pintarEstadoServicio(Sesion.estadoServicio());     // valor guardado, al instante
    try { pintarEstadoServicio(await Api.establecimiento.estado()); }
    catch (e) { /* se queda el valor guardado */ }
  }

  // ---------------------------------------------------------------------------
  // Siguiente turno (Barbero)
  // ---------------------------------------------------------------------------

  /** Ajusta el botón según el estado de la cita. */
  function pintarBotonAtencion() {
    var enAtencion = citaActual && citaActual.Estado === 'EnAtencion';
    el.turnoAtencion.querySelector('[data-texto]').textContent = enAtencion ? 'Finalizar atención' : 'Iniciar atención';
    el.turnoAtencion.querySelector('.icono').textContent = enAtencion ? 'check' : 'play_arrow';
  }

  /** Muestra la cita en atención o la siguiente del barbero.  GET /citas/proxima */
  async function cargarSiguienteTurno() {
    el.turno.hidden = false;
    try {
      citaActual = await Api.citas.proxima();
    } catch (error) {
      citaActual = null;
      U.aviso(error.message, 'error');
    }
    el.turnoCargando.hidden = true;
    el.turnoVacio.hidden = !!citaActual;
    el.turnoDatos.hidden = !citaActual;
    if (!citaActual) return;

    U.llenar(el.turnoDatos, citaActual);
    el.turnoFicha.setAttribute('data-nav', 'barbero-perfil-cliente.html?cliente=' + encodeURIComponent(citaActual.ID_Cliente));
    pintarBotonAtencion();
  }

  /** Inicia o finaliza la atención de la cita actual. */
  async function cambiarAtencion() {
    if (!citaActual) return;
    var nuevoEstado = citaActual.Estado === 'EnAtencion' ? 'Atendida' : 'EnAtencion';
    try {
      await U.conCarga(el.turnoAtencion, Api.citas.cambiarEstado(citaActual.ID_Cita, nuevoEstado));
      if (nuevoEstado === 'Atendida') {
        U.aviso('Atención finalizada: el cliente pasa a caja.');
        cargarSiguienteTurno();
      } else {
        citaActual.Estado = nuevoEstado;
        pintarBotonAtencion();
        U.aviso('Atención iniciada.');
      }
    } catch (error) {
      U.aviso(error.message, 'error');
    }
  }

  // ---- Arranque ---------------------------------------------------------------
  var usuario = Sesion.usuario();
  el.nombre.textContent = usuario ? usuario.nombre : '';
  document.querySelectorAll('[data-version]').forEach(function (n) { n.textContent = window.APP_CONFIG.VERSION; });

  aplicarPermisos();
  cargarEstadoServicio();
  if (rol === ROLES.BARBERO) {
    el.turnoAtencion.addEventListener('click', cambiarAtencion);
    cargarSiguienteTurno();
  }
})();
