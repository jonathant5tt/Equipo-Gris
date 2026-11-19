/**
 * @file paginas/barbero-mis-citas.js
 * @description Controlador de «Mis citas» del barbero (barbero-mis-citas.html).
 *
 * Flujo:
 *   1. Muestra los avisos pendientes.                 GET /avisos
 *   2. Muestra la agenda del día elegido.             GET /citas/mias?fecha=AAAA-MM-DD
 *   3. Inicia o finaliza la atención de un turno.     PATCH /citas/:id/estado { Estado }
 *      Transiciones permitidas (diagrama de estados 3.2):
 *        Agendada | EnEspera → EnAtencion → Atendida   (o → NoAsistio)
 *      Atendida sin cobro se marca «? Pendiente de pago».
 *   4. Tocar al cliente abre su perfil.               barbero-perfil-cliente.html?cliente=ID
 */
(function () {
  'use strict';

  if (!window.Sesion.permitida) return;

  var U = window.Utilidades;
  var Api = window.Api;

  var t = window.Idioma.t;

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
    avisosBloque: $('avisos-bloque'),
    avisos: $('avisos'),
    avisosLeidos: $('avisos-leidos'),
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
    el.avisosBloque.hidden = !avisos.length;
    el.numeroAvisos.hidden = !avisos.length;
    el.numeroAvisos.querySelector('[data-texto]').textContent = t(avisos.length === 1 ? '{n} aviso' : '{n} avisos', { n: avisos.length });
  }

  /** Marca todos los avisos como leídos.  POST /avisos/leidos */
  async function marcarLeidos() {
    try { await U.conCarga(el.avisosLeidos, Api.avisos.marcarLeidos()); cargarAvisos(); }
    catch (error) { U.aviso(error.message, 'error'); }
  }

  // ---------------------------------------------------------------------------
  // Agenda del día
  // ---------------------------------------------------------------------------

  /** @param {number} dias  -1 anterior, 1 siguiente, 0 hoy. */
  function moverFecha(dias) {
    fecha = dias === 0 ? new Date() : new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate() + dias);
    var esHoy = U.fechaISO(fecha) === U.fechaISO();
    el.fechaTexto.textContent = (esHoy ? t('Hoy') + ', ' : '') + U.formatoFechaLarga(fecha);
    cargarCitas();
  }

  /** Dibuja los turnos del día elegido y resalta el turno actual. */
  async function cargarCitas(silencioso) {
    // «silencioso»: actualización automática; no borra la lista mientras llega la nueva.
    if (silencioso !== true) {
      el.cargando.hidden = false;
      el.citas.hidden = true;
      el.vacio.hidden = true;
    }

    var citas = [];
    try { citas = (await Api.citas.mias(U.fechaISO(fecha))) || []; }
    catch (error) { U.aviso(error.message, 'error'); }
    el.cargando.hidden = true;

    var activas = citas.filter(function (c) { return c.Estado !== 'Cancelada'; }).length;
    el.numeroTurnos.textContent = t(activas === 1 ? '{n} turno asignado' : '{n} turnos asignados', { n: activas });

    // El primer turno pendiente se resalta como «actual».
    var actual = citas.find(function (c) { return c.Estado === 'EnAtencion'; }) ||
                 citas.find(function (c) { return c.Estado === 'EnEspera' || c.Estado === 'Agendada'; });

    U.dibujarLista({
      contenedor: el.citas,
      plantilla: 'plantilla-cita',
      vacio: el.vacio,
      datos: citas.map(function (c) {
        return Object.assign({}, c, {
          EstadoTexto: U.estadoCita(c.Estado).texto,
          Duracion: t('{n} min', { n: c.DuracionMin }),
          OrigenTexto: t('Origen') + ': ' + t(ORIGENES[c.Origen] || c.Origen || '—')
        });
      }),
      alCrear: function (fila, cita) {
        fila.querySelector('.insignia').className = 'insignia ' + U.estadoCita(cita.Estado).clase;
        fila.querySelector('[data-campo="NombreServicio"]').setAttribute('translate', 'no');
        // Atendida sin cobrar: la caja la verá con «?» al buscar al cliente.
        fila.querySelector('[data-pendiente]').hidden = !(cita.Estado === 'Atendida' && !cita.ID_Venta);
        if (['Atendida', 'Cancelada', 'NoAsistio'].indexOf(cita.Estado) !== -1) fila.classList.add('turno--terminado');
        if (actual && cita.ID_Cita === actual.ID_Cita) fila.classList.add('turno--actual');

        fila.querySelector('[data-accion="perfil"]')
          .setAttribute('data-nav', '@perfil?cliente=' + encodeURIComponent(cita.ID_Cliente));

        var siguiente = SIGUIENTE[cita.Estado];
        var boton = fila.querySelector('[data-accion="atencion"]');
        if (siguiente) {
          boton.hidden = false;
          boton.textContent = t(siguiente.texto);
          if (siguiente.estado === 'Atendida') boton.classList.add('boton--primario');
          boton.addEventListener('click', function () { cambiarEstado(cita, siguiente.estado, boton); });
        }
        var falta = fila.querySelector('[data-accion="falta"]');
        if (cita.Estado === 'Agendada' || cita.Estado === 'EnEspera') {
          falta.hidden = false;
          falta.addEventListener('click', async function () {
            if (!(await U.confirmar(t('¿Marcar que {cliente} no asistió a su cita?', { cliente: cita.NombreCliente })))) return;
            cambiarEstado(cita, 'NoAsistio', falta);
          });
        }
      }
    });
    el.citas.hidden = !citas.length;
  }

  /**
   * @param {Object} cita
   * @param {'EnAtencion'|'Atendida'|'NoAsistio'} nuevoEstado
   * @param {HTMLButtonElement} boton
   */
  async function cambiarEstado(cita, nuevoEstado, boton) {
    try {
      await U.conCarga(boton, Api.citas.cambiarEstado(cita.ID_Cita, nuevoEstado));
      U.aviso({ Atendida: 'Atención finalizada: el cliente pasa a caja.', EnAtencion: 'Atención iniciada.', NoAsistio: 'Cita marcada como «No asistió».' }[nuevoEstado]);
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
  el.avisosLeidos.addEventListener('click', marcarLeidos);
  el.botonFlotante.addEventListener('click', function () { alternarAccesos(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') alternarAccesos(false); });

  cargarAvisos();
  moverFecha(0);

  // Si desde la caja u otro equipo agendan, cancelan o cobran una cita, la lista se actualiza sola.
  Api.alCambiar(['citas'], function () { cargarCitas(true); cargarAvisos(); });
})();
