/**
 * @file paginas/barbero-mi-horario.js
 * @description Controlador de «Mi horario y roles» (barbero-mi-horario.html).
 *
 * Flujo:
 *   1. Consulta la jornada del barbero con sesión.   GET /barberos/yo → Barbero
 *   2. Dibuja la jornada, los días de trabajo/descanso y las actividades.
 * Es de solo lectura: los cambios los hace el Dueño en personal-horarios.html.
 */
(function () {
  'use strict';

  if (!window.Sesion.permitida) return;

  var U = window.Utilidades;
  var Api = window.Api;

  /** Días en orden L…D. `indice` corresponde a Date.getDay() (0 = domingo). */
  var DIAS = [
    { letra: 'L', nombre: 'Lunes', indice: 1 },
    { letra: 'M', nombre: 'Martes', indice: 2 },
    { letra: 'X', nombre: 'Miércoles', indice: 3 },
    { letra: 'J', nombre: 'Jueves', indice: 4 },
    { letra: 'V', nombre: 'Viernes', indice: 5 },
    { letra: 'S', nombre: 'Sábado', indice: 6 },
    { letra: 'D', nombre: 'Domingo', indice: 0 }
  ];

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    cargando: $('horario-cargando'),
    vacio: $('horario-vacio'),
    horario: $('horario'),
    estadoHoy: $('estado-hoy'),
    jornada: $('jornada'),
    numeroDias: $('numero-dias'),
    dias: $('dias'),
    diasDescanso: $('dias-descanso'),
    roles: $('roles'),
    rolesVacio: $('roles-vacio')
  };

  /** @param {Object} barbero  Registro de BARBERO. */
  function pintar(barbero) {
    var trabajo = String(barbero.DiasTrabajo || '').split(',').map(function (d) { return d.trim().toUpperCase(); });
    var hoy = new Date().getDay();
    var trabajaHoy = DIAS.some(function (d) { return d.indice === hoy && trabajo.indexOf(d.letra) !== -1; });

    // Jornada
    U.llenar(el.jornada, Object.assign({}, barbero, {
      Comida: barbero.ComidaInicio ? U.formatoHora(barbero.ComidaInicio) + ' – ' + U.formatoHora(barbero.ComidaFin) : 'Sin horario'
    }));
    el.estadoHoy.className = 'insignia ' + (trabajaHoy ? 'insignia--exito' : 'insignia--alerta');
    el.estadoHoy.querySelector('[data-texto]').textContent = trabajaHoy ? 'Hoy activo' : 'Hoy descansas';

    // Días
    el.dias.replaceChildren();
    DIAS.forEach(function (d) {
      var li = document.createElement('li');
      var laboral = trabajo.indexOf(d.letra) !== -1;
      li.className = 'dia' + (laboral ? ' dia--laboral' : '') + (d.indice === hoy ? ' dia--hoy' : '');
      li.textContent = d.letra;
      li.title = d.nombre + (laboral ? ': laboral' : ': descanso');
      li.setAttribute('aria-label', li.title);
      el.dias.appendChild(li);
    });
    var laborales = DIAS.filter(function (d) { return trabajo.indexOf(d.letra) !== -1; }).length;
    el.numeroDias.textContent = laborales + (laborales === 1 ? ' día laboral' : ' días laborales');
    var descanso = DIAS.filter(function (d) { return trabajo.indexOf(d.letra) === -1; }).map(function (d) { return d.nombre; });
    el.diasDescanso.textContent = descanso.length ? descanso.join(', ') : 'Ninguno';

    // Roles / actividades (texto separado por comas)
    var actividades = String(barbero.RolesActividades || '').split(',')
      .map(function (a) { return a.trim(); }).filter(Boolean)
      .map(function (a) { return { Actividad: a }; });
    U.dibujarLista({ contenedor: el.roles, plantilla: 'plantilla-rol', datos: actividades, vacio: el.rolesVacio });
  }

  /** Consulta la jornada del barbero con sesión y la dibuja (o muestra el estado vacío). */
  async function cargar() {
    var barbero = null;
    try { barbero = await Api.barberos.yo(); }
    catch (error) { U.aviso(error.message, 'error'); }

    el.cargando.hidden = true;
    el.vacio.hidden = !!barbero;
    el.horario.hidden = !barbero;
    if (barbero) pintar(barbero);
  }

  cargar();
})();
