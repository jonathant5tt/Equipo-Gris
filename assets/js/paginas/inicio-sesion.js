/**
 * @file paginas/inicio-sesion.js
 * @description Controlador de la pantalla de inicio de sesión (index.html).
 *
 * Flujo:
 *   1. El usuario escribe usuario y contraseña.
 *   2. POST /auth/login → { token, usuario: { id, nombre, usuario, rol } }.
 *   3. Se guarda la sesión y se consulta el estado del servicio.
 *   4. Se abre el panel principal (o mantenimiento si el servicio está
 *      suspendido y el usuario no es el Dueño).
 */
(function () {
  'use strict';

  if (!window.Sesion.permitida) return;   // la pantalla está redirigiendo

  var U = window.Utilidades;
  var CFG = window.APP_CONFIG;

  /** Referencias a los elementos de la pantalla. */
  var el = {
    formulario: document.getElementById('formulario-acceso'),
    usuario: document.getElementById('usuario'),
    contrasena: document.getElementById('contrasena'),
    verContrasena: document.getElementById('ver-contrasena'),
    error: document.getElementById('error-acceso'),
    botonEntrar: document.getElementById('boton-entrar')
  };

  /** @param {string|null} mensaje  null oculta el error. */
  function mostrarError(mensaje) {
    el.error.hidden = !mensaje;
    el.error.querySelector('[data-mensaje]').textContent = mensaje || '';
    el.usuario.setAttribute('aria-invalid', mensaje ? 'true' : 'false');
    el.contrasena.setAttribute('aria-invalid', mensaje ? 'true' : 'false');
  }

  /** Alterna la visibilidad de la contraseña. */
  function alternarContrasena() {
    var visible = el.contrasena.type === 'password';
    el.contrasena.type = visible ? 'text' : 'password';
    el.verContrasena.textContent = visible ? 'Ocultar' : 'Ver';
    el.verContrasena.setAttribute('aria-pressed', String(visible));
  }

  /** Envía las credenciales y abre la pantalla que corresponde. */
  async function entrar(evento) {
    evento.preventDefault();
    var usuario = el.usuario.value.trim();
    var contrasena = el.contrasena.value;

    if (!usuario || !contrasena) {
      mostrarError('Escribe tu usuario y tu contraseña.');
      return;
    }
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
  el.verContrasena.addEventListener('click', alternarContrasena);
  el.formulario.addEventListener('submit', entrar);
  el.usuario.focus();
})();
