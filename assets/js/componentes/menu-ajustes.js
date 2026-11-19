/**
 * @file menu-ajustes.js
 * @description Componente <menu-ajustes>: menú «Ajustes del sistema» con las
 * secciones numeradas, su ícono y una flecha; Idioma muestra el idioma actual
 * y Servidor si es local y si responde.
 *
 * Uso:
 *   <menu-ajustes modo="lateral"></menu-ajustes>
 *       Columna de ajustes.html: cada opción cambia el hash (#membresias).
 *   MenuAjustes.abrirCajon()
 *       Panel flotante sobre la pantalla actual (botón ☰ del encabezado).
 *       Cada opción abre ajustes.html#seccion.
 *
 * Cada rol ve solo sus secciones (SECCIONES[].roles). Los íconos son SVG en
 * línea para que se vean aunque no haya internet.
 *
 * Requiere: config.js, idioma.js, sesion.js, api.js
 */
(function () {
  'use strict';

  var CFG = window.APP_CONFIG;
  var t = function (x, d) { return window.Idioma ? window.Idioma.t(x, d) : x; };
  var TODOS = ['Dueño', 'Cajero', 'Barbero'];

  /** Trazos de los íconos (24 × 24, línea). */
  var ICONOS = {
    engrane: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    tijeras: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12"/>',
    caja: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96 12 12.01l8.73-5.05M12 22.08V12"/>',
    corona: '<path d="M3 7.5 7.5 11 12 5l4.5 6L21 7.5 19 18H5L3 7.5z"/><path d="M5 21h14"/>',
    etiqueta: '<path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><path d="M7 7h.01"/>',
    personas: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    tienda: '<path d="M3 9.5 4.6 4h14.8L21 9.5M3 9.5V20h18V9.5M3 9.5h18"/><path d="M9.5 20v-5.5h5V20M3 9.5a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/>',
    impresora: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8" rx="1"/>',
    mensaje: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
    globo: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    servidor: '<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><path d="M6 6h.01M6 18h.01"/>',
    flecha: '<path d="m9 18 6-6-6-6"/>',
    cerrar: '<path d="M18 6 6 18M6 6l12 12"/>'
  };

  function svg(nombre, clase) {
    return '<svg class="' + (clase || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONOS[nombre] + '</svg>';
  }

  /** Secciones de ajustes.html en orden. */
  var SECCIONES = [
    { id: 'servicios', texto: 'Servicios', icono: 'tijeras', roles: ['Dueño'] },
    { id: 'productos', texto: 'Productos e inventario', textoCajero: 'Inventario', icono: 'caja', roles: ['Dueño', 'Cajero'] },
    { id: 'membresias', texto: 'Membresías', icono: 'corona', roles: ['Dueño'] },
    { id: 'descuentos', texto: 'Descuentos', icono: 'etiqueta', roles: ['Dueño'] },
    { id: 'cuentas', texto: 'Cuentas', icono: 'personas', roles: ['Dueño'] },
    { id: 'negocio', texto: 'Datos del negocio', icono: 'tienda', roles: ['Dueño'] },
    { id: 'impresora', texto: 'Impresora', icono: 'impresora', roles: ['Dueño', 'Cajero'] },
    { id: 'whatsapp', texto: 'WhatsApp', icono: 'mensaje', roles: ['Dueño'] },
    { id: 'idioma', texto: 'Idioma', icono: 'globo', roles: TODOS, insignia: 'idioma' },
    { id: 'servidor', texto: 'Servidor', icono: 'servidor', roles: TODOS, insignia: 'servidor' }
  ];

  /** Secciones que puede ver el rol con sesión. */
  function seccionesDelRol() {
    var rol = window.Sesion ? window.Sesion.rol() : null;
    return SECCIONES.filter(function (s) { return s.roles.indexOf(rol) !== -1; });
  }

  /** ¿La dirección del servidor es de esta computadora o de la red local? */
  function esLocal(url) {
    try {
      var h = new URL(url || window.location.href).hostname;
      return h === 'localhost' || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /\.local$/.test(h) || h === '';
    } catch (e) { return true; }
  }

  class MenuAjustes extends HTMLElement {
    connectedCallback() {
      if (this._listo) return;
      this._listo = true;
      this.dibujar();
    }

    get esCajon() { return this.getAttribute('modo') === 'cajon'; }

    dibujar() {
      var cajon = this.esCajon;
      var rol = window.Sesion ? window.Sesion.rol() : '';
      var lista = seccionesDelRol();
      var opciones = lista.map(function (s, i) {
        var texto = rol === 'Cajero' && s.textoCajero ? s.textoCajero : s.texto;
        var destino = cajon ? 'ajustes.html#' + s.id : '#' + s.id;
        return '<li><a class="menu-ajustes__opcion" href="' + destino + '"' + (cajon ? ' data-nav="' + destino + '"' : '') +
          ' data-ir="' + s.id + '">' +
          '<span class="menu-ajustes__numero numeros">' + (i + 1) + '.</span>' +
          svg(s.icono, 'menu-ajustes__opcion-icono') +
          '<span class="menu-ajustes__opcion-texto">' + t(texto) + '</span>' +
          (s.insignia ? '<span class="menu-ajustes__insignia" data-insignia="' + s.insignia + '"></span>' : '') +
          svg('flecha', 'menu-ajustes__flecha') +
          '</a></li>';
      }).join('');

      this.innerHTML =
        '<nav class="menu-ajustes' + (cajon ? ' menu-ajustes--cajon' : '') + '" aria-label="' + t('Ajustes del sistema') + '">' +
          '<div class="menu-ajustes__cabecera">' +
            '<span class="menu-ajustes__engrane">' + svg('engrane') + '</span>' +
            '<div class="menu-ajustes__titulos">' +
              '<span class="menu-ajustes__titulo">' + t('Ajustes del sistema') + '</span>' +
              '<span class="menu-ajustes__subtitulo">' + t('Configuración general') + '</span>' +
            '</div>' +
            (cajon ? '<button type="button" class="menu-ajustes__cerrar" data-cerrar aria-label="' + t('Cerrar') + '">' + svg('cerrar') + '</button>' : '') +
          '</div>' +
          '<ol class="menu-ajustes__lista">' + opciones + '</ol>' +
          '<div class="menu-ajustes__pie">' +
            '<span class="menu-ajustes__marca" translate="no"><span class="menu-ajustes__punto"></span>Engreídos POS</span>' +
            '<span class="menu-ajustes__version numeros" translate="no">v' + String(CFG.VERSION || '').replace(/\.0$/, '') + '</span>' +
          '</div>' +
        '</nav>';

      this.actualizarInsignias();
    }

    /** Idioma actual y estado del servidor. */
    actualizarInsignias() {
      var idioma = this.querySelector('[data-insignia="idioma"]');
      if (idioma && window.Idioma) {
        var info = window.Idioma.IDIOMAS[window.Idioma.actual];
        idioma.textContent = info ? info.nombre : '';
        idioma.setAttribute('translate', 'no');
      }
      var servidor = this.querySelector('[data-insignia="servidor"]');
      if (servidor) {
        servidor.className = 'menu-ajustes__insignia menu-ajustes__insignia--estado';
        servidor.setAttribute('data-estado', 'verificando');
        servidor.innerHTML = '<span class="menu-ajustes__punto"></span>';
        servidor.appendChild(document.createTextNode(t(esLocal(CFG.SERVIDOR) ? 'Local' : 'Remoto')));
        if (window.Api && window.Api.salud) {
          window.Api.salud.verificar()
            .then(function () { servidor.setAttribute('data-estado', 'en-linea'); servidor.title = t('En línea'); })
            .catch(function () { servidor.setAttribute('data-estado', 'sin-conexion'); servidor.title = t('Sin conexión'); });
        }
      }
    }

    /** Resalta la sección abierta (modo lateral). */
    marcar(id) {
      this.querySelectorAll('.menu-ajustes__opcion').forEach(function (a) {
        var activa = a.getAttribute('data-ir') === id;
        a.classList.toggle('menu-ajustes__opcion--activa', activa);
        if (activa) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
      });
    }

    /** Ids de las secciones visibles para el rol. */
    static secciones() { return seccionesDelRol().map(function (s) { return s.id; }); }
  }

  if (!customElements.get('menu-ajustes')) customElements.define('menu-ajustes', MenuAjustes);

  // ---------------------------------------------------------------------------
  // Panel flotante (☰)
  // ---------------------------------------------------------------------------
  var cajon = null;
  var focoAnterior = null;

  function cerrarCajon() {
    if (!cajon || cajon.hidden) return;
    cajon.classList.remove('cajon-ajustes--abierto');
    document.documentElement.classList.remove('sin-desplazamiento');
    setTimeout(function () { cajon.hidden = true; }, 180);
    if (focoAnterior && focoAnterior.focus) focoAnterior.focus();
  }

  function abrirCajon() {
    focoAnterior = document.activeElement;
    if (!cajon) {
      cajon = document.createElement('div');
      cajon.className = 'cajon-ajustes';
      cajon.setAttribute('role', 'dialog');
      cajon.setAttribute('aria-modal', 'true');
      cajon.setAttribute('aria-label', t('Ajustes del sistema'));
      cajon.innerHTML = '<menu-ajustes modo="cajon"></menu-ajustes>';
      cajon.hidden = true;
      document.body.appendChild(cajon);
      cajon.addEventListener('click', function (e) {
        if (e.target === cajon || e.target.closest('[data-cerrar]')) cerrarCajon();
      });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') cerrarCajon(); });
    } else {
      cajon.querySelector('menu-ajustes').actualizarInsignias();
    }
    cajon.hidden = false;
    document.documentElement.classList.add('sin-desplazamiento');
    // Se deja un cuadro para que la transición se vea.
    requestAnimationFrame(function () { requestAnimationFrame(function () { cajon.classList.add('cajon-ajustes--abierto'); }); });
    var primera = cajon.querySelector('.menu-ajustes__opcion');
    if (primera) setTimeout(function () { primera.focus({ preventScroll: true }); }, 60);
  }

  window.MenuAjustes = Object.freeze({ abrirCajon: abrirCajon, cerrarCajon: cerrarCajon, secciones: MenuAjustes.secciones, esLocal: esLocal });
})();
