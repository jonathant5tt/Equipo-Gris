/**
 * @file paginas/personal-horarios.js
 * @description Controlador de «Personal y horarios» (personal-horarios.html).
 *
 * Flujo:
 *   1. Lista los barberos con su jornada.          GET /barberos
 *   2. «Editar» llena el formulario; al guardar:   PUT /barberos/:id/horario
 *   3. «Historial» muestra servicios e ingresos.   GET /barberos/:id/ingresos?dias=7
 *
 * Formato de DiasTrabajo: letras separadas por coma en orden L,M,X,J,V,S,D
 * (X = miércoles, D = domingo). Los días que no aparecen son de descanso.
 */
(function () {
  'use strict';

  if (!window.Sesion.permitida) return;

  var U = window.Utilidades;
  var Api = window.Api;

  /** Orden y nombre de los días de la semana. */
  var DIAS = [
    ['L', 'Lunes'], ['M', 'Martes'], ['X', 'Miércoles'], ['J', 'Jueves'],
    ['V', 'Viernes'], ['S', 'Sábado'], ['D', 'Domingo']
  ];
  var DIAS_HISTORIAL = 7;

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    numeroBarberos: $('numero-barberos'),
    cargando: $('barberos-cargando'),
    vacio: $('barberos-vacio'),
    tabla: $('barberos-tabla'),
    filas: $('barberos-filas'),
    ingresosBarbero: $('ingresos-barbero'),
    ingresosVacio: $('ingresos-vacio'),
    ingresosTabla: $('ingresos-tabla'),
    ingresosFilas: $('ingresos-filas'),
    ingresosTotal: $('ingresos-total'),
    nombreEdicion: $('nombre-edicion'),
    edicionVacio: $('edicion-vacio'),
    formulario: $('formulario-horario'),
    entrada: $('hora-entrada'),
    salida: $('hora-salida'),
    comidaInicio: $('comida-inicio'),
    comidaFin: $('comida-fin'),
    roles: $('roles'),
    diasActivos: $('dias-activos'),
    textoDescanso: $('texto-descanso'),
    error: $('error-horario'),
    guardar: $('guardar'),
    cancelar: $('cancelar')
  };

  var barberos = [];
  var enEdicion = null;   // Barbero que se está editando

  /** "L,M,X" → ["L","M","X"] */
  function listaDias(texto) {
    return String(texto || '').split(',').map(function (d) { return d.trim().toUpperCase(); }).filter(Boolean);
  }

  /** @param {string[]} trabajo  @returns {string} Nombres de los días de descanso. */
  function diasDescanso(trabajo) {
    var descanso = DIAS.filter(function (d) { return trabajo.indexOf(d[0]) === -1; }).map(function (d) { return d[1]; });
    return descanso.length ? descanso.join(', ') : 'Sin descanso';
  }

  // ---------------------------------------------------------------------------
  // Lista de barberos
  // ---------------------------------------------------------------------------

  /** Carga los barberos y dibuja la tabla de programación. */
  async function cargarBarberos() {
    try { barberos = (await Api.barberos.listar()) || []; }
    catch (error) { barberos = []; U.aviso(error.message, 'error'); }
    el.cargando.hidden = true;
    el.numeroBarberos.textContent = barberos.length + (barberos.length === 1 ? ' barbero' : ' barberos');

    U.dibujarLista({
      contenedor: el.filas,
      plantilla: 'plantilla-barbero',
      vacio: el.vacio,
      datos: barberos.map(function (b) {
        return Object.assign({}, b, {
          Jornada: U.formatoHora(b.HoraEntrada) + ' – ' + U.formatoHora(b.HoraSalida),
          Comida: b.ComidaInicio ? U.formatoHora(b.ComidaInicio) + ' – ' + U.formatoHora(b.ComidaFin) : '—',
          Descanso: diasDescanso(listaDias(b.DiasTrabajo))
        });
      }),
      alCrear: function (fila, b) {
        var original = barberos.find(function (x) { return x.ID_Barbero === b.ID_Barbero; });
        fila.querySelector('[data-accion="editar"]').addEventListener('click', function () { editar(original, fila); });
        fila.querySelector('[data-accion="historial"]').addEventListener('click', function () { cargarIngresos(original); });
      }
    });
    el.tabla.hidden = !barberos.length;
    el.filas.hidden = false;
  }

  // ---------------------------------------------------------------------------
  // Edición
  // ---------------------------------------------------------------------------

  /** Marca los días según DiasTrabajo y actualiza el resumen. */
  function pintarDias(trabajo) {
    document.querySelectorAll('[data-dia]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(trabajo.indexOf(b.getAttribute('data-dia')) !== -1));
    });
    actualizarResumenDias();
  }

  /** @returns {string[]} Días marcados, en orden. */
  function diasMarcados() {
    return Array.prototype.filter.call(document.querySelectorAll('[data-dia]'), function (b) {
      return b.getAttribute('aria-pressed') === 'true';
    }).map(function (b) { return b.getAttribute('data-dia'); });
  }

  /** Actualiza el contador de días activos y el texto de descanso. */
  function actualizarResumenDias() {
    var marcados = diasMarcados();
    el.diasActivos.textContent = marcados.length + (marcados.length === 1 ? ' día activo' : ' días activos');
    el.textoDescanso.textContent = 'Descanso: ' + diasDescanso(marcados) + '.';
  }

  /** @param {Object} barbero @param {HTMLElement} fila */
  function editar(barbero, fila) {
    enEdicion = barbero;
    el.filas.querySelectorAll('tr').forEach(function (tr) { tr.removeAttribute('aria-selected'); });
    if (fila) fila.setAttribute('aria-selected', 'true');

    el.nombreEdicion.textContent = '— ' + barbero.Nombre;
    el.entrada.value = U.formatoHora(barbero.HoraEntrada).replace('—', '');
    el.salida.value = U.formatoHora(barbero.HoraSalida).replace('—', '');
    el.comidaInicio.value = barbero.ComidaInicio ? U.formatoHora(barbero.ComidaInicio) : '';
    el.comidaFin.value = barbero.ComidaFin ? U.formatoHora(barbero.ComidaFin) : '';
    el.roles.value = barbero.RolesActividades || '';
    pintarDias(listaDias(barbero.DiasTrabajo));
    el.error.hidden = true;

    el.edicionVacio.hidden = true;
    el.formulario.hidden = false;
    el.entrada.focus();
  }

  /** Cierra el formulario sin guardar. */
  function cancelarEdicion() {
    enEdicion = null;
    el.nombreEdicion.textContent = '';
    el.formulario.hidden = true;
    el.edicionVacio.hidden = false;
    el.filas.querySelectorAll('tr').forEach(function (tr) { tr.removeAttribute('aria-selected'); });
  }

  /** @returns {string|null} Mensaje de error o null si todo es válido. */
  function validar() {
    if (!el.entrada.value || !el.salida.value) return 'Captura la hora de entrada y de salida.';
    if (el.salida.value <= el.entrada.value) return 'La hora de salida debe ser posterior a la de entrada.';
    if (!!el.comidaInicio.value !== !!el.comidaFin.value) return 'Captura el inicio y el fin de la comida, o deja ambos vacíos.';
    if (el.comidaInicio.value && (el.comidaFin.value <= el.comidaInicio.value ||
        el.comidaInicio.value < el.entrada.value || el.comidaFin.value > el.salida.value)) {
      return 'La comida debe quedar dentro de la jornada y terminar después de empezar.';
    }
    if (!diasMarcados().length) return 'Marca al menos un día de trabajo.';
    return null;
  }

  /**
   * Valida y guarda el horario del barbero en edición.
   * @param {SubmitEvent} evento
   */
  async function guardar(evento) {
    evento.preventDefault();
    var error = validar();
    el.error.textContent = error || '';
    el.error.hidden = !error;
    if (error || !enEdicion) return;

    var datos = {
      HoraEntrada: el.entrada.value,
      HoraSalida: el.salida.value,
      ComidaInicio: el.comidaInicio.value || null,
      ComidaFin: el.comidaFin.value || null,
      DiasTrabajo: diasMarcados().join(','),
      RolesActividades: el.roles.value.trim()
    };
    try {
      var r = await U.conCarga(el.guardar, Api.barberos.actualizarHorario(enEdicion.ID_Barbero, datos));
      if (!(r && r.simulado)) { U.aviso('Horario de ' + enEdicion.Nombre + ' actualizado.'); cancelarEdicion(); cargarBarberos(); }
    } catch (e) { U.aviso(e.message, 'error'); }
  }

  // ---------------------------------------------------------------------------
  // Servicios e ingresos
  // ---------------------------------------------------------------------------

  /** @param {Object} barbero */
  async function cargarIngresos(barbero) {
    el.ingresosBarbero.textContent = barbero.Nombre + ' · últimos ' + DIAS_HISTORIAL + ' días';
    var dias = [];
    try { dias = (await Api.barberos.ingresos(barbero.ID_Barbero, DIAS_HISTORIAL)) || []; }
    catch (error) { U.aviso(error.message, 'error'); }

    el.ingresosVacio.querySelector('[data-texto]').textContent = 'Sin servicios registrados en los últimos ' + DIAS_HISTORIAL + ' días.';
    U.dibujarLista({ contenedor: el.ingresosFilas, plantilla: 'plantilla-ingreso', datos: dias, vacio: el.ingresosVacio });
    el.ingresosTabla.hidden = !dias.length;
    el.ingresosFilas.hidden = false;
    U.llenar(el.ingresosTotal, {
      Servicios: dias.reduce(function (s, d) { return s + Number(d.Servicios || 0); }, 0),
      Ingreso: dias.reduce(function (s, d) { return s + Number(d.Ingreso || 0); }, 0)
    });
  }

  // ---- Arranque ---------------------------------------------------------------
  document.querySelectorAll('[data-dia]').forEach(function (b) {
    b.addEventListener('click', function () {
      b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'));
      actualizarResumenDias();
    });
  });
  el.formulario.addEventListener('submit', guardar);
  el.cancelar.addEventListener('click', cancelarEdicion);

  cargarBarberos();
})();
