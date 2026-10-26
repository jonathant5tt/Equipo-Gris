/**
 * @file navegacion-barbero.js
 * @description Componente <navegacion-barbero>: barra inferior de las
 * pantallas móviles del barbero (Citas · Clientes · Mi horario).
 *
 * Uso:
 *   <navegacion-barbero activa="citas"></navegacion-barbero>
 *   valores de `activa`: "citas" | "clientes" | "horario"
 *
 * Requiere: sesion.js (para la navegación con data-nav).
 */
(function () {
  'use strict';

  /** Opciones de la barra, en orden. */
  var OPCIONES = [
    { clave: 'citas', texto: 'Citas', icono: 'calendar_today', pagina: 'barbero-mis-citas.html' },
    { clave: 'clientes', texto: 'Clientes', icono: 'group', pagina: 'barbero-perfil-cliente.html' },
    { clave: 'horario', texto: 'Mi horario', icono: 'schedule', pagina: 'barbero-mi-horario.html' }
  ];

  class NavegacionBarbero extends HTMLElement {
    /** Dibuja la barra una sola vez y marca la sección activa (aria-current). */
    connectedCallback() {
      if (this._listo) return;
      this._listo = true;
      var activa = this.getAttribute('activa');

      var nav = document.createElement('nav');
      nav.className = 'navegacion-inferior';
      nav.setAttribute('aria-label', 'Secciones del barbero');

      OPCIONES.forEach(function (op) {
        var enlace = document.createElement('a');
        enlace.className = 'navegacion-inferior__opcion';
        enlace.href = op.pagina;
        enlace.setAttribute('data-nav', op.pagina);
        if (op.clave === activa) enlace.setAttribute('aria-current', 'page');
        enlace.innerHTML = '<span class="icono" aria-hidden="true">' + op.icono + '</span>';
        enlace.appendChild(document.createTextNode(op.texto));
        nav.appendChild(enlace);
      });

      this.replaceChildren(nav);
    }
  }

  if (!customElements.get('navegacion-barbero')) customElements.define('navegacion-barbero', NavegacionBarbero);
})();
