/**
 * @file paginas/agendar-cita.js
 * @description Controlador de «Agendar cita» (agendar-cita.html).
 *
 * Flujo:
 *   1. Carga barberos y servicios.                GET /barberos, GET /servicios
 *   2. Al elegir barbero o fecha, consulta horarios. GET /citas/disponibilidad
 *   3. El usuario elige un horario «Libre».
 *   4. Busca al cliente por nombre o teléfono.     GET /clientes?buscar=
 *   5. Confirma la cita.                            POST /citas
 *
 * Reglas (las valida también el back end):
 *   - Solo se pueden elegir horarios con Estado = "Libre".
 *   - Origen = "App" si agenda un barbero, "Caja" si agenda cajero o dueño.
 */
(function () {
  'use strict';

  if (!window.Sesion.permitida) return;

  var U = window.Utilidades;
  var Api = window.Api;
  var CFG = window.APP_CONFIG;

  /** Texto que se muestra para cada estado de horario. */
  var TEXTO_ESTADO = { Libre: 'Libre', Ocupado: 'Ocupado', NoDisponible: 'No disponible' };

  /** Estado de la pantalla. */
  var estado = {
    barberos: [],
    servicios: [],
    barbero: null,      // Barbero elegido
    fecha: new Date(),  // Día consultado
    horarios: [],       // Respuesta de disponibilidad
    hora: null,         // "HH:MM" elegida
    cliente: null       // Cliente elegido
  };

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    jornada: $('jornada'),
    barberosCargando: $('barberos-cargando'),
    barberosVacio: $('barberos-vacio'),
    listaBarberos: $('lista-barberos'),
    fechaTexto: $('fecha-texto'),
    diaAnterior: $('dia-anterior'),
    diaSiguiente: $('dia-siguiente'),
    diaHoy: $('dia-hoy'),
    cuposLibres: $('cupos-libres'),
    horariosCargando: $('horarios-cargando'),
    horariosVacio: $('horarios-vacio'),
    listaHorarios: $('lista-horarios'),
    ocupacion: $('ocupacion'),
    barraOcupacion: $('barra-ocupacion'),
    resumenHora: $('resumen-hora'),
    resumenFecha: $('resumen-fecha'),
    resumenBarbero: $('resumen-barbero'),
    resumenDuracion: $('resumen-duracion'),
    clienteElegido: $('cliente-elegido'),
    cambiarCliente: $('cambiar-cliente'),
    clienteBusqueda: $('cliente-busqueda'),
    buscarCliente: $('buscar-cliente'),
    sinResultados: $('clientes-sin-resultados'),
    resultadosClientes: $('resultados-clientes'),
    servicio: $('servicio'),
    servicioDetalle: $('servicio-detalle'),
    confirmar: $('confirmar'),
    limpiar: $('limpiar')
  };

  // ---------------------------------------------------------------------------
  // Barberos
  // ---------------------------------------------------------------------------

  /** Carga la lista de barberos y dibuja una opción por cada uno.  GET /barberos */
  async function cargarBarberos() {
    try { estado.barberos = (await Api.barberos.listar()) || []; }
    catch (error) { estado.barberos = []; U.aviso(error.message, 'error'); }

    el.barberosCargando.hidden = true;
    U.dibujarLista({
      contenedor: el.listaBarberos,
      plantilla: 'plantilla-barbero',
      datos: estado.barberos,
      vacio: el.barberosVacio,
      alCrear: function (boton, barbero) {
        boton.addEventListener('click', function () { elegirBarbero(barbero); });
      }
    });
    if (estado.barberos.length === 1) elegirBarbero(estado.barberos[0]);
  }

  /** @param {Object} barbero */
  function elegirBarbero(barbero) {
    estado.barbero = barbero;
    el.listaBarberos.querySelectorAll('.barbero-opcion').forEach(function (b) {
      b.setAttribute('aria-pressed', String(String(b.getAttribute('data-id')) === String(barbero.ID_Barbero)));
    });

    // Jornada: "09:00–19:00 · Comida 14:00–15:00"
    U.llenar(el.jornada, {
      Jornada: U.formatoHora(barbero.HoraEntrada) + '–' + U.formatoHora(barbero.HoraSalida),
      Comida: barbero.ComidaInicio ? '· Comida ' + U.formatoHora(barbero.ComidaInicio) + '–' + U.formatoHora(barbero.ComidaFin) : ''
    });
    el.jornada.hidden = false;
    cargarHorarios();
  }

  // ---------------------------------------------------------------------------
  // Fecha y horarios
  // ---------------------------------------------------------------------------

  /** @param {number} dias  Días a mover; 0 regresa a hoy. */
  function moverFecha(dias) {
    if (dias === 0) estado.fecha = new Date();
    else estado.fecha = new Date(estado.fecha.getFullYear(), estado.fecha.getMonth(), estado.fecha.getDate() + dias);
    el.fechaTexto.textContent = U.formatoFechaLarga(estado.fecha);
    if (estado.barbero) cargarHorarios();
    actualizarResumen();
  }

  /**
   * Muestra un mensaje en lugar de la cuadrícula.
   * @param {string} titulo
   * @param {string} detalle
   */
  function mostrarVacioHorarios(titulo, detalle) {
    el.horariosVacio.querySelector('[data-titulo]').textContent = titulo;
    el.horariosVacio.querySelector('[data-detalle]').textContent = detalle;
    el.horariosVacio.hidden = false;
    el.listaHorarios.hidden = true;
    el.ocupacion.hidden = true;
    el.cuposLibres.hidden = true;
  }

  /** Consulta los bloques del barbero y día elegidos.  GET /citas/disponibilidad */
  async function cargarHorarios() {
    estado.hora = null;
    actualizarResumen();
    el.horariosCargando.hidden = false;
    el.horariosVacio.hidden = true;

    try {
      estado.horarios = (await Api.citas.disponibilidad(estado.barbero.ID_Barbero, U.fechaISO(estado.fecha))) || [];
    } catch (error) {
      estado.horarios = [];
      U.aviso(error.message, 'error');
    }
    el.horariosCargando.hidden = true;

    if (!estado.horarios.length) {
      mostrarVacioHorarios('Sin horarios para este día', 'El barbero no trabaja en esta fecha o la agenda aún no está configurada.');
      return;
    }
    dibujarHorarios();
  }

  /** Dibuja la cuadrícula de horarios, los cupos libres y la barra de ocupación. */
  function dibujarHorarios() {
    U.dibujarLista({
      contenedor: el.listaHorarios,
      plantilla: 'plantilla-horario',
      vacio: el.horariosVacio,
      datos: estado.horarios.map(function (h) {
        return {
          Hora: U.formatoHora(h.Hora),
          Estado: h.Estado,
          EstadoTexto: TEXTO_ESTADO[h.Estado] || h.Estado,
          // Ocupado: "Nombre · Origen"; No disponible: motivo (comida, descanso)
          Detalle: h.Estado === 'Ocupado' ? [h.NombreCliente, h.Origen].filter(Boolean).join(' · ') : (h.Motivo || '')
        };
      }),
      alCrear: function (boton, h) {
        boton.setAttribute('data-estado', h.Estado);
        var libre = h.Estado === 'Libre';
        boton.setAttribute('aria-disabled', String(!libre));
        boton.setAttribute('aria-label', h.Hora + ', ' + h.EstadoTexto);
        if (libre) boton.addEventListener('click', function () { elegirHora(h.Hora); });
      }
    });

    // Métricas de ocupación
    var total = estado.horarios.filter(function (h) { return h.Estado !== 'NoDisponible'; }).length;
    var ocupados = estado.horarios.filter(function (h) { return h.Estado === 'Ocupado'; }).length;
    var libres = total - ocupados;
    var porcentaje = total ? Math.round((ocupados / total) * 100) : 0;
    U.llenar(el.ocupacion, { Porcentaje: porcentaje + '% de capacidad', Resumen: ocupados + ' de ' + total + ' turnos asignados' });
    el.barraOcupacion.style.width = porcentaje + '%';
    el.ocupacion.hidden = false;
    el.cuposLibres.querySelector('[data-texto]').textContent = libres + (libres === 1 ? ' cupo libre' : ' cupos libres');
    el.cuposLibres.hidden = false;
  }

  /** @param {string} hora "HH:MM" */
  function elegirHora(hora) {
    estado.hora = hora;
    el.listaHorarios.querySelectorAll('.horario').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.querySelector('.horario__hora').textContent === hora));
    });
    actualizarResumen();
  }

  // ---------------------------------------------------------------------------
  // Clientes
  // ---------------------------------------------------------------------------

  var buscarClientes = U.retrasar(async function () {
    var texto = el.buscarCliente.value.trim();
    if (texto.length < 2) {
      el.resultadosClientes.hidden = true;
      el.sinResultados.hidden = true;
      return;
    }
    var clientes = [];
    try { clientes = (await Api.clientes.buscar(texto)) || []; }
    catch (error) { U.aviso(error.message, 'error'); }

    U.dibujarLista({
      contenedor: el.resultadosClientes,
      plantilla: 'plantilla-cliente',
      datos: clientes.slice(0, 6),
      vacio: el.sinResultados,
      alCrear: function (boton, cliente) {
        boton.addEventListener('click', function () { elegirCliente(cliente); });
      }
    });
  }, 300);

  /** @param {Object|null} cliente  null regresa a la búsqueda. */
  function elegirCliente(cliente) {
    estado.cliente = cliente;
    el.clienteElegido.hidden = !cliente;
    el.clienteBusqueda.hidden = !!cliente;
    if (cliente) U.llenar(el.clienteElegido, cliente);
    else { el.buscarCliente.value = ''; el.resultadosClientes.hidden = true; el.sinResultados.hidden = true; el.buscarCliente.focus(); }
    actualizarResumen();
  }

  /** Preselecciona al cliente si la URL trae ?cliente=ID. */
  async function clienteDesdeURL() {
    var id = U.parametro('cliente');
    if (!id) return;
    try {
      var cliente = await Api.clientes.obtener(id);
      if (cliente) elegirCliente(cliente);
    } catch (error) { U.aviso(error.message, 'error'); }
  }

  // ---------------------------------------------------------------------------
  // Servicios
  // ---------------------------------------------------------------------------

  /** Llena el selector de servicios solicitados.  GET /servicios */
  async function cargarServicios() {
    try { estado.servicios = (await Api.catalogos.servicios()) || []; }
    catch (error) { estado.servicios = []; U.aviso(error.message, 'error'); }

    el.servicio.replaceChildren();
    var primera = new Option(estado.servicios.length ? 'Selecciona un servicio' : 'No hay servicios registrados', '');
    el.servicio.add(primera);
    estado.servicios.forEach(function (s) {
      el.servicio.add(new Option(s.NombreServicio + ' — ' + U.formatoMoneda(s.Precio), s.ID_Servicio));
    });
    el.servicio.disabled = !estado.servicios.length;
  }

  /** @returns {Object|null} Servicio elegido en la lista. */
  function servicioElegido() {
    var id = el.servicio.value;
    return estado.servicios.find(function (s) { return String(s.ID_Servicio) === id; }) || null;
  }

  // ---------------------------------------------------------------------------
  // Resumen y confirmación
  // ---------------------------------------------------------------------------

  /** Actualiza la tarjeta «Datos de la cita» y habilita «Confirmar» cuando está completa. */
  function actualizarResumen() {
    var servicio = servicioElegido();
    el.resumenHora.textContent = estado.hora || '--:--';
    el.resumenFecha.textContent = U.formatoFecha(estado.fecha);
    el.resumenBarbero.textContent = estado.barbero ? estado.barbero.Nombre : '—';
    el.resumenDuracion.textContent = (servicio && servicio.DuracionMin ? servicio.DuracionMin : CFG.DURACION_CITA_MIN) + ' minutos';

    el.servicioDetalle.hidden = !servicio;
    if (servicio) U.llenar(el.servicioDetalle, servicio);

    el.confirmar.disabled = !(estado.barbero && estado.hora && estado.cliente);
  }

  /** Registra la cita y vuelve a consultar los horarios.  POST /citas (409 = horario ya ocupado) */
  async function confirmarCita() {
    var servicio = servicioElegido();
    var datos = {
      ID_Cliente: estado.cliente.ID_Cliente,
      ID_Barbero: estado.barbero.ID_Barbero,
      FechaHora: U.fechaISO(estado.fecha) + 'T' + estado.hora + ':00',
      ID_Servicio: servicio ? servicio.ID_Servicio : null,
      Origen: window.Sesion.rol() === window.Sesion.ROLES.BARBERO ? 'App' : 'Caja'
    };
    try {
      var cita = await U.conCarga(el.confirmar, Api.citas.crear(datos));
      if (cita && !cita.simulado) U.aviso('Cita agendada para las ' + estado.hora + '.');
      limpiar();
      cargarHorarios();
    } catch (error) {
      U.aviso(error.message, 'error');
      if (error.estado === 409) cargarHorarios();   // el horario se ocupó mientras tanto
    }
  }

  /** Quita la hora, el cliente y el servicio elegidos. */
  function limpiar() {
    estado.hora = null;
    el.servicio.value = '';
    elegirCliente(null);
    el.listaHorarios.querySelectorAll('.horario').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
    actualizarResumen();
  }

  // ---- Arranque ---------------------------------------------------------------
  el.diaAnterior.addEventListener('click', function () { moverFecha(-1); });
  el.diaSiguiente.addEventListener('click', function () { moverFecha(1); });
  el.diaHoy.addEventListener('click', function () { moverFecha(0); });
  el.buscarCliente.addEventListener('input', buscarClientes);
  el.cambiarCliente.addEventListener('click', function () { elegirCliente(null); });
  el.servicio.addEventListener('change', actualizarResumen);
  el.confirmar.addEventListener('click', confirmarCita);
  el.limpiar.addEventListener('click', limpiar);

  moverFecha(0);
  cargarBarberos();
  cargarServicios();
  clienteDesdeURL();
})();
