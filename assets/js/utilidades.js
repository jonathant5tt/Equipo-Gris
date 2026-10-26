/**
 * @file utilidades.js
 * @description Funciones de apoyo reutilizadas por todas las pantallas:
 * formato de moneda/fechas, plantillas HTML, avisos flotantes y validaciones.
 *
 * Expone el objeto global `Utilidades`. No depende del back end.
 * Requiere: config.js
 */
(function () {
  'use strict';

  var CFG = window.APP_CONFIG;

  // ---------------------------------------------------------------------------
  // Formato de datos
  // ---------------------------------------------------------------------------

  var formatoMonedaMX = new Intl.NumberFormat(CFG.LOCALE, {
    style: 'currency',
    currency: CFG.MONEDA,
    minimumFractionDigits: 2
  });

  /**
   * Da formato de moneda mexicana. Acepta números o cadenas numéricas
   * (MySQL devuelve DECIMAL como cadena).
   * @param {number|string|null} valor
   * @returns {string} Ej. "$1,250.00"
   */
  function formatoMoneda(valor) {
    var numero = Number(valor);
    return formatoMonedaMX.format(isFinite(numero) ? numero : 0);
  }

  /**
   * Convierte un valor de fecha del back end (ISO "2026-10-24T17:30:00" o
   * "2026-10-24") en objeto Date. Las fechas sin hora se interpretan como
   * fecha local para evitar el desfase de zona horaria.
   * @param {string|Date|null} valor
   * @returns {Date|null}
   */
  function aFecha(valor) {
    if (!valor) return null;
    if (valor instanceof Date) return valor;
    if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
      var p = valor.split('-');
      return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    }
    var fecha = new Date(valor);
    return isNaN(fecha.getTime()) ? null : fecha;
  }

  /**
   * Fecha corta: "24/10/2026".
   * @param {string|Date} valor
   * @returns {string}
   */
  function formatoFecha(valor) {
    var f = aFecha(valor);
    return f ? f.toLocaleDateString(CFG.LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
  }

  /**
   * Fecha larga: "viernes, 24 de octubre de 2026".
   * @param {string|Date} valor
   * @returns {string}
   */
  function formatoFechaLarga(valor) {
    var f = aFecha(valor);
    return f ? f.toLocaleDateString(CFG.LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '—';
  }

  /**
   * Hora en formato 24 h: "17:30".
   * @param {string|Date} valor  También acepta "17:30:00" (columna TIME de MySQL).
   * @returns {string}
   */
  function formatoHora(valor) {
    if (!valor) return '—';
    if (typeof valor === 'string' && /^\d{2}:\d{2}/.test(valor)) return valor.slice(0, 5);
    var f = aFecha(valor);
    return f ? f.toLocaleTimeString(CFG.LOCALE, { hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
  }

  /**
   * Fecha en formato ISO "AAAA-MM-DD" usando la fecha local (para enviar a la API).
   * @param {Date} [fecha=new Date()]
   * @returns {string}
   */
  function fechaISO(fecha) {
    var f = fecha || new Date();
    var mes = String(f.getMonth() + 1).padStart(2, '0');
    var dia = String(f.getDate()).padStart(2, '0');
    return f.getFullYear() + '-' + mes + '-' + dia;
  }

  /**
   * Teléfono de 10 dígitos legible: "2281234567" → "228 123 4567".
   * @param {string} telefono
   * @returns {string}
   */
  function formatoTelefono(telefono) {
    var d = String(telefono || '').replace(/\D/g, '');
    return d.length === 10 ? d.replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2 $3') : (telefono || '—');
  }

  /**
   * Iniciales para avatares: "Carlos Mendoza Rivas" → "CM".
   * @param {string} nombre
   * @returns {string}
   */
  function iniciales(nombre) {
    return String(nombre || '?').trim().split(/\s+/).slice(0, 2)
      .map(function (p) { return p.charAt(0).toUpperCase(); }).join('');
  }

  /**
   * Quita acentos y pasa a minúsculas para comparar textos.
   * @param {string} texto
   * @returns {string}
   */
  function normalizarTexto(texto) {
    return String(texto || '').trim().toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  /** Formatos disponibles para `data-formato` en las plantillas. */
  var FORMATOS = {
    moneda: formatoMoneda,
    fecha: formatoFecha,
    fechaLarga: formatoFechaLarga,
    hora: formatoHora,
    telefono: formatoTelefono,
    iniciales: iniciales,
    mayusculas: function (v) { return String(v == null ? '' : v).toUpperCase(); }
  };

  // ---------------------------------------------------------------------------
  // Plantillas HTML (<template>) y llenado de datos
  // ---------------------------------------------------------------------------

  /**
   * Llena un elemento con los valores de `datos` usando atributos declarativos:
   *   data-campo="Nombre"                 → textContent = datos.Nombre
   *   data-campo="Total" data-formato="moneda"
   *   data-campo-src="FotoCorteReferencia" → atributo src
   *   data-campo-valor="ID_Cliente"       → atributo value
   *   data-campo-id="ID_Venta"            → atributo data-id (para acciones)
   *   data-vacio="Texto"                  → texto si el valor viene vacío (por omisión «—»)
   * Los valores se insertan como texto (nunca como HTML) para evitar XSS.
   *
   * @param {Element|DocumentFragment} raiz
   * @param {Object} datos
   */
  function llenar(raiz, datos) {
    datos = datos || {};
    raiz.querySelectorAll('[data-campo]').forEach(function (el) {
      var clave = el.getAttribute('data-campo');
      var valor = datos[clave];
      var formato = FORMATOS[el.getAttribute('data-formato')];
      var vacio = el.hasAttribute('data-vacio') ? el.getAttribute('data-vacio') : '—';   // data-vacio="" deja el texto en blanco
      var texto = formato ? formato(valor) : (valor == null || valor === '' ? vacio : valor);
      el.textContent = texto;
    });
    raiz.querySelectorAll('[data-campo-src]').forEach(function (el) {
      var src = datos[el.getAttribute('data-campo-src')];
      if (src) { el.src = src; el.hidden = false; } else { el.removeAttribute('src'); el.hidden = true; }
    });
    raiz.querySelectorAll('[data-campo-valor]').forEach(function (el) {
      el.value = datos[el.getAttribute('data-campo-valor')] == null ? '' : datos[el.getAttribute('data-campo-valor')];
    });
    raiz.querySelectorAll('[data-campo-id]').forEach(function (el) {
      el.setAttribute('data-id', datos[el.getAttribute('data-campo-id')] == null ? '' : datos[el.getAttribute('data-campo-id')]);
    });
  }

  /**
   * Clona un <template> de la página y lo llena con datos.
   * @param {string} idPlantilla  id del elemento <template>.
   * @param {Object} datos
   * @returns {Element} Primer elemento de la plantilla, ya lleno.
   */
  function crearDesdePlantilla(idPlantilla, datos) {
    var plantilla = document.getElementById(idPlantilla);
    if (!plantilla) throw new Error('No existe la plantilla #' + idPlantilla);
    var fragmento = plantilla.content.cloneNode(true);
    llenar(fragmento, datos);
    return fragmento.firstElementChild;
  }

  /**
   * Dibuja una lista: limpia el contenedor, agrega un elemento por registro
   * y muestra u oculta el bloque de «estado vacío».
   *
   * @param {Object}   opciones
   * @param {Element}  opciones.contenedor   Donde se insertan los elementos.
   * @param {string}   opciones.plantilla    id del <template> de cada elemento.
   * @param {Array}    opciones.datos        Registros devueltos por la API.
   * @param {Element}  [opciones.vacio]      Elemento a mostrar si no hay registros.
   * @param {Function} [opciones.alCrear]    (elemento, registro) para ajustes extra.
   */
  function dibujarLista(opciones) {
    var datos = opciones.datos || [];
    opciones.contenedor.replaceChildren();
    datos.forEach(function (registro, indice) {
      var el = crearDesdePlantilla(opciones.plantilla, registro);
      if (opciones.alCrear) opciones.alCrear(el, registro, indice);
      opciones.contenedor.appendChild(el);
    });
    if (opciones.vacio) opciones.vacio.hidden = datos.length > 0;
    opciones.contenedor.hidden = datos.length === 0;
  }

  // ---------------------------------------------------------------------------
  // Interfaz: avisos, confirmaciones, parámetros
  // ---------------------------------------------------------------------------

  /**
   * Muestra un aviso flotante (toast) que desaparece solo.
   * @param {string} mensaje
   * @param {'exito'|'error'|'info'} [tipo='exito']
   * @param {number} [duracionMs=2800]
   */
  function aviso(mensaje, tipo, duracionMs) {
    var pila = document.querySelector('.avisos');
    if (!pila) {
      pila = document.createElement('div');
      pila.className = 'avisos';
      pila.setAttribute('role', 'status');
      pila.setAttribute('aria-live', 'polite');
      document.body.appendChild(pila);
    }
    var el = document.createElement('div');
    el.className = 'aviso aviso--' + (tipo || 'exito');
    el.textContent = mensaje;
    pila.appendChild(el);
    setTimeout(function () { el.remove(); }, duracionMs || 2800);
  }

  /**
   * Pide confirmación al usuario. Se centraliza aquí para poder cambiar
   * después el cuadro nativo por un modal propio sin tocar las pantallas.
   * @param {string} mensaje
   * @returns {Promise<boolean>}
   */
  function confirmar(mensaje) {
    return Promise.resolve(window.confirm(mensaje));
  }

  /**
   * Lee un parámetro de la URL: pagina.html?cliente=12 → "12".
   * @param {string} nombre
   * @returns {string|null}
   */
  function parametro(nombre) {
    return new URLSearchParams(window.location.search).get(nombre);
  }

  /**
   * Retrasa la ejecución hasta que el usuario deja de escribir.
   * @param {Function} fn
   * @param {number} [esperaMs=300]
   * @returns {Function}
   */
  function retrasar(fn, esperaMs) {
    var temporizador;
    return function () {
      var args = arguments, ctx = this;
      clearTimeout(temporizador);
      temporizador = setTimeout(function () { fn.apply(ctx, args); }, esperaMs || 300);
    };
  }

  /**
   * Activa el estado de «procesando» en un botón mientras dura una promesa.
   * @param {HTMLButtonElement} boton
   * @param {Promise} promesa
   * @returns {Promise}
   */
  function conCarga(boton, promesa) {
    if (!boton) return promesa;
    boton.disabled = true;
    boton.setAttribute('aria-busy', 'true');
    return promesa.finally(function () {
      boton.disabled = false;
      boton.removeAttribute('aria-busy');
    });
  }

  /**
   * Valida un teléfono mexicano de 10 dígitos.
   * @param {string} telefono
   * @returns {boolean}
   */
  function telefonoValido(telefono) {
    return /^\d{10}$/.test(String(telefono || '').replace(/\D/g, ''));
  }

  window.Utilidades = Object.freeze({
    formatoMoneda: formatoMoneda,
    formatoFecha: formatoFecha,
    formatoFechaLarga: formatoFechaLarga,
    formatoHora: formatoHora,
    formatoTelefono: formatoTelefono,
    fechaISO: fechaISO,
    aFecha: aFecha,
    iniciales: iniciales,
    normalizarTexto: normalizarTexto,
    llenar: llenar,
    crearDesdePlantilla: crearDesdePlantilla,
    dibujarLista: dibujarLista,
    aviso: aviso,
    confirmar: confirmar,
    parametro: parametro,
    retrasar: retrasar,
    conCarga: conCarga,
    telefonoValido: telefonoValido
  });
})();
