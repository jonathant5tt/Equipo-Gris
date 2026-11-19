/**
 * @file paginas/inicio-sesion.js
 * @description Controlador de la pantalla de inicio de sesión (index.html).
 *
 * Flujo:
 *   1. Si no hay servidor configurado (app de Android) se pide su dirección,
 *      se prueba (GET /api/salud) y se guarda en el dispositivo.
 *   2. El usuario escribe usuario y contraseña.
 *   3. POST /auth/login → { token, usuario: { id, nombre, usuario, rol } }.
 *   4. Se guarda la sesión y se consulta el estado del servicio.
 *   5. Se abre el panel principal (o mantenimiento si el servicio está
 *      suspendido y el usuario no es el Dueño).
 * Primer uso: si todavía no existe la cuenta del Dueño se muestra el
 * formulario para crearla (POST /auth/primer-dueno).
 * En la app de Android, «Buscar el servidor» recorre la red Wi-Fi.
 * También permite elegir el idioma (español, inglés o italiano).
 */
(function () {
  'use strict';

  if (!window.Sesion.permitida) return;   // la pantalla está redirigiendo

  var U = window.Utilidades;
  var CFG = window.APP_CONFIG;
  var t = window.Idioma.t;

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    formulario: $('formulario-acceso'), usuario: $('usuario'), contrasena: $('contrasena'),
    verContrasena: $('ver-contrasena'), error: $('error-acceso'), botonEntrar: $('boton-entrar'),
    puntoServidor: $('punto-servidor'), textoServidor: $('texto-servidor'), cambiarServidor: $('cambiar-servidor'),
    formularioServidor: $('formulario-servidor'), direccionServidor: $('direccion-servidor'),
    guardarServidor: $('guardar-servidor'), cancelarServidor: $('cancelar-servidor'),
    idioma: $('idioma'),
    formularioInicial: $('formulario-inicial'), inicialNombre: $('inicial-nombre'), inicialUsuario: $('inicial-usuario'),
    inicialContrasena: $('inicial-contrasena'), inicialConfirmar: $('inicial-confirmar'), inicialCrear: $('inicial-crear'),
    titulo: $('titulo-acceso'), ayudaServidor: $('ayuda-servidor'), ayudaServidorTexto: $('ayuda-servidor-texto'),
    buscarServidor: $('buscar-servidor')
  };

  /** @param {string|null} mensaje  null oculta el error. */
  function mostrarError(mensaje) {
    el.error.hidden = !mensaje;
    el.error.querySelector('[data-mensaje]').textContent = mensaje ? t(mensaje) : '';
    el.usuario.setAttribute('aria-invalid', mensaje ? 'true' : 'false');
    el.contrasena.setAttribute('aria-invalid', mensaje ? 'true' : 'false');
  }

  /** Alterna la visibilidad de la contraseña. */
  function alternarContrasena() {
    var visible = el.contrasena.type === 'password';
    el.contrasena.type = visible ? 'text' : 'password';
    el.verContrasena.textContent = t(visible ? 'Ocultar' : 'Ver');
    el.verContrasena.setAttribute('aria-pressed', String(visible));
  }

  // ---------------------------------------------------------------------------
  // Servidor
  // ---------------------------------------------------------------------------

  /** Muestra la dirección actual, si responde y, la primera vez, el alta del Dueño. */
  async function revisarServidor() {
    el.textoServidor.textContent = CFG.SERVIDOR || t('Sin configurar');
    el.puntoServidor.style.color = 'var(--color-texto-tenue)';
    el.botonEntrar.disabled = !CFG.SERVIDOR;
    el.buscarServidor.hidden = !CFG.ES_APP_ANDROID;
    if (!CFG.SERVIDOR) { mostrarAyuda(); abrirFormularioServidor(); return; }
    try {
      await U.probarServidor(CFG.SERVIDOR);
      el.puntoServidor.style.color = 'var(--color-exito)';
      el.puntoServidor.title = t('En línea');
      el.ayudaServidor.hidden = true;
      el.buscarServidor.hidden = true;
      revisarPrimerUso();
    } catch (error) {
      // Abierto con la vista previa de VS Code (Live Server) o como archivo:
      // se prueba el servidor en el puerto 3000 de esta misma computadora.
      var alterno = await buscarServidorLocal();
      var yaIntentado = false;
      try { yaIntentado = window.sessionStorage.getItem('engreidos.cambio-auto') === alterno; } catch (e) { /* sin almacenamiento */ }
      if (alterno && !yaIntentado) {
        try { window.sessionStorage.setItem('engreidos.cambio-auto', alterno); } catch (e) { /* nada */ }
        window.guardarServidor(alterno);
        window.location.reload();
        return;
      }
      el.puntoServidor.style.color = 'var(--color-error)';
      el.puntoServidor.title = t('Sin conexión');
      mostrarAyuda();
    }
  }

  /** @returns {Promise<string|null>} Dirección del servidor en esta computadora, si responde. */
  async function buscarServidorLocal() {
    if (CFG.ES_APP_ANDROID) return null;
    var candidatos = ['http://localhost:3000', 'http://127.0.0.1:3000'];
    if (/^https?:$/.test(window.location.protocol) && window.location.hostname) {
      candidatos.unshift(window.location.protocol + '//' + window.location.hostname + ':3000');
    }
    for (var i = 0; i < candidatos.length; i += 1) {
      if (candidatos[i] === CFG.SERVIDOR) continue;
      try { await U.probarServidor(candidatos[i]); return candidatos[i]; } catch (e) { /* sigue */ }
    }
    return null;
  }

  /** Explica cómo encender o encontrar el servidor. */
  function mostrarAyuda() {
    el.ayudaServidor.hidden = false;
    el.ayudaServidorTexto.textContent = CFG.ES_APP_ANDROID
      ? t('Enciende el servidor en la computadora (iniciar-servidor.bat). Luego toca «Buscar el servidor en la red Wi-Fi» o escribe la dirección que muestra esa ventana; el teléfono debe estar en la misma red Wi-Fi.')
      : t('Enciende el servidor con iniciar-servidor.bat (doble clic) y deja abierta esa ventana; después recarga esta página. Si el servidor está en otra computadora, toca «Cambiar» y escribe su dirección.');
  }

  /** Primer uso: no hay cuenta del Dueño → formulario para crearla. */
  async function revisarPrimerUso() {
    try {
      var r = await window.Api.auth.inicial();
      var primerUso = !!(r && r.RequiereDueno);
      el.formularioInicial.hidden = !primerUso;
      el.formulario.hidden = primerUso;
      el.titulo.textContent = t(primerUso ? 'Bienvenido' : 'Iniciar sesión');
      if (primerUso) el.inicialNombre.focus();
    } catch (e) { /* se queda el inicio de sesión normal */ }
  }

  async function crearDueno(evento) {
    evento.preventDefault();
    var nombre = el.inicialNombre.value.trim();
    var usuario = el.inicialUsuario.value.trim().toLowerCase();
    var clave = el.inicialContrasena.value;
    if (nombre.length < 3) { U.aviso('Escribe el nombre completo.', 'error'); el.inicialNombre.focus(); return; }
    if (!/^[a-zñ0-9._-]{3,30}$/.test(usuario)) { U.aviso('El usuario solo puede tener letras, números, punto y guion, sin espacios.', 'error'); el.inicialUsuario.focus(); return; }
    if (clave.length < 3) { U.aviso('La contraseña debe tener al menos 3 caracteres.', 'error'); el.inicialContrasena.focus(); return; }
    if (clave !== el.inicialConfirmar.value) { U.aviso('Las contraseñas no coinciden.', 'error'); el.inicialConfirmar.focus(); return; }
    try {
      var r = await U.conCarga(el.inicialCrear, window.Api.auth.primerDueno({ Nombre: nombre, Usuario: usuario, Contrasena: clave }));
      window.Sesion.guardar(r);
      U.aviso('Cuenta del Dueño creada. ¡Bienvenido!');
      setTimeout(function () { window.location.replace(CFG.PAGINA_PANEL); }, 500);
    } catch (error) { U.aviso(error.message, 'error'); }
  }

  /** App de Android: recorre la red Wi-Fi buscando el servidor. */
  async function buscarEnRed() {
    var texto = el.buscarServidor.querySelector('[data-texto]');
    el.buscarServidor.disabled = true;
    try {
      var url = await U.buscarServidor(function (avance) { texto.textContent = t('Buscando… {n} %', { n: avance }); });
      if (url) {
        window.guardarServidor(url);
        U.aviso(t('Servidor encontrado: {url}', { url: url }));
        setTimeout(function () { window.location.reload(); }, 500);
        return;
      }
      U.aviso('No se encontró el servidor en esta red. Revisa que esté encendido o escribe su dirección.', 'error');
      abrirFormularioServidor();
    } finally {
      el.buscarServidor.disabled = false;
      texto.textContent = t('Buscar el servidor en la red Wi-Fi');
    }
  }

  function abrirFormularioServidor() {
    el.formularioServidor.hidden = false;
    el.cancelarServidor.hidden = !CFG.SERVIDOR;
    el.direccionServidor.value = CFG.SERVIDOR ? CFG.SERVIDOR.replace(/^http:\/\//, '') : '';
    el.direccionServidor.focus();
  }

  /** Prueba la dirección escrita y, si responde, la guarda y recarga. */
  async function guardarServidor(evento) {
    evento.preventDefault();
    var url = U.normalizarServidor(el.direccionServidor.value);
    if (!url) { U.aviso('Escribe la dirección del servidor, por ejemplo 192.168.1.70:3000.', 'error'); return; }
    try {
      await U.conCarga(el.guardarServidor, U.probarServidor(url));
      window.guardarServidor(url);
      U.aviso('Servidor guardado.');
      setTimeout(function () { window.location.reload(); }, 400);
    } catch (error) { U.aviso(error.message, 'error'); }
  }

  // ---------------------------------------------------------------------------
  // Inicio de sesión
  // ---------------------------------------------------------------------------

  /** Envía las credenciales y abre la pantalla que corresponde. */
  async function entrar(evento) {
    evento.preventDefault();
    var usuario = el.usuario.value.trim();
    var contrasena = el.contrasena.value;

    if (!CFG.SERVIDOR) { abrirFormularioServidor(); return; }
    if (!usuario || !contrasena) { mostrarError('Escribe tu usuario y tu contraseña.'); return; }
    mostrarError(null);

    try {
      var respuesta = await U.conCarga(el.botonEntrar, window.Api.auth.iniciarSesion(usuario, contrasena));
      window.Sesion.guardar(respuesta);

      // El estado del servicio decide si se muestra la pantalla de mantenimiento.
      try { await window.Api.establecimiento.estado(); } catch (e) { /* se reintenta en cada pantalla */ }

      var suspendido = window.Sesion.servicioSuspendido() && respuesta.usuario.rol !== window.Sesion.ROLES.DUENO;
      window.location.replace(suspendido ? CFG.PAGINA_MANTENIMIENTO : CFG.PAGINA_PANEL);
    } catch (error) {
      mostrarError(error.message || 'Intenta de nuevo.');
      el.contrasena.select();
    }
  }

  // ---- Arranque ---------------------------------------------------------------
  document.querySelectorAll('[data-version]').forEach(function (n) { n.textContent = CFG.VERSION; });

  Object.keys(window.Idioma.IDIOMAS).forEach(function (codigo) {
    var op = document.createElement('option');
    op.value = codigo;
    op.textContent = window.Idioma.IDIOMAS[codigo].nombre;
    op.setAttribute('data-dato', '');   // los nombres de idioma no se traducen
    el.idioma.appendChild(op);
  });
  el.idioma.value = window.Idioma.actual;
  el.idioma.addEventListener('change', function () { window.Idioma.cambiar(el.idioma.value); });

  el.verContrasena.addEventListener('click', alternarContrasena);
  el.formulario.addEventListener('submit', entrar);
  el.cambiarServidor.addEventListener('click', abrirFormularioServidor);
  el.cancelarServidor.addEventListener('click', function () { el.formularioServidor.hidden = true; });
  el.formularioServidor.addEventListener('submit', guardarServidor);
  el.formularioInicial.addEventListener('submit', crearDueno);
  el.buscarServidor.addEventListener('click', buscarEnRed);

  revisarServidor();
  if (CFG.SERVIDOR) el.usuario.focus();
})();
