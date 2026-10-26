/**
 * @file paginas/barbero-mis-citas.js
 * @description Controlador de «Mis citas» del barbero (barbero-mis-citas.html).
 *
 * Flujo:
 *   1. Muestra los avisos pendientes.                 GET /avisos
 *   2. Muestra la agenda del día elegido.             GET /citas/mias?fecha=AAAA-MM-DD
 *   3. Inicia o finaliza la atención de un turno.     PATCH /citas/:id/estado { Estado }
 *      Transiciones permitidas (diagrama de estados 3.2):
 *        Agendada | EnEspera → EnAtencion → Atendida
 *   4. Tocar al cliente abre su perfil.               barbero-perfil-cliente.html?cliente=ID
 */
(function () {
  'use strict';

  if (!window.Sesion.permitida) return;

  var U = window.Utilidades;
  var Api = window.Api;

  /** Texto e insignia para cada estado de la cita. */
  var ESTADOS = {
    Agendada:   { texto: 'Agendada',    clase: '' },
    EnEspera:   { texto: 'En espera',   clase: 'insignia--alerta' },
    EnAtencion: { texto: 'En atención', clase: 'insignia--oro' },
    Atendida:   { texto: 'Atendida',    clase: 'insignia--exito' },
    Cancelada:  { texto: 'Cancelada',   clase: 'insignia--error' },
    NoAsistio:  { texto: 'No asistió',  clase: 'insignia--error' }
  };

  /** Texto para el origen de la cita. */
  var ORIGENES = { WhatsApp: 'WhatsApp', Caja: 'Caja', App: 'App', SinCita: 'Sin cita' };

  /** Siguiente estado y texto del botón de atención. */
  var SIGUIENTE = {
    Agendada:   { estado: 'EnAtencion', texto: 'Iniciar' },
    EnEspera:   { estado: 'EnAtencion', texto: 'Iniciar' },
    EnAtencion: { estado: 'Atendida',   texto: 'Finalizar' }
  };

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    numeroAvisos: $('numero-avisos'),
    avisos: $('avisos'),
    diaAnterior: $('dia-anterior'),
    diaSiguiente: $('dia-siguiente'),
    diaHoy: $('dia-hoy'),
    fechaTexto: $('fecha-texto'),
    numeroTurnos: $('numero-turnos'),
    cargando: $('citas-cargando'),
    vacio: $('citas-vacio'),
    citas: $('citas'),
    botonFlotante: $('boton-flotante'),
    accesos: $('accesos')
  };

  var fecha = new Date();   // Día consultado

  // ---------------------------------------------------------------------------
  // Avisos
  // ---------------------------------------------------------------------------

  /** Muestra los avisos pendientes del barbero y su contador. */
  async function cargarAvisos() {
    var avisos = [];
    try { avisos = (await Api.avisos.listar()) || []; }
    catch (error) { U.aviso(error.message, 'error'); }

    U.dibujarLista({ contenedor: el.avisos, plantilla: 'plantilla-aviso', datos: avisos });
    el.avisos.hidden = !avisos.length;
    el.numeroAvisos.hidden = !avisos.length;
    el.numeroAvisos.querySelector('[data-texto]').textContent = avisos.length + (avisos.length === 1 ? ' aviso' : ' avisos');
  }

  // ---------------------------------------------------------------------------
  // Agenda del día
  // ---------------------------------------------------------------------------

  /** @param {number} dias  -1 anterior, 1 siguiente, 0 hoy. */
  function moverFecha(dias) {
    fecha = dias === 0 ? new Date() : new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate() + dias);
    var esHoy = U.fechaISO(fecha) === U.fechaISO();
    el.fechaTexto.textContent = (esHoy ? 'Hoy, ' : '') + U.formatoFechaLarga(fecha);
    cargarCitas();
  }

  /** Dibuja los turnos del día elegido y resalta el turno actual. */
  async function cargarCitas() {
    el.cargando.hidden = false;
    el.citas.hidden = true;
    el.vacio.hidden = true;

    var citas = [];
    try { citas = (await Api.citas.mias(U.fechaISO(fecha))) || []; }
    catch (error) { U.aviso(error.message, 'error'); }
    el.cargando.hidden = true;

    var activas = citas.filter(function (c) { return c.Estado !== 'Cancelada'; }).length;
    el.numeroTurnos.textContent = activas + (activas === 1 ? ' turno asignado' : ' turnos asignados');

    // El primer turno pendiente se resalta como «actual».
    var actual = citas.find(function (c) { return c.Estado === 'EnAtencion'; }) ||
                 citas.find(function (c) { return c.Estado === 'EnEspera' || c.Estado === 'Agendada'; });

    U.dibujarLista({
      contenedor: el.citas,
      plantilla: 'plantilla-cita',
      vacio: el.vacio,
      datos: citas.map(function (c) {
        return Object.assign({}, c, {
          EstadoTexto: (ESTADOS[c.Estado] || { texto: c.Estado }).texto,
          OrigenTexto: 'Origen: ' + (ORIGENES[c.Origen] || c.Origen || '—')
        });
      }),
      alCrear: function (fila, cita) {
        var estado = ESTADOS[cita.Estado] || { clase: '' };
        fila.querySelector('.insignia').className = 'insignia ' + estado.clase;
        if (['Atendida', 'Cancelada', 'NoAsistio'].indexOf(cita.Estado) !== -1) fila.classList.add('turno--terminado');
        if (actual && cita.ID_Cita === actual.ID_Cita) fila.classList.add('turno--actual');

        fila.querySelector('[data-accion="perfil"]')
          .setAttribute('data-nav', '@perfil?cliente=' + encodeURIComponent(cita.ID_Cliente));

        var siguiente = SIGUIENTE[cita.Estado];
        var boton = fila.querySelector('[data-accion="atencion"]');
        if (siguiente) {
          boton.hidden = false;
          boton.textContent = siguiente.texto;
          if (siguiente.estado === 'Atendida') boton.classList.add('boton--primario');
          boton.addEventListener('click', function () { cambiarEstado(cita, siguiente.estado, boton); });
        }
      }
    });
    el.citas.hidden = !citas.length;
  }

  /**
   * @param {Object} cita
   * @param {'EnAtencion'|'Atendida'} nuevoEstado
   * @param {HTMLButtonElement} boton
   */
  async function cambiarEstado(cita, nuevoEstado, boton) {
    try {
      var r = await U.conCarga(boton, Api.citas.cambiarEstado(cita.ID_Cita, nuevoEstado));
      if (r && r.simulado) return;
      U.aviso(nuevoEstado === 'Atendida' ? 'Atención finalizada: el cliente pasa a caja.' : 'Atención iniciada.');
      cargarCitas();
    } catch (error) { U.aviso(error.message, 'error'); }
  }

  // ---------------------------------------------------------------------------
  // Botón flotante
  // ---------------------------------------------------------------------------

  /** @param {boolean} [abrir] */
  function alternarAccesos(abrir) {
    var abierto = typeof abrir === 'boolean' ? abrir : el.botonFlotante.getAttribute('aria-expanded') !== 'true';
    el.botonFlotante.setAttribute('aria-expanded', String(abierto));
    el.accesos.hidden = !abierto;
  }

  // ---- Arranque ---------------------------------------------------------------
  el.diaAnterior.addEventListener('click', function () { moverFecha(-1); });
  el.diaSiguiente.addEventListener('click', function () { moverFecha(1); });
  el.diaHoy.addEventListener('click', function () { moverFecha(0); });
  el.botonFlotante.addEventListener('click', function () { alternarAccesos(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') alternarAccesos(false); });

  cargarAvisos();
  moverFecha(0);
})();
