/**
 * @file encabezado-app.js
 * @description Componente <encabezado-app>: encabezado único para TODAS las
 * pantallas con sesión. Un solo archivo define su diseño, así que cualquier
 * cambio se refleja en toda la aplicación.
 *
 * Uso:
 *   <encabezado-app variante="panel"></encabezado-app>    → botón de menú (☰)
 *   <encabezado-app variante="modulo"></encabezado-app>   → flecha al panel
 *
 * Contenido (de izquierda a derecha):
 *   [☰ | ←]  [ Engreídos ] BARBERSHOP  ·····  ● En línea   ● Rol: Cajero   [Cerrar sesión]
 *
 * - El menú (☰) solo aparece en el panel principal; está reservado para los
 *   ajustes futuros y emite el evento `encabezado:menu`.
 * - El punto de conexión consulta GET /salud cada APP_CONFIG.INTERVALO_SALUD_MS
 *   cuando hay back end; sin back end refleja la conexión a internet del equipo.
 * - Se usa light DOM (sin Shadow DOM) para que comun.css lo estilice.
 *
 * Requiere: config.js, sesion.js, api.js, utilidades.js
 */
(function () {
  'use strict';

  var CFG = window.APP_CONFIG;

  /** Íconos SVG en línea: no dependen de fuentes externas. */
  var SVG = {
    menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">' +
      '<path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5"/></svg>',
    volver: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">' +
      '<path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18"/></svg>',
    salir: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
      '<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9"/></svg>'
  };

  /** Texto de cada estado del indicador de conexión. */
  var TEXTO_CONEXION = {
    'en-linea': 'En línea',
    'verificando': 'Verificando…',
    'sin-conexion': 'Sin conexión'
  };

  class EncabezadoApp extends HTMLElement {
    /** Se ejecuta al insertarse en la página: dibuja una sola vez e inicia el indicador. */
    connectedCallback() {
      if (this._listo) return;
      this._listo = true;
      this.dibujar();
      this.iniciarIndicadorConexion();
    }

    /** Libera el temporizador y los escuchas al retirarse de la página. */
    disconnectedCallback() {
      clearInterval(this._intervalo);
      window.removeEventListener('online', this._alCambiarRed);
      window.removeEventListener('offline', this._alCambiarRed);
    }

    /** Genera el marcado del encabezado según la variante. */
    dibujar() {
      var esPanel = this.getAttribute('variante') === 'panel';
      var rol = window.Sesion.rol() || '—';

      var botonIzquierdo = esPanel
        ? '<button type="button" class="encabezado__boton-icono" data-accion="menu" aria-label="Menú de ajustes" title="Ajustes">' + SVG.menu + '</button>'
        : '<a href="' + CFG.PAGINA_PANEL + '" data-nav="@panel" class="encabezado__boton-icono" aria-label="Volver al panel principal" title="Volver al panel principal">' + SVG.volver + '</a>';

      this.innerHTML =
        '<header class="encabezado">' +
          '<div class="encabezado__izquierda">' +
            botonIzquierdo +
            '<a href="' + CFG.PAGINA_PANEL + '" data-nav="@panel" class="marca" aria-label="' + CFG.NOMBRE + ', ir al panel principal">' +
              '<span class="marca__nombre"><span class="marca__corchete">[</span><span class="marca__texto">Engreídos</span><span class="marca__corchete">]</span></span>' +
              '<span class="marca__subtitulo">Barbershop</span>' +
            '</a>' +
          '</div>' +
          '<div class="encabezado__derecha">' +
            '<span class="pastilla conexion" data-estado="verificando" role="status" aria-live="polite">' +
              '<span class="pastilla__punto" aria-hidden="true"></span><span class="pastilla__valor">' + TEXTO_CONEXION.verificando + '</span>' +
            '</span>' +
            '<span class="pastilla rol">' +
              '<span class="pastilla__punto" aria-hidden="true"></span><span class="pastilla__etiqueta">Rol:</span>' +
              '<span class="pastilla__valor" data-rol></span>' +
            '</span>' +
            '<button type="button" class="boton-salir" data-nav="@logout" aria-label="Cerrar sesión">' +
              SVG.salir + '<span class="boton-salir__texto">Cerrar sesión</span>' +
            '</button>' +
          '</div>' +
        '</header>';

      // El rol se inserta como texto para no interpretar HTML.
      this.querySelector('[data-rol]').textContent = rol;

      var menu = this.querySelector('[data-accion="menu"]');
      if (menu) {
        menu.addEventListener('click', function () {
          // Punto de extensión para los ajustes futuros del panel.
          var evento = new CustomEvent('encabezado:menu', { bubbles: true, cancelable: true });
          if (menu.dispatchEvent(evento)) window.Utilidades.aviso('Los ajustes estarán disponibles próximamente.', 'info');
        });
      }
    }

    /**
     * Cambia el punto de conexión.
     * @param {'en-linea'|'verificando'|'sin-conexion'} estado
     */
    marcarConexion(estado) {
      var pastilla = this.querySelector('.conexion');
      if (!pastilla) return;
      pastilla.setAttribute('data-estado', estado);
      pastilla.title = TEXTO_CONEXION[estado];
      pastilla.querySelector('.pastilla__valor').textContent = TEXTO_CONEXION[estado];
    }

    /** Verifica la conexión al cargar, al cambiar la red y de forma periódica. */
    iniciarIndicadorConexion() {
      var self = this;

      /** Consulta la conexión: red del equipo y, con back end, GET /salud. */
      function verificar() {
        if (!navigator.onLine) { self.marcarConexion('sin-conexion'); return; }
        if (!CFG.USAR_BACKEND) { self.marcarConexion('en-linea'); return; }
        window.Api.salud.verificar()
          .then(function () { self.marcarConexion('en-linea'); })
          .catch(function () { self.marcarConexion('sin-conexion'); });
      }

      this._alCambiarRed = verificar;
      window.addEventListener('online', verificar);
      window.addEventListener('offline', verificar);
      if (CFG.USAR_BACKEND) this._intervalo = setInterval(verificar, CFG.INTERVALO_SALUD_MS);
      verificar();
    }
  }

  if (!customElements.get('encabezado-app')) customElements.define('encabezado-app', EncabezadoApp);
})();
