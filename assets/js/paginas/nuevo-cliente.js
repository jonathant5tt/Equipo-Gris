/**
 * @file paginas/nuevo-cliente.js
 * @description Controlador de «Registrar nuevo cliente» (nuevo-cliente.html).
 *
 * Flujo:
 *   1. Precarga nombre o teléfono si vienen en la URL (desde el buscador).
 *   2. Valida nombre (≥ 3 letras) y teléfono (10 dígitos).
 *   3. Reduce la foto (cámara o galería) y la envía en base64.
 *      POST /clientes { Nombre, Lada, Telefono, Descripcion, Observaciones, foto }
 *   4. Regresa a la pantalla de origen (?volver=) con ?cliente=ID, o abre el perfil.
 *
 * Regla de negocio: el cliente se registra SIN membresía; solo se activa al
 * cobrarla en caja (POST /ventas con un concepto «Membresía»).
 */
(function () {
  'use strict';

  if (!window.Sesion.permitida) return;

  var U = window.Utilidades;
  var Api = window.Api;

  /** Pantallas a las que se puede regresar después de registrar. */
  var DESTINOS = ['agendar-cita.html', 'registrar-cobro.html', 'perfil-cliente.html', 'barbero-perfil-cliente.html'];

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    formulario: $('formulario-cliente'), nombre: $('nombre'), errorNombre: $('error-nombre'),
    lada: $('lada'), telefono: $('telefono'), contadorTelefono: $('contador-telefono'), errorTelefono: $('error-telefono'),
    descripcion: $('descripcion'), observaciones: $('observaciones'),
    foto: $('foto'), vistaPrevia: $('vista-previa'), sinFoto: $('sin-foto'), quitarFoto: $('quitar-foto'),
    guardar: $('guardar'), cancelar: $('cancelar')
  };

  var volver = DESTINOS.indexOf(U.parametro('volver')) !== -1 ? U.parametro('volver') : null;
  var fotoPreparada = null;   // data URL ya reducida

  // ---------------------------------------------------------------------------
  // Foto
  // ---------------------------------------------------------------------------

  /** Reduce la foto elegida y muestra la vista previa. */
  async function mostrarFoto() {
    var archivo = el.foto.files && el.foto.files[0];
    fotoPreparada = null;
    if (archivo) {
      try { fotoPreparada = await U.prepararFoto(archivo); }
      catch (error) { U.aviso(error.message, 'error'); el.foto.value = ''; }
    }
    el.vistaPrevia.hidden = !fotoPreparada;
    el.sinFoto.hidden = !!fotoPreparada;
    el.quitarFoto.disabled = !fotoPreparada;
    if (fotoPreparada) el.vistaPrevia.src = fotoPreparada; else el.vistaPrevia.removeAttribute('src');
  }

  function quitarFoto() { el.foto.value = ''; mostrarFoto(); }

  // ---------------------------------------------------------------------------
  // Validación y envío
  // ---------------------------------------------------------------------------

  /** Deja solo dígitos en el teléfono y actualiza el contador. */
  function limpiarTelefono() {
    var digitos = el.telefono.value.replace(/\D/g, '').slice(0, 10);
    el.telefono.value = digitos;
    el.contadorTelefono.textContent = window.Idioma.t('{n} / 10 dígitos', { n: digitos.length });
    el.contadorTelefono.className = 'text-xs numeros ' + (digitos.length === 10 ? 'texto-exito' : 'texto-tenue');
    if (digitos.length === 10) marcarError(el.telefono, el.errorTelefono, false);
  }

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
   * Guarda al cliente y regresa a la pantalla de origen.  POST /clientes
   * @param {SubmitEvent} evento
   */
  async function guardar(evento) {
    evento.preventDefault();
    if (!validar()) return;
    try {
      var cliente = await U.conCarga(el.guardar, Api.clientes.crear({
        Nombre: el.nombre.value.trim(),
        Lada: el.lada.value,
        Telefono: el.telefono.value,
        Descripcion: el.descripcion.value.trim(),
        Observaciones: el.observaciones.value.trim(),
        foto: fotoPreparada || undefined
      }));
      U.aviso('Cliente guardado.');
      if (cliente.AvisoFoto) U.aviso(cliente.AvisoFoto, 'error');
      var destino = (volver || window.Sesion.resolverDestino('@perfil')) + '?cliente=' + encodeURIComponent(cliente.ID_Cliente);
      setTimeout(function () { window.location.href = destino; }, 400);
    } catch (error) {
      // 409: el teléfono ya está registrado (UNIQUE en CLIENTE.Telefono)
      U.aviso(error.message, 'error');
      if (error.estado === 409) marcarError(el.telefono, el.errorTelefono, true);
    }
  }

  function cancelar() { window.location.href = volver || window.APP_CONFIG.PAGINA_PANEL; }

  // ---- Arranque ---------------------------------------------------------------
  el.telefono.addEventListener('input', limpiarTelefono);
  el.nombre.addEventListener('input', function () { if (el.nombre.value.trim().length >= 3) marcarError(el.nombre, el.errorNombre, false); });
  el.foto.addEventListener('change', mostrarFoto);
  el.quitarFoto.addEventListener('click', quitarFoto);
  el.formulario.addEventListener('submit', guardar);
  el.cancelar.addEventListener('click', cancelar);
  // La etiqueta «Tomar / subir» también responde a Enter y Espacio.
  document.querySelector('label[for="foto"]').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.foto.click(); }
  });

  if (U.parametro('nombre')) el.nombre.value = U.parametro('nombre');
  if (U.parametro('telefono')) { el.telefono.value = U.parametro('telefono'); }
  limpiarTelefono();
  (U.parametro('nombre') ? el.telefono : el.nombre).focus();
})();
