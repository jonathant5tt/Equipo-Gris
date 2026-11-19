/**
 * @file idioma.js
 * @description Idiomas de la interfaz: español (predeterminado), inglés e italiano.
 *
 * Cómo funciona:
 *  - Los textos se escriben en español en el HTML y en el código.
 *  - Si el idioma elegido no es español, se carga su diccionario
 *    (assets/js/idiomas/en.js o it.js) que relaciona «texto en español» →
 *    «traducción».
 *  - Un observador recorre la pantalla y traduce los textos y los atributos
 *    placeholder, title, aria-label y alt, incluso los que se agregan después
 *    (listas, avisos, ventanas).
 *  - Los datos de la base (nombres de clientes, servicios…) no se traducen:
 *    los elementos con data-campo o translate="no" se respetan tal cual.
 *  - En JavaScript los textos con variables usan Idioma.t():
 *      Idioma.t('{n} turnos asignados', { n: 3 })
 *
 * El idioma se guarda en el dispositivo (Ajustes → Idioma).
 * Expone el objeto global `Idioma`. Requiere: config.js
 */
(function () {
  'use strict';

  var CLAVE = 'engreidos.idioma';

  /** Idiomas disponibles y su configuración regional para fechas y números. */
  var IDIOMAS = {
    es: { nombre: 'Español', locale: 'es-MX' },
    en: { nombre: 'English', locale: 'en-US' },
    it: { nombre: 'Italiano', locale: 'it-IT' }
  };

  var actual = 'es';
  try { actual = JSON.parse(window.localStorage.getItem(CLAVE) || '"es"'); } catch (e) { actual = 'es'; }
  if (!IDIOMAS[actual]) actual = 'es';

  document.documentElement.lang = actual;
  window.DICCIONARIOS = window.DICCIONARIOS || {};

  // Carga síncrona del diccionario (el script se agrega mientras se lee el <head>).
  if (actual !== 'es' && document.readyState === 'loading') {
    var base = (document.currentScript && document.currentScript.src || '').replace(/idioma\.js(\?.*)?$/, '');
    document.write('<script src="' + base + 'idiomas/' + actual + '.js"><\/script>');
  }

  /** @returns {{textos: Object<string,string>, patrones: Array}} Diccionario activo. */
  function diccionario() { return window.DICCIONARIOS[actual] || { textos: {}, patrones: [] }; }

  /** Reemplaza {variables} en un texto. */
  function interpolar(texto, vars) {
    if (!vars) return texto;
    return texto.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] == null ? m : vars[k]; });
  }

  /**
   * Traduce un texto escrito en español.
   * @param {string} texto  Texto original (puede llevar {variables}).
   * @param {Object} [vars] Valores para las variables.
   * @returns {string}
   */
  function t(texto, vars) {
    if (actual === 'es' || texto == null) return interpolar(String(texto), vars);
    var d = diccionario();
    var traducido = d.textos[texto];
    if (traducido === undefined) traducido = traducirPatron(String(texto)) || texto;
    return interpolar(traducido, vars);
  }

  /** Busca un patrón (expresión regular) para textos que llegan con números o nombres. */
  function traducirPatron(texto) {
    var patrones = diccionario().patrones || [];
    for (var i = 0; i < patrones.length; i += 1) {
      var m = patrones[i][0].exec(texto);
      if (m) {
        var destino = patrones[i][1];
        return typeof destino === 'function' ? destino.apply(null, m) : texto.replace(patrones[i][0], destino);
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Traducción automática de la pantalla
  // ---------------------------------------------------------------------------

  var ATRIBUTOS = ['placeholder', 'title', 'aria-label', 'alt'];

  /** ¿El texto está dentro de datos que no se traducen? */
  function excluido(el) {
    return !!(el && el.closest && el.closest('[data-campo],[translate="no"],.icono,script,style,textarea,option[data-dato]'));
  }

  function traducirTexto(nodo) {
    var original = nodo.nodeValue;
    var recortado = original.trim();
    if (!recortado || recortado.length > 600 || excluido(nodo.parentElement)) return;
    var limpio = recortado.replace(/\s+/g, ' ');   // el HTML puede partir el texto en varias líneas
    var d = diccionario();
    var nuevo = d.textos[limpio];
    if (nuevo === undefined) nuevo = traducirPatron(limpio);
    if (nuevo != null && nuevo !== limpio) nodo.nodeValue = original.replace(recortado, nuevo);
  }

  function traducirAtributos(el) {
    if (el.closest && el.closest('[translate="no"]')) return;
    ATRIBUTOS.forEach(function (a) {
      var v = el.getAttribute(a);
      if (!v) return;
      var nuevo = diccionario().textos[v.trim()];
      if (nuevo !== undefined && nuevo !== v) el.setAttribute(a, nuevo);
    });
  }

  /**
   * Traduce un elemento y todo su contenido.
   * @param {Node} raiz
   */
  function traducir(raiz) {
    if (actual === 'es' || !raiz) return;
    if (raiz.nodeType === 3) { traducirTexto(raiz); return; }
    if (raiz.nodeType !== 1 && raiz.nodeType !== 11) return;
    if (raiz.nodeType === 1) traducirAtributos(raiz);
    var recorrido = document.createTreeWalker(raiz, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    var nodo;
    while ((nodo = recorrido.nextNode())) {
      if (nodo.nodeType === 3) traducirTexto(nodo);
      else traducirAtributos(nodo);
    }
  }

  if (actual !== 'es') {
    var observador = new MutationObserver(function (cambios) {
      cambios.forEach(function (c) {
        if (c.type === 'childList') c.addedNodes.forEach(traducir);
        else if (c.type === 'characterData') traducirTexto(c.target);
        else if (c.type === 'attributes') traducirAtributos(c.target);
      });
    });
    var iniciar = function () {
      traducir(document.body);
      document.title = t(document.title.split(' · ')[0]) + (document.title.indexOf(' · ') > -1 ? ' · ' + document.title.split(' · ')[1] : '');
      observador.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATRIBUTOS });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
    else iniciar();

    // Cuadros nativos de confirmación y alerta también se traducen.
    var confirmarNativo = window.confirm.bind(window);
    window.confirm = function (m) { return confirmarNativo(t(m)); };
    var alertaNativa = window.alert.bind(window);
    window.alert = function (m) { return alertaNativa(t(m)); };
  }

  /**
   * Cambia el idioma y recarga la pantalla.
   * @param {'es'|'en'|'it'} codigo
   */
  function cambiar(codigo) {
    if (!IDIOMAS[codigo]) return;
    try { window.localStorage.setItem(CLAVE, JSON.stringify(codigo)); } catch (e) { /* sin almacenamiento */ }
    window.location.reload();
  }

  window.Idioma = Object.freeze({
    IDIOMAS: IDIOMAS,
    actual: actual,
    locale: IDIOMAS[actual].locale,
    t: t,
    traducir: traducir,
    cambiar: cambiar
  });
})();
