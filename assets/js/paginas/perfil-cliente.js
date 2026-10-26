/**
 * @file paginas/perfil-cliente.js
 * @description Controlador compartido del perfil del cliente:
 *   - perfil-cliente.html          (tableta: Cajero y Dueño)
 *   - barbero-perfil-cliente.html  (móvil: Barbero)
 * Los elementos que no existen en una versión simplemente se omiten.
 *
 * Flujo:
 *   1. Busca clientes por nombre o teléfono.     GET /clientes?buscar=
 *   2. Abre la ficha (o la de ?cliente=ID).      GET /clientes/:id
 *   3. Carga historial y fotos.                  GET /clientes/:id/servicios, /fotos
 *   4. Fotos: agregar (POST), eliminar (DELETE) y usar como referencia (PUT).
 */
(function () {
  'use strict';

  if (!window.Sesion.permitida) return;

  var U = window.Utilidades;
  var Api = window.Api;

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    formulario: $('formulario-busqueda'),
    buscar: $('buscar-cliente'),
    sinResultados: $('clientes-sin-resultados'),
    resultados: $('resultados-clientes'),
    vacio: $('perfil-vacio'),
    cargando: $('perfil-cargando'),
    perfil: $('perfil'),
    insigniaMembresia: $('insignia-membresia'),
    sinFotoPrincipal: $('sin-foto-principal'),
    totalVisitas: $('total-visitas'),
    historialVacio: $('historial-vacio'),
    historialTabla: $('historial-tabla'),
    historialFilas: $('historial-filas'),
    gastoPromedio: $('gasto-promedio'),
    fotosVacio: $('fotos-vacio'),
    galeria: $('galeria'),
    subirFoto: $('subir-foto'),
    accionCita: $('accion-cita'),
    accionCobro: $('accion-cobro'),
    visor: $('visor-foto'),
    visorImagen: $('visor-imagen'),
    visorTitulo: $('visor-titulo'),
    visorFecha: $('visor-fecha'),
    visorNotas: $('visor-notas'),
    visorReferencia: $('visor-referencia'),
    visorEliminar: $('visor-eliminar'),
    visorCerrar: $('visor-cerrar')
  };

  var cliente = null;      // Cliente abierto
  var fotoAbierta = null;  // Foto mostrada en el visor

  // ---------------------------------------------------------------------------
  // Búsqueda
  // ---------------------------------------------------------------------------

  /** Busca clientes por nombre o teléfono (mínimo 2 caracteres).  GET /clientes?buscar= */
  async function buscar() {
    var texto = el.buscar.value.trim();
    if (texto.length < 2) { el.resultados.hidden = true; el.sinResultados.hidden = true; return; }
    var lista = [];
    try { lista = (await Api.clientes.buscar(texto)) || []; }
    catch (error) { U.aviso(error.message, 'error'); }
    U.dibujarLista({
      contenedor: el.resultados,
      plantilla: 'plantilla-cliente',
      datos: lista,
      vacio: el.sinResultados,
      alCrear: function (boton, c) {
        boton.addEventListener('click', function () {
          el.resultados.hidden = true;
          el.buscar.value = '';
          abrir(c.ID_Cliente);
        });
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Ficha
  // ---------------------------------------------------------------------------

  /** @param {number|string} id */
  async function abrir(id) {
    el.vacio.hidden = true;
    el.perfil.hidden = true;
    el.cargando.hidden = false;
    try { cliente = await Api.clientes.obtener(id); }
    catch (error) { cliente = null; U.aviso(error.message, 'error'); }
    el.cargando.hidden = true;

    if (!cliente) { el.vacio.hidden = false; return; }
    dibujarDatos();
    el.perfil.hidden = false;
    cargarHistorial();
    cargarFotos();
  }

  /** Llena la ficha del cliente, su foto de referencia y la insignia de membresía. */
  function dibujarDatos() {
    U.llenar(el.perfil, cliente);
    if (el.sinFotoPrincipal) el.sinFotoPrincipal.hidden = !!cliente.FotoCorteReferencia;

    var activa = cliente.EstadoMembresia === 'Activa';
    el.insigniaMembresia.className = 'insignia ' + (activa ? 'insignia--exito' : '');
    el.insigniaMembresia.textContent = activa ? 'Membresía activa' : 'Sin membresía';

    // Las acciones llevan al cliente como parámetro.
    if (el.accionCita) el.accionCita.setAttribute('data-nav', 'agendar-cita.html?cliente=' + encodeURIComponent(cliente.ID_Cliente));
    if (el.accionCobro) el.accionCobro.setAttribute('data-nav', 'registrar-cobro.html?cliente=' + encodeURIComponent(cliente.ID_Cliente));
  }

  /** Dibuja el historial de servicios y el gasto promedio por visita.  GET /clientes/:id/servicios */
  async function cargarHistorial() {
    var servicios = [];
    try { servicios = (await Api.clientes.historial(cliente.ID_Cliente)) || []; }
    catch (error) { U.aviso(error.message, 'error'); }

    var registros = servicios.map(function (s) {
      return Object.assign({}, s, { Importe: Number(s.PrecioUnitario) * Number(s.Cantidad || 1) });
    });
    U.dibujarLista({ contenedor: el.historialFilas, plantilla: 'plantilla-servicio', datos: registros, vacio: el.historialVacio });
    el.historialTabla.hidden = !registros.length;
    el.historialFilas.hidden = false;   // el <tbody> siempre visible; se oculta la tabla completa
    el.totalVisitas.textContent = registros.length + (registros.length === 1 ? ' visita' : ' visitas');

    if (el.gastoPromedio) {
      var total = registros.reduce(function (s, r) { return s + r.Importe; }, 0);
      el.gastoPromedio.hidden = !registros.length;
      U.llenar(el.gastoPromedio, { Promedio: registros.length ? total / registros.length : 0 });
    }
  }

  /** Dibuja la galería de cortes del cliente.  GET /clientes/:id/fotos */
  async function cargarFotos() {
    var fotos = [];
    try { fotos = (await Api.clientes.fotos(cliente.ID_Cliente)) || []; }
    catch (error) { U.aviso(error.message, 'error'); }
    U.dibujarLista({
      contenedor: el.galeria,
      plantilla: 'plantilla-foto',
      datos: fotos,
      vacio: el.fotosVacio,
      alCrear: function (boton, foto) {
        boton.addEventListener('click', function () { abrirVisor(foto); });
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Fotos
  // ---------------------------------------------------------------------------

  /** Sube la foto elegida al expediente del cliente.  POST /clientes/:id/fotos (multipart) */
  async function subirFoto() {
    var archivo = el.subirFoto.files && el.subirFoto.files[0];
    if (!archivo || !cliente) return;
    var datos = new FormData();
    datos.append('foto', archivo);
    try {
      var r = await Api.clientes.subirFoto(cliente.ID_Cliente, datos);
      if (!(r && r.simulado)) { U.aviso('Foto agregada.'); cargarFotos(); }
    } catch (error) { U.aviso(error.message, 'error'); }
    el.subirFoto.value = '';
  }

  /** @param {Object} foto */
  function abrirVisor(foto) {
    if (!el.visor) return;
    fotoAbierta = foto;
    el.visorImagen.src = foto.Url;
    el.visorImagen.alt = foto.Titulo || 'Foto de corte';
    el.visorTitulo.textContent = foto.Titulo || 'Corte';
    el.visorFecha.textContent = U.formatoFecha(foto.Fecha) + (foto.NombreBarbero ? ' · ' + foto.NombreBarbero : '');
    el.visorNotas.textContent = foto.Notas || 'Sin notas del barbero.';
    el.visor.hidden = false;
    el.visorCerrar.focus();
  }

  /** Cierra el visor de fotos. */
  function cerrarVisor() { if (el.visor) { el.visor.hidden = true; fotoAbierta = null; } }

  /** Marca la foto abierta como corte de referencia.  PUT /clientes/:id/foto-referencia */
  async function usarComoReferencia() {
    try {
      var r = await U.conCarga(el.visorReferencia, Api.clientes.usarComoReferencia(cliente.ID_Cliente, fotoAbierta.ID_Foto));
      if (!(r && r.simulado)) {
        cliente.FotoCorteReferencia = fotoAbierta.Url;
        dibujarDatos();
        U.aviso('Foto de referencia actualizada.');
      }
      cerrarVisor();
    } catch (error) { U.aviso(error.message, 'error'); }
  }

  /** Elimina la foto abierta previa confirmación.  DELETE /clientes/:id/fotos/:idFoto */
  async function eliminarFoto() {
    if (!(await U.confirmar('¿Eliminar esta foto del expediente del cliente?'))) return;
    try {
      var r = await U.conCarga(el.visorEliminar, Api.clientes.eliminarFoto(cliente.ID_Cliente, fotoAbierta.ID_Foto));
      cerrarVisor();
      if (!(r && r.simulado)) { U.aviso('Foto eliminada.'); cargarFotos(); }
    } catch (error) { U.aviso(error.message, 'error'); }
  }

  // ---- Arranque ---------------------------------------------------------------
  el.formulario.addEventListener('submit', function (e) { e.preventDefault(); buscar(); });
  el.buscar.addEventListener('input', U.retrasar(buscar, 350));
  if (el.subirFoto) el.subirFoto.addEventListener('change', subirFoto);
  if (el.visor) {
    el.visorCerrar.addEventListener('click', cerrarVisor);
    el.visorReferencia.addEventListener('click', usarComoReferencia);
    el.visorEliminar.addEventListener('click', eliminarFoto);
    el.visor.addEventListener('click', function (e) { if (e.target === el.visor) cerrarVisor(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') cerrarVisor(); });
  }
  document.querySelectorAll('label[for="subir-foto"]').forEach(function (etiqueta) {
    etiqueta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.subirFoto.click(); }
    });
  });

  var idInicial = U.parametro('cliente');
  if (idInicial) abrir(idInicial);
})();
