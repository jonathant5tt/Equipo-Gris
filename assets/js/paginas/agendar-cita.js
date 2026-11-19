/**
 * @file paginas/agendar-cita.js
 * @description Controlador de «Agendar cita» (agendar-cita.html).
 *
 * Flujo:
 *   1. Carga barberos y servicios.                    GET /barberos · GET /servicios
 *   2. Barbero (y servicio) → estado de la semana.    GET /citas/dias
 *   3. Día → bloques del día.                         GET /citas/disponibilidad
 *   4. Hora libre + cliente + servicio → confirmar.   POST /citas
 *   5. El servidor envía el resumen por WhatsApp; si la API no está
 *      configurada, se ofrece el botón «Enviar por WhatsApp» (enlace wa.me).
 *
 * Si el cliente no existe se registra en nuevo-cliente.html y se regresa con
 * ?cliente=ID; el barbero, día, hora y servicio elegidos se recuperan del
 * borrador guardado en sessionStorage.
 *
 * Reglas (las valida también el servidor):
 *   - Solo se eligen bloques «Libre» donde cabe la duración del servicio.
 *   - Un servicio con días específicos solo se agenda esos días.
 */
(function () {
  'use strict';

  if (!window.Sesion.permitida) return;

  var U = window.Utilidades;
  var Api = window.Api;
  var t = window.Idioma.t;
  var LOCALE = window.Idioma.locale;

  var TEXTO_ESTADO = { Libre: 'Libre', Ocupado: 'Ocupado', Comida: 'Comida', NoDisponible: 'No disponible' };
  var NOMBRE_DIA = { L: 'Lun', M: 'Mar', X: 'Mié', J: 'Jue', V: 'Vie', S: 'Sáb', D: 'Dom' };

  var hoy = U.fechaISO();
  var estado = {
    barberos: [], servicios: [],
    barbero: null, servicio: null, cliente: null,
    semanaInicio: hoy, fecha: hoy, hora: null,
    dia: null, ultimaCita: null
  };

  // ---------------------------------------------------------------------------
  // Borrador (se conserva al ir a registrar un cliente nuevo)
  // ---------------------------------------------------------------------------
  var CLAVE_BORRADOR = 'engreidos.borrador-cita';

  function guardarBorrador() {
    try {
      window.sessionStorage.setItem(CLAVE_BORRADOR, JSON.stringify({
        barbero: estado.barbero && estado.barbero.ID_Barbero, servicio: estado.servicio && estado.servicio.ID_Servicio,
        fecha: estado.fecha, semanaInicio: estado.semanaInicio, hora: estado.hora, guardado: Date.now()
      }));
    } catch (e) { /* sin almacenamiento */ }
  }

  function borrarBorrador() { try { window.sessionStorage.removeItem(CLAVE_BORRADOR); } catch (e) { /* nada */ } }

  /** Borrador reciente (30 min) solo al volver del registro de un cliente. */
  function leerBorrador() {
    if (!U.parametro('cliente')) return null;
    try {
      var b = JSON.parse(window.sessionStorage.getItem(CLAVE_BORRADOR) || 'null');
      return b && Date.now() - b.guardado < 30 * 60 * 1000 ? b : null;
    } catch (e) { return null; }
  }

  var borrador = leerBorrador();
  if (borrador && borrador.fecha >= hoy) {
    estado.fecha = borrador.fecha;
    estado.semanaInicio = borrador.semanaInicio >= hoy ? borrador.semanaInicio : hoy;
    estado.hora = borrador.hora;
  }

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    jornada: $('jornada'), jornadaHoras: $('jornada-horas'), jornadaComida: $('jornada-comida'),
    barberosCargando: $('barberos-cargando'), barberosVacio: $('barberos-vacio'), listaBarberos: $('lista-barberos'),
    fechaTexto: $('fecha-texto'), semana: $('semana'), diaMotivo: $('dia-motivo'),
    semanaAnterior: $('semana-anterior'), semanaSiguiente: $('semana-siguiente'), diaHoy: $('dia-hoy'),
    cuposLibres: $('cupos-libres'), horariosCargando: $('horarios-cargando'), horariosVacio: $('horarios-vacio'),
    listaHorarios: $('lista-horarios'),
    comprobante: $('comprobante'), resumenHora: $('resumen-hora'), resumenFecha: $('resumen-fecha'),
    resumenDuracion: $('resumen-duracion'), resumenBarbero: $('resumen-barbero'),
    resumenCliente: $('resumen-cliente'), resumenServicio: $('resumen-servicio'),
    clienteElegido: $('cliente-elegido'), cambiarCliente: $('cambiar-cliente'), buscador: $('buscador'),
    serviciosCargando: $('servicios-cargando'), serviciosVacio: $('servicios-vacio'), listaServicios: $('lista-servicios'),
    confirmar: $('confirmar'), limpiar: $('limpiar'),
    modal: $('cita-lista'), estadoWhatsapp: $('estado-whatsapp'), comprobanteFinal: $('comprobante-final'),
    enviarWhatsapp: $('enviar-whatsapp'), nuevaCita: $('nueva-cita')
  };

  // ---------------------------------------------------------------------------
  // Barberos
  // ---------------------------------------------------------------------------

  /** Carga los barberos registrados.  GET /barberos */
  async function cargarBarberos() {
    try { estado.barberos = (await Api.barberos.listar()) || []; }
    catch (error) { estado.barberos = []; U.aviso(error.message, 'error'); }
    el.barberosCargando.hidden = true;
    U.dibujarLista({
      contenedor: el.listaBarberos, plantilla: 'plantilla-barbero', datos: estado.barberos, vacio: el.barberosVacio,
      alCrear: function (boton, barbero) { boton.addEventListener('click', function () { elegirBarbero(barbero); }); }
    });
    // El barbero del borrador, o el que agenda desde su app, se preselecciona.
    var guardado = borrador && estado.barberos.find(function (b) { return b.ID_Barbero === borrador.barbero; });
    var propio = window.Sesion.rol() === window.Sesion.ROLES.BARBERO
      ? estado.barberos.find(function (b) { return b.ID_Barbero === window.Sesion.usuario().id; }) : null;
    if (guardado || propio || estado.barberos.length === 1) elegirBarbero(guardado || propio || estado.barberos[0]);
  }

  /** @param {Object} barbero */
  function elegirBarbero(barbero) {
    estado.barbero = barbero;
    el.listaBarberos.querySelectorAll('.barbero-opcion').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-id') === String(barbero.ID_Barbero)));
    });
    el.jornadaHoras.textContent = U.formatoHora(barbero.HoraEntrada) + ' – ' + U.formatoHora(barbero.HoraSalida);
    el.jornadaComida.textContent = barbero.ComidaInicio
      ? '· ' + t('Comida') + ' ' + U.formatoHora(barbero.ComidaInicio) + ' – ' + U.formatoHora(barbero.ComidaFin) : '';
    el.jornada.hidden = false;
    cargarSemana();
    cargarHorarios();
  }

  // ---------------------------------------------------------------------------
  // Semana y día
  // ---------------------------------------------------------------------------

  /** Estado de cada día de la semana visible.  GET /citas/dias */
  async function cargarSemana() {
    var dias = [];
    if (estado.barbero) {
      try {
        dias = (await Api.citas.dias(estado.barbero.ID_Barbero, estado.semanaInicio, 7,
          estado.servicio && estado.servicio.ID_Servicio)) || [];
      } catch (error) { U.aviso(error.message, 'error'); }
    }
    if (!dias.length) {
      dias = Array.from({ length: 7 }, function (_, i) { return { Fecha: U.sumarDias(estado.semanaInicio, i), Estado: '' }; });
    }
    estado.dias = dias;
    U.dibujarLista({
      contenedor: el.semana, plantilla: 'plantilla-dia',
      datos: dias.map(function (d) {
        var f = U.aFecha(d.Fecha);
        return {
          Nombre: f.toLocaleDateString(LOCALE, { weekday: 'short' }).replace('.', ''),
          Numero: f.getDate(),
          EstadoTexto: TEXTO_ESTADO[d.Estado] || ''
        };
      }),
      alCrear: function (boton, d, i) {
        var dia = dias[i];
        boton.setAttribute('data-estado', dia.Estado || '');
        boton.setAttribute('data-fecha', dia.Fecha);
        boton.setAttribute('aria-pressed', String(dia.Fecha === estado.fecha));
        boton.title = U.formatoFechaLarga(dia.Fecha) + (dia.Motivo ? ' · ' + t(dia.Motivo) : '');
        boton.addEventListener('click', function () { elegirDia(dia.Fecha); });
      }
    });
    el.semana.hidden = false;
    el.semanaAnterior.disabled = estado.semanaInicio <= hoy;
    mostrarMotivoDia();
  }

  function mostrarMotivoDia() {
    var dia = (estado.dias || []).find(function (d) { return d.Fecha === estado.fecha; });
    el.fechaTexto.textContent = U.formatoFechaLarga(estado.fecha);
    el.diaMotivo.hidden = !(dia && dia.Motivo);
    if (dia && dia.Motivo) el.diaMotivo.textContent = t(dia.Motivo);
  }

  /** @param {string} fecha "AAAA-MM-DD" */
  function elegirDia(fecha) {
    estado.fecha = fecha;
    el.semana.querySelectorAll('.dia').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-fecha') === fecha)); });
    mostrarMotivoDia();
    cargarHorarios();
  }

  /** @param {number} dias  +7 / −7; 0 = volver a hoy. */
  function moverSemana(dias) {
    estado.semanaInicio = dias === 0 ? hoy : U.sumarDias(estado.semanaInicio, dias);
    if (estado.semanaInicio < hoy) estado.semanaInicio = hoy;
    estado.fecha = estado.semanaInicio;
    estado.hora = null;
    cargarSemana();
    cargarHorarios();
  }

  // ---------------------------------------------------------------------------
  // Horarios del día
  // ---------------------------------------------------------------------------

  function mostrarVacioHorarios(titulo, detalle) {
    el.horariosVacio.querySelector('[data-titulo]').textContent = t(titulo);
    el.horariosVacio.querySelector('[data-detalle]').textContent = t(detalle);
    el.horariosVacio.hidden = false;
    el.listaHorarios.hidden = true;
    el.cuposLibres.hidden = true;
  }

  /** Bloques del barbero y día elegidos.  GET /citas/disponibilidad */
  async function cargarHorarios(silencioso) {
    if (!estado.barbero) { actualizarResumen(); return; }
    if (silencioso !== true) {
      el.horariosCargando.hidden = false;
      el.horariosVacio.hidden = true;
    }
    var dia = null;
    try {
      dia = await Api.citas.disponibilidad(estado.barbero.ID_Barbero, estado.fecha, estado.servicio && estado.servicio.ID_Servicio);
    } catch (error) { U.aviso(error.message, 'error'); }
    el.horariosCargando.hidden = true;
    estado.dia = dia;

    // La hora elegida se conserva solo si sigue disponible.
    var bloques = (dia && dia.Bloques) || [];
    if (estado.hora && !bloques.some(function (b) { return b.Hora === estado.hora && b.Cabe; })) estado.hora = null;

    if (!dia || !bloques.length) {
      mostrarVacioHorarios('Sin horarios para este día', (dia && dia.Motivo) || 'El barbero no trabaja en esta fecha.');
    } else {
      dibujarHorarios(dia);
    }
    actualizarResumen();
  }

  /** Dibuja la cuadrícula: Libre, Ocupado, Comida y No disponible. */
  function dibujarHorarios(dia) {
    var duracion = dia.DuracionMin;
    U.dibujarLista({
      contenedor: el.listaHorarios, plantilla: 'plantilla-horario', vacio: el.horariosVacio,
      datos: dia.Bloques.map(function (b) {
        var visual = b.Estado === 'NoDisponible' && b.Motivo === 'Comida' ? 'Comida' : b.Estado;
        var detalle = '';
        if (visual === 'Ocupado') detalle = [b.NombreCliente, b.NombreServicio].filter(Boolean).join(' · ');
        else if (visual === 'Comida') detalle = t('Horario de comida');
        else if (visual === 'NoDisponible') detalle = t(b.Motivo || '');
        else if (!b.Cabe) detalle = t('Sin espacio para {n} min', { n: duracion });
        return { Hora: U.formatoHora(b.Hora), Visual: visual, EstadoTexto: TEXTO_ESTADO[visual], Detalle: detalle };
      }),
      alCrear: function (boton, h, i) {
        var bloque = dia.Bloques[i];
        boton.setAttribute('data-estado', h.Visual);
        var elegible = bloque.Estado === 'Libre' && bloque.Cabe;
        boton.setAttribute('aria-disabled', String(!elegible));
        boton.setAttribute('aria-pressed', String(elegible && bloque.Hora === estado.hora));
        boton.setAttribute('aria-label', h.Hora + ', ' + t(h.EstadoTexto) + (h.Detalle ? ', ' + h.Detalle : ''));
        if (elegible) boton.addEventListener('click', function () { elegirHora(bloque.Hora, boton); });
      }
    });
    el.cuposLibres.querySelector('[data-texto]').textContent = dia.Libres === 1 ? t('1 horario libre') : t('{n} horarios libres', { n: dia.Libres });
    el.cuposLibres.hidden = false;
  }

  function elegirHora(hora, boton) {
    estado.hora = hora;
    el.listaHorarios.querySelectorAll('.horario').forEach(function (b) { b.setAttribute('aria-pressed', String(b === boton)); });
    actualizarResumen();
  }

  // ---------------------------------------------------------------------------
  // Cliente
  // ---------------------------------------------------------------------------

  /** @param {Object|null} cliente */
  function elegirCliente(cliente) {
    estado.cliente = cliente;
    el.clienteElegido.hidden = !cliente;
    el.buscador.hidden = !!cliente;
    if (cliente) {
      U.llenar(el.clienteElegido, cliente);
      el.clienteElegido.querySelector('.fila__titulo').classList.toggle('texto-membresia', !!cliente.MembresiaActiva);
    } else {
      el.buscador.limpiar();
      el.buscador.enfocar();
    }
    actualizarResumen();
  }

  async function clienteDesdeURL() {
    var id = U.parametro('cliente');
    if (!id) return;
    try { elegirCliente(await Api.clientes.obtener(id)); } catch (error) { U.aviso(error.message, 'error'); }
  }

  // ---------------------------------------------------------------------------
  // Servicios
  // ---------------------------------------------------------------------------

  /** Catálogo de servicios.  GET /servicios */
  async function cargarServicios() {
    try { estado.servicios = (await Api.catalogos.servicios()) || []; }
    catch (error) { estado.servicios = []; U.aviso(error.message, 'error'); }
    el.serviciosCargando.hidden = true;
    U.dibujarLista({
      contenedor: el.listaServicios, plantilla: 'plantilla-servicio', vacio: el.serviciosVacio,
      datos: estado.servicios.map(function (s) {
        var dias = s.DiasDisponibles ? ' · ' + t('Solo') + ' ' + s.DiasDisponibles.split(',').map(function (d) { return t(NOMBRE_DIA[d]); }).join(', ') : '';
        return Object.assign({}, s, { Detalle: s.DuracionMin + ' min' + dias });
      }),
      alCrear: function (boton, s) {
        var servicio = estado.servicios.find(function (x) { return x.ID_Servicio === s.ID_Servicio; });
        boton.addEventListener('click', function () { elegirServicio(servicio); });
      }
    });
    var guardado = borrador && estado.servicios.find(function (x) { return x.ID_Servicio === borrador.servicio; });
    if (guardado) elegirServicio(guardado);
  }

  function elegirServicio(servicio) {
    estado.servicio = servicio;
    el.listaServicios.querySelectorAll('.servicio-opcion').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-id') === String(servicio.ID_Servicio)));
    });
    // La duración y los días del servicio cambian la disponibilidad.
    cargarSemana();
    cargarHorarios();
  }

  // ---------------------------------------------------------------------------
  // Resumen y confirmación
  // ---------------------------------------------------------------------------

  function actualizarResumen() {
    el.resumenHora.textContent = estado.hora ? U.formatoHora(estado.hora) : '--:--';
    el.resumenFecha.textContent = U.formatoFechaLarga(estado.fecha);
    el.resumenDuracion.textContent = estado.servicio ? estado.servicio.DuracionMin + ' ' + t('minutos') : '—';
    el.resumenBarbero.textContent = estado.barbero ? estado.barbero.Nombre : '—';
    el.resumenCliente.textContent = estado.cliente ? estado.cliente.Nombre : '—';
    el.resumenServicio.textContent = estado.servicio ? estado.servicio.NombreServicio : '—';
    el.confirmar.disabled = !(estado.barbero && estado.servicio && estado.hora && estado.cliente);
    guardarBorrador();
  }

  /** Guarda la cita.  POST /citas (409 = el horario se ocupó mientras tanto) */
  async function confirmarCita() {
    try {
      var cita = await U.conCarga(el.confirmar, Api.citas.crear({
        ID_Cliente: estado.cliente.ID_Cliente,
        ID_Barbero: estado.barbero.ID_Barbero,
        ID_Servicio: estado.servicio.ID_Servicio,
        FechaHora: estado.fecha + 'T' + estado.hora
      }));
      estado.ultimaCita = cita;
      borrarBorrador();
      mostrarConfirmacion(cita);
    } catch (error) {
      U.aviso(error.message, 'error');
      if (error.estado === 409) { cargarSemana(); cargarHorarios(); }
    }
  }

  /** Ventana con el comprobante y el resultado del envío por WhatsApp. */
  function mostrarConfirmacion(cita) {
    el.comprobanteFinal.innerHTML = el.comprobante.innerHTML;
    var w = cita.WhatsApp || {};
    if (w.Enviado) {
      el.estadoWhatsapp.textContent = t('El resumen se envió por WhatsApp al {tel}.', { tel: U.formatoTelefono(cita.TelefonoCliente) });
      el.enviarWhatsapp.hidden = true;
    } else {
      el.estadoWhatsapp.textContent = w.Configurado
        ? t('No se pudo enviar automáticamente ({error}). Envíalo con el botón.', { error: w.Error || '—' })
        : t('Envía el resumen al cliente con el botón de WhatsApp.');
      el.enviarWhatsapp.hidden = !w.Enlace;
    }
    el.modal.hidden = false;
    el.nuevaCita.focus();
  }

  function limpiar() {
    borrarBorrador();
    estado.hora = null;
    estado.servicio = null;
    el.listaServicios.querySelectorAll('.servicio-opcion').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
    elegirCliente(null);
    cargarSemana();
    cargarHorarios();
  }

  // ---- Arranque ---------------------------------------------------------------
  el.semanaAnterior.addEventListener('click', function () { moverSemana(-7); });
  el.semanaSiguiente.addEventListener('click', function () { moverSemana(7); });
  el.diaHoy.addEventListener('click', function () { moverSemana(0); });
  el.buscador.addEventListener('cliente:elegido', function (e) { elegirCliente(e.detail.cliente); });
  el.cambiarCliente.addEventListener('click', function () { elegirCliente(null); });
  el.confirmar.addEventListener('click', confirmarCita);
  el.limpiar.addEventListener('click', limpiar);
  el.enviarWhatsapp.addEventListener('click', function () {
    if (estado.ultimaCita && estado.ultimaCita.WhatsApp) U.abrirExterno(estado.ultimaCita.WhatsApp.Enlace);
  });
  el.nuevaCita.addEventListener('click', function () { el.modal.hidden = true; limpiar(); });

  cargarSemana();
  actualizarResumen();
  cargarBarberos();
  cargarServicios();
  clienteDesdeURL();

  // Otra persona agendó o canceló: los horarios libres se actualizan solos.
  Api.alCambiar(['citas'], function () { if (el.modal.hidden) { cargarSemana(); cargarHorarios(true); } });
})();
