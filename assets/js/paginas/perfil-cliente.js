/**
 * @file paginas/perfil-cliente.js
 * @description Controlador compartido del perfil del cliente:
 *   - perfil-cliente.html          (tableta: Cajero y Dueño)
 *   - barbero-perfil-cliente.html  (móvil: Barbero)
 * Los elementos que no existen en una versión simplemente se omiten.
 *
 * Flujo:
 *   1. <buscador-cliente> muestra la vista previa mientras se escribe
 *      (membresía vigente en dorado). Al elegir uno se abre su ficha.
 *   2. Filtro + «Buscar»: recientes, primeros o con membresía.
 *                                               GET /clientes?buscar=&filtro=
 *   3. Ficha completa (o la de ?cliente=ID).    GET /clientes/:id
 *      Puntualidad = asistencias / (asistencias + faltas).
 *   4. Historial y fotos.                       GET /clientes/:id/servicios, /fotos
 *   5. Fotos: agregar (POST, cámara o galería), eliminar (DELETE), usar como
 *      referencia (PUT), eliminar la principal (DELETE /foto-referencia) y
 *      verlas a pantalla completa.
 */
(function () {
  'use strict';

  if (!window.Sesion.permitida) return;

  var U = window.Utilidades;
  var Api = window.Api;
  var t = window.Idioma.t;

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    buscador: $('buscador'), filtro: $('filtro'), buscar: $('buscar'),
    sinResultados: $('clientes-sin-resultados'), resultados: $('resultados-clientes'),
    vacio: $('perfil-vacio'), cargando: $('perfil-cargando'), perfil: $('perfil'),
    nombre: $('nombre-cliente'), insigniaMembresia: $('insignia-membresia'),
    fotoPrincipal: $('foto-principal'), sinFotoPrincipal: $('sin-foto-principal'),
    accionesFoto: $('acciones-foto'), fotoCompleta: $('foto-completa'), fotoEliminar: $('foto-eliminar'),
    datoMembresia: $('dato-membresia'), datoPuntualidad: $('dato-puntualidad'),
    datoFaltas: $('dato-faltas'), datoProxima: $('dato-proxima'),
    totalVisitas: $('total-visitas'), historialVacio: $('historial-vacio'),
    historialTabla: $('historial-tabla'), historialFilas: $('historial-filas'), gastoPromedio: $('gasto-promedio'),
    fotosVacio: $('fotos-vacio'), galeria: $('galeria'), subirFoto: $('subir-foto'),
    accionCita: $('accion-cita'), accionCobro: $('accion-cobro'),
    visor: $('visor-foto'), visorImagen: $('visor-imagen'), visorTitulo: $('visor-titulo'),
    visorFecha: $('visor-fecha'), visorNotas: $('visor-notas'),
    visorReferencia: $('visor-referencia'), visorEliminar: $('visor-eliminar'), visorCerrar: $('visor-cerrar')
  };

  var cliente = null;      // Cliente abierto
  var fotos = [];          // Fotos del cliente abierto
  var fotoAbierta = null;  // Foto mostrada en el visor

  // ---------------------------------------------------------------------------
  // Búsqueda y filtro
  // ---------------------------------------------------------------------------

  /** Texto secundario de cada cliente en la lista de resultados. */
  function detalleCliente(c) {
    var partes = [U.formatoTelefono(c.Telefono)];
    if (c.MembresiaActiva) partes.push((c.NombrePlan || t('Membresía')) + ' · ' + t('vence') + ' ' + U.formatoFecha(c.FechaVencimiento));
    else partes.push(t('Desde') + ' ' + U.formatoFecha(c.FechaRegistro));
    return partes.join(' · ');
  }

  /** Busca con el filtro elegido y el texto escrito (si lo hay).  GET /clientes?buscar=&filtro= */
  async function buscar() {
    var texto = el.buscador.entrada ? el.buscador.entrada.value.trim() : '';
    if (el.buscador.cerrar) el.buscador.cerrar();
    var lista = [];
    try {
      lista = (await U.conCarga(el.buscar, Api.clientes.buscar({ buscar: texto || undefined, filtro: el.filtro.value || undefined, limite: 60 }))) || [];
    } catch (error) { U.aviso(error.message, 'error'); }
    U.dibujarLista({
      contenedor: el.resultados,
      plantilla: 'plantilla-cliente',
      datos: lista.map(function (c) { return Object.assign({}, c, { Detalle: detalleCliente(c) }); }),
      vacio: el.sinResultados,
      alCrear: function (boton, c) {
        boton.querySelector('[data-campo="Detalle"]').setAttribute('translate', 'no');
        if (c.MembresiaActiva) boton.querySelector('.fila__titulo').classList.add('texto-membresia');
        boton.addEventListener('click', function () { abrir(c.ID_Cliente, true); });
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Ficha
  // ---------------------------------------------------------------------------

  /**
   * Abre la ficha de un cliente.
   * @param {number|string} id
   * @param {boolean} [desplazar]  Lleva la vista a la ficha (útil en móvil).
   */
  async function abrir(id, desplazar) {
    el.vacio.hidden = true;
    el.perfil.hidden = true;
    el.cargando.hidden = false;
    try { cliente = await Api.clientes.obtener(id); }
    catch (error) { cliente = null; U.aviso(error.message, 'error'); }
    el.cargando.hidden = true;

    if (!cliente) { el.vacio.hidden = false; return; }
    marcarSeleccion();
    dibujarDatos();
    el.perfil.hidden = false;
    if (desplazar) el.perfil.scrollIntoView({ behavior: 'smooth', block: 'start' });
    cargarHistorial();
    cargarFotos();
  }

  /** Resalta en la lista de resultados al cliente abierto. */
  function marcarSeleccion() {
    el.resultados.querySelectorAll('[data-id]').forEach(function (b) {
      b.setAttribute('aria-current', String(String(b.getAttribute('data-id')) === String(cliente.ID_Cliente)));
      b.style.borderColor = b.getAttribute('aria-current') === 'true' ? 'var(--color-oro)' : '';
    });
  }

  /** Llena la ficha: datos, foto principal, membresía, puntualidad y próxima cita. */
  function dibujarDatos() {
    var c = cliente;
    U.llenar(el.perfil, c);

    // Foto principal (de referencia)
    var hayFoto = !!c.FotoCorteReferencia;
    el.sinFotoPrincipal.hidden = hayFoto;
    el.accionesFoto.hidden = !hayFoto;

    // Membresía (nombre en dorado si está vigente)
    var activa = !!c.MembresiaActiva;
    el.nombre.classList.toggle('texto-membresia', activa);
    el.insigniaMembresia.className = 'insignia ' + (activa ? 'insignia--oro' : '');
    el.insigniaMembresia.textContent = activa ? t('Membresía activa') : t('Sin membresía');
    el.datoMembresia.textContent = activa
      ? (c.NombrePlan || t('Activa'))
      : (c.NombrePlan ? t('Vencida') + ' (' + c.NombrePlan + ')' : t('Inactiva'));
    el.datoMembresia.className = 'dato__valor ' + (activa ? 'texto-membresia' : 'texto-tenue');

    // Puntualidad y faltas consecutivas
    var conRegistro = Number(c.Asistencias || 0) + Number(c.Faltas || 0);
    if (c.Puntualidad == null) {
      el.datoPuntualidad.textContent = t('Sin citas registradas');
      el.datoPuntualidad.className = 'dato__valor numeros texto-tenue';
    } else {
      el.datoPuntualidad.textContent = t('{p} % ({a} de {n} citas)', { p: c.Puntualidad, a: c.Asistencias, n: conRegistro });
      el.datoPuntualidad.className = 'dato__valor numeros ' + (c.Puntualidad >= 80 ? 'texto-exito' : c.Puntualidad >= 50 ? 'texto-aviso' : 'texto-error');
    }
    var faltas = Number(c.FaltasConsecutivas || 0);
    el.datoFaltas.textContent = faltas
      ? t('{n} seguidas · {total} en total', { n: faltas, total: c.Faltas || faltas })
      : t('Ninguna') + (c.Faltas ? ' · ' + t('{total} en total', { total: c.Faltas }) : '');
    el.datoFaltas.className = 'dato__valor numeros ' + (faltas >= 2 ? 'texto-error' : faltas ? 'texto-aviso' : '');

    // Próxima cita
    var p = c.ProximaCita;
    el.datoProxima.textContent = p
      ? U.formatoFechaHora(p.FechaHora) + ' · ' + p.NombreServicio + ' · ' + p.NombreBarbero
      : t('Sin cita próxima');

    // Las acciones llevan al cliente como parámetro.
    if (el.accionCita) el.accionCita.setAttribute('data-nav', 'agendar-cita.html?cliente=' + encodeURIComponent(c.ID_Cliente));
    if (el.accionCobro) el.accionCobro.setAttribute('data-nav', 'registrar-cobro.html?cliente=' + encodeURIComponent(c.ID_Cliente));
  }

  /** Dibuja el historial de servicios y el gasto promedio por visita.  GET /clientes/:id/servicios */
  async function cargarHistorial() {
    var conceptos = [];
    try { conceptos = (await Api.clientes.historial(cliente.ID_Cliente)) || []; }
    catch (error) { U.aviso(error.message, 'error'); }

    U.dibujarLista({
      contenedor: el.historialFilas, plantilla: 'plantilla-servicio', datos: conceptos, vacio: el.historialVacio,
      alCrear: function (fila, d) {
        var celda = fila.querySelector('[data-campo="NombreItem"]');
        celda.setAttribute('translate', 'no');
        if (d.TipoItem !== 'Servicio') {
          var tipo = document.createElement('span');
          tipo.className = 'texto-tenue text-xs';
          tipo.textContent = ' · ' + t(d.TipoItem);
          celda.appendChild(tipo);
        }
        if (d.TipoItem !== 'Servicio') fila.querySelector('[data-campo="NombreBarbero"]').textContent = '—';
        if (Number(d.Descuento) > 0 && d.Beneficio) fila.title = t(d.Beneficio);
      }
    });
    el.historialTabla.hidden = !conceptos.length;
    el.historialFilas.hidden = false;   // el <tbody> siempre visible; se oculta la tabla completa

    var visitas = Number(cliente.Visitas || 0);
    el.totalVisitas.textContent = t(visitas === 1 ? '{n} visita' : '{n} visitas', { n: visitas });

    if (el.gastoPromedio) {
      var total = conceptos.reduce(function (s, d) { return s + Number(d.Importe || 0); }, 0);
      el.gastoPromedio.hidden = !visitas;
      U.llenar(el.gastoPromedio, { Promedio: visitas ? total / visitas : 0 });
    }
  }

  /** Dibuja la galería de cortes del cliente.  GET /clientes/:id/fotos */
  async function cargarFotos() {
    fotos = [];
    try { fotos = (await Api.clientes.fotos(cliente.ID_Cliente)) || []; }
    catch (error) { U.aviso(error.message, 'error'); }
    U.dibujarLista({
      contenedor: el.galeria, plantilla: 'plantilla-foto', datos: fotos, vacio: el.fotosVacio,
      alCrear: function (boton, foto) {
        boton.querySelector('[data-campo="Titulo"]').setAttribute('translate', 'no');
        if (foto.Url === cliente.FotoCorteReferencia) {
          var marca = document.createElement('span');
          marca.className = 'insignia insignia--oro';
          marca.style.cssText = 'position:absolute;top:6px;left:6px;font-size:9.5px;padding:2px 6px';
          marca.textContent = t('Referencia');
          boton.appendChild(marca);
        }
        boton.addEventListener('click', function () { abrirVisor(foto, false); });
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Fotos
  // ---------------------------------------------------------------------------

  /** Reduce la foto elegida (cámara o galería) y la sube.  POST /clientes/:id/fotos */
  async function subirFoto() {
    var archivo = el.subirFoto.files && el.subirFoto.files[0];
    el.subirFoto.value = '';
    if (!archivo || !cliente) return;
    var etiqueta = document.querySelector('label[for="subir-foto"]');
    try {
      etiqueta.setAttribute('aria-busy', 'true');
      var foto = await U.prepararFoto(archivo);
      var r = await Api.clientes.subirFoto(cliente.ID_Cliente, { foto: foto });
      U.aviso('Foto agregada.');
      if (!cliente.FotoCorteReferencia && r && r.Url) { cliente.FotoCorteReferencia = r.Url; dibujarDatos(); }
      cargarFotos();
    } catch (error) { U.aviso(error.message, 'error'); }
    finally { etiqueta.removeAttribute('aria-busy'); }
  }

  /** Elimina la foto principal del cliente.  DELETE /clientes/:id/foto-referencia */
  async function eliminarFotoPrincipal() {
    if (!(await U.confirmar('¿Eliminar la foto principal del cliente?'))) return;
    try {
      await U.conCarga(el.fotoEliminar, Api.clientes.eliminarFotoPrincipal(cliente.ID_Cliente));
      cliente.FotoCorteReferencia = null;
      dibujarDatos();
      cargarFotos();
      U.aviso('Foto eliminada.');
    } catch (error) { U.aviso(error.message, 'error'); }
  }

  /** Abre la foto principal a pantalla completa. */
  function fotoPrincipalCompleta() {
    if (!cliente || !cliente.FotoCorteReferencia) return;
    var foto = fotos.find(function (f) { return f.Url === cliente.FotoCorteReferencia; })
      || { Url: cliente.FotoCorteReferencia, Titulo: t('Corte de referencia') };
    abrirVisor(foto, true);
  }

  /**
   * Muestra una foto en el visor.
   * @param {Object} foto
   * @param {boolean} completa  Ocupa toda la pantalla.
   */
  function abrirVisor(foto, completa) {
    fotoAbierta = foto;
    el.visor.classList.toggle('visor--completo', !!completa);
    el.visorImagen.src = U.urlArchivo(foto.Url);
    el.visorImagen.alt = foto.Titulo || t('Foto de corte');
    el.visorTitulo.textContent = foto.Titulo || t('Corte');
    el.visorFecha.textContent = foto.Fecha ? U.formatoFecha(foto.Fecha) + (foto.SubidaPor ? ' · ' + foto.SubidaPor : '') : '';
    el.visorNotas.textContent = foto.Notas || '';
    el.visorNotas.hidden = !foto.Notas;
    el.visorReferencia.hidden = !foto.ID_Foto || foto.Url === cliente.FotoCorteReferencia;
    el.visor.hidden = false;
    el.visorCerrar.focus();
  }

  /** Cierra el visor de fotos. */
  function cerrarVisor() { el.visor.hidden = true; fotoAbierta = null; }

  /** Marca la foto abierta como corte de referencia.  PUT /clientes/:id/foto-referencia */
  async function usarComoReferencia() {
    try {
      await U.conCarga(el.visorReferencia, Api.clientes.usarComoReferencia(cliente.ID_Cliente, fotoAbierta.ID_Foto));
      cliente.FotoCorteReferencia = fotoAbierta.Url;
      dibujarDatos();
      cargarFotos();
      U.aviso('Foto de referencia actualizada.');
      cerrarVisor();
    } catch (error) { U.aviso(error.message, 'error'); }
  }

  /** Elimina la foto abierta previa confirmación.  DELETE /clientes/:id/fotos/:idFoto */
  async function eliminarFotoAbierta() {
    if (!(await U.confirmar('¿Eliminar esta foto del expediente del cliente?'))) return;
    var foto = fotoAbierta;
    try {
      if (foto.ID_Foto) await U.conCarga(el.visorEliminar, Api.clientes.eliminarFoto(cliente.ID_Cliente, foto.ID_Foto));
      else await U.conCarga(el.visorEliminar, Api.clientes.eliminarFotoPrincipal(cliente.ID_Cliente));
      cerrarVisor();
      if (foto.Url === cliente.FotoCorteReferencia) { cliente.FotoCorteReferencia = null; dibujarDatos(); }
      U.aviso('Foto eliminada.');
      cargarFotos();
    } catch (error) { U.aviso(error.message, 'error'); }
  }

  // ---- Arranque ---------------------------------------------------------------
  el.buscador.addEventListener('cliente:elegido', function (e) {
    var c = e.detail && e.detail.cliente;
    el.buscador.limpiar();
    if (c) abrir(c.ID_Cliente, true);
  });
  el.buscar.addEventListener('click', buscar);
  el.filtro.addEventListener('change', buscar);
  el.subirFoto.addEventListener('change', subirFoto);
  el.fotoCompleta.addEventListener('click', fotoPrincipalCompleta);
  el.fotoPrincipal.addEventListener('click', fotoPrincipalCompleta);
  el.fotoEliminar.addEventListener('click', eliminarFotoPrincipal);
  el.visorCerrar.addEventListener('click', cerrarVisor);
  el.visorReferencia.addEventListener('click', usarComoReferencia);
  el.visorEliminar.addEventListener('click', eliminarFotoAbierta);
  el.visor.addEventListener('click', function (e) { if (e.target === el.visor) cerrarVisor(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !el.visor.hidden) cerrarVisor(); });
  document.querySelectorAll('label[for="subir-foto"]').forEach(function (etiqueta) {
    etiqueta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.subirFoto.click(); }
    });
  });

  var idInicial = U.parametro('cliente');
  if (idInicial) abrir(idInicial);
})();
