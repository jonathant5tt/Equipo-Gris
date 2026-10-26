/**
 * @file paginas/nuevo-cliente.js
 * @description Controlador de «Registrar nuevo cliente» (nuevo-cliente.html).
 *
 * Flujo:
 *   1. Carga los planes de membresía.             GET /membresias
 *   2. Valida nombre (≥ 3 letras) y teléfono (10 dígitos).
 *   3. Envía el formulario con la foto.           POST /clientes (multipart/form-data)
 *   4. Abre el perfil del cliente creado (tablet o móvil según el rol).
 *
 * Campos enviados (FormData): Nombre, Lada, Telefono, Descripcion,
 * Observaciones, EstadoMembresia, ID_Membresia, FechaInicio, foto.
 */
(function () {
  'use strict';

  if (!window.Sesion.permitida) return;

  var U = window.Utilidades;
  var Api = window.Api;

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    formulario: $('formulario-cliente'),
    nombre: $('nombre'),
    errorNombre: $('error-nombre'),
    telefono: $('telefono'),
    contadorTelefono: $('contador-telefono'),
    errorTelefono: $('error-telefono'),
    plan: $('plan'),
    fechaInicio: $('fecha-inicio'),
    foto: $('foto'),
    vistaPrevia: $('vista-previa'),
    sinFoto: $('sin-foto'),
    quitarFoto: $('quitar-foto'),
    guardar: $('guardar')
  };

  /** Estado de membresía elegido: "Activa" | "Inactiva". */
  var estadoMembresia = 'Inactiva';

  // ---------------------------------------------------------------------------
  // Membresía
  // ---------------------------------------------------------------------------

  /** Llena el selector de planes de membresía.  GET /membresias */
  async function cargarPlanes() {
    var planes = [];
    try { planes = (await Api.catalogos.membresias()) || []; }
    catch (error) { U.aviso(error.message, 'error'); }
    el.plan.replaceChildren(new Option(planes.length ? 'Selecciona un plan' : 'No hay planes registrados', ''));
    planes.forEach(function (p) { el.plan.add(new Option(p.NombrePlan, p.ID_Membresia)); });
    el.plan.setAttribute('data-hay-planes', String(planes.length > 0));
    elegirMembresia(estadoMembresia);
  }

  /** @param {'Activa'|'Inactiva'} valor */
  function elegirMembresia(valor) {
    estadoMembresia = valor;
    document.querySelectorAll('[data-membresia]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-membresia') === valor));
    });
    var activa = valor === 'Activa';
    el.plan.disabled = !activa || el.plan.getAttribute('data-hay-planes') !== 'true';
    el.fechaInicio.disabled = !activa;
    if (activa && !el.fechaInicio.value) el.fechaInicio.value = U.fechaISO();
  }

  // ---------------------------------------------------------------------------
  // Foto
  // ---------------------------------------------------------------------------

  var urlVistaPrevia = null;

  /** Muestra la vista previa de la foto elegida (y libera la anterior de memoria). */
  function mostrarFoto() {
    var archivo = el.foto.files && el.foto.files[0];
    if (urlVistaPrevia) URL.revokeObjectURL(urlVistaPrevia);
    urlVistaPrevia = archivo ? URL.createObjectURL(archivo) : null;
    el.vistaPrevia.hidden = !archivo;
    el.sinFoto.hidden = !!archivo;
    el.quitarFoto.disabled = !archivo;
    if (archivo) el.vistaPrevia.src = urlVistaPrevia; else el.vistaPrevia.removeAttribute('src');
  }

  /** Quita la foto elegida. */
  function quitarFoto() { el.foto.value = ''; mostrarFoto(); }

  // ---------------------------------------------------------------------------
  // Validación y envío
  // ---------------------------------------------------------------------------

  /** Deja solo dígitos en el teléfono y actualiza el contador. */
  function limpiarTelefono() {
    var digitos = el.telefono.value.replace(/\D/g, '').slice(0, 10);
    el.telefono.value = digitos;
    el.contadorTelefono.textContent = digitos.length + ' / 10 dígitos';
    el.contadorTelefono.className = 'text-xs numeros ' + (digitos.length === 10 ? 'texto-exito' : 'texto-tenue');
    if (digitos.length === 10) marcarError(el.telefono, el.errorTelefono, false);
  }

  /** @param {HTMLElement} campo @param {HTMLElement} mensaje @param {boolean} hayError */
  function marcarError(campo, mensaje, hayError) {
    campo.setAttribute('aria-invalid', String(hayError));
    mensaje.hidden = !hayError;
  }

  /** @returns {boolean} true si el formulario es válido. */
  function validar() {
    var nombreOk = el.nombre.value.trim().length >= 3;
    var telefonoOk = U.telefonoValido(el.telefono.value);
    marcarError(el.nombre, el.errorNombre, !nombreOk);
    marcarError(el.telefono, el.errorTelefono, !telefonoOk);
    if (!nombreOk) el.nombre.focus(); else if (!telefonoOk) el.telefono.focus();
    return nombreOk && telefonoOk;
  }

  /**
   * Valida y envía el formulario; al terminar abre el perfil del cliente.  POST /clientes
   * @param {SubmitEvent} evento
   */
  async function guardar(evento) {
    evento.preventDefault();
    if (!validar()) return;

    var datos = new FormData(el.formulario);          // incluye la foto si se eligió
    datos.set('Nombre', el.nombre.value.trim());
    datos.set('EstadoMembresia', estadoMembresia);
    if (estadoMembresia !== 'Activa') { datos.delete('ID_Membresia'); datos.delete('FechaInicio'); }
    if (!(el.foto.files && el.foto.files[0])) datos.delete('foto');

    try {
      var cliente = await U.conCarga(el.guardar, Api.clientes.crear(datos));
      if (cliente && cliente.ID_Cliente) {
        U.aviso('Cliente guardado.');
        window.location.href = window.Sesion.resolverDestino('@perfil?cliente=' + encodeURIComponent(cliente.ID_Cliente));
      }
    } catch (error) {
      // 409: el teléfono ya está registrado (UNIQUE en CLIENTE.Telefono)
      U.aviso(error.message, 'error');
      if (error.estado === 409) marcarError(el.telefono, el.errorTelefono, true);
    }
  }

  // ---- Arranque ---------------------------------------------------------------
  document.querySelectorAll('[data-membresia]').forEach(function (b) {
    b.addEventListener('click', function () { elegirMembresia(b.getAttribute('data-membresia')); });
  });
  el.telefono.addEventListener('input', limpiarTelefono);
  el.nombre.addEventListener('input', function () { if (el.nombre.value.trim().length >= 3) marcarError(el.nombre, el.errorNombre, false); });
  el.foto.addEventListener('change', mostrarFoto);
  el.quitarFoto.addEventListener('click', quitarFoto);
  el.formulario.addEventListener('submit', guardar);
  // La etiqueta «Tomar / subir» también responde a Enter y Espacio.
  document.querySelector('label[for="foto"]').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.foto.click(); }
  });

  cargarPlanes();
  el.nombre.focus();
})();
