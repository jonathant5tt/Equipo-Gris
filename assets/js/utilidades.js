/**
 * @file utilidades.js
 * @description Funciones de apoyo reutilizadas por todas las pantallas:
 * formatos (moneda, fechas, horas de 12 h), plantillas HTML, avisos,
 * fotos, enlaces externos y validaciones.
 *
 * Expone el objeto global `Utilidades`. Requiere: config.js, idioma.js
 */
(function () {
  'use strict';

  var CFG = window.APP_CONFIG;
  var I = window.Idioma;
  var LOCALE = I ? I.locale : 'es-MX';
  var t = I ? I.t : function (x) { return x; };

  // ---------------------------------------------------------------------------
  // Formato de datos
  // ---------------------------------------------------------------------------

  var formatoMonedaMX = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CFG.MONEDA, minimumFractionDigits: 2 });

  /**
   * Moneda: 1250 → "$1,250.00".
   * @param {number|string|null} valor
   * @returns {string}
   */
  function formatoMoneda(valor) {
    var numero = Number(valor);
    return formatoMonedaMX.format(isFinite(numero) ? numero : 0);
  }

  /**
   * Convierte un valor de fecha del servidor en Date (hora local).
   * Acepta "2026-11-05", "2026-11-05 18:30:00" y "2026-11-05T18:30:00".
   * @param {string|Date|null} valor
   * @returns {Date|null}
   */
  function aFecha(valor) {
    if (!valor) return null;
    if (valor instanceof Date) return valor;
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(valor));
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    var fecha = new Date(valor);
    return isNaN(fecha.getTime()) ? null : fecha;
  }

  /** Fecha corta: "05/11/2026". */
  function formatoFecha(valor) {
    var f = aFecha(valor);
    return f ? f.toLocaleDateString(LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
  }

  /** Fecha larga: "jueves, 5 de noviembre de 2026". */
  function formatoFechaLarga(valor) {
    var f = aFecha(valor);
    return f ? f.toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '—';
  }

  /**
   * Hora en formato de 12 horas: "6:30 p. m.".
   * @param {string|Date} valor  También acepta "18:30:00" (columna TIME).
   * @returns {string}
   */
  function formatoHora(valor) {
    if (!valor) return '—';
    var f;
    var m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(valor));
    if (m) { f = new Date(2000, 0, 1, +m[1], +m[2]); } else { f = aFecha(valor); }
    return f ? f.toLocaleTimeString(LOCALE, { hour: 'numeric', minute: '2-digit', hour12: true }) : '—';
  }

  /** Hora de 24 h "18:30" (para campos <input type="time">). */
  function hora24(valor) {
    if (!valor) return '';
    var m = /(\d{1,2}):(\d{2})/.exec(String(valor));
    return m ? String(m[1]).padStart(2, '0') + ':' + m[2] : '';
  }

  /** Fecha y hora: "05/11/2026 · 6:30 p. m.". */
  function formatoFechaHora(valor) {
    return valor ? formatoFecha(valor) + ' · ' + formatoHora(aFecha(valor)) : '—';
  }

  /** Fecha "AAAA-MM-DD" en hora local (para enviar a la API). */
  function fechaISO(fecha) {
    var f = fecha || new Date();
    return f.getFullYear() + '-' + String(f.getMonth() + 1).padStart(2, '0') + '-' + String(f.getDate()).padStart(2, '0');
  }

  /** Suma días a una fecha "AAAA-MM-DD". */
  function sumarDias(fechaTexto, dias) {
    var f = aFecha(fechaTexto);
    f.setDate(f.getDate() + dias);
    return fechaISO(f);
  }

  /** Teléfono legible: "2281234567" → "228 123 4567". */
  function formatoTelefono(telefono) {
    var d = String(telefono || '').replace(/\D/g, '');
    return d.length === 10 ? d.replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2 $3') : (telefono || '—');
  }

  /** Iniciales para avatares: "Carlos Mendoza" → "CM". */
  function iniciales(nombre) {
    return String(nombre || '?').trim().split(/\s+/).slice(0, 2)
      .map(function (p) { return p.charAt(0).toUpperCase(); }).join('');
  }

  /** Quita acentos y pasa a minúsculas para comparar textos. */
  function normalizarTexto(texto) {
    return String(texto || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  /** Formatos disponibles para `data-formato` en las plantillas. */
  var FORMATOS = {
    moneda: formatoMoneda,
    fecha: formatoFecha,
    fechaLarga: formatoFechaLarga,
    hora: formatoHora,
    fechaHora: formatoFechaHora,
    telefono: formatoTelefono,
    iniciales: iniciales,
    mayusculas: function (v) { return String(v == null ? '' : v).toUpperCase(); }
  };

  // ---------------------------------------------------------------------------
  // Plantillas HTML (<template>) y llenado de datos
  // ---------------------------------------------------------------------------

  /**
   * Llena un elemento con los valores de `datos` usando atributos declarativos:
   *   data-campo="Nombre"                  → textContent = datos.Nombre
   *   data-campo="Total" data-formato="moneda"
   *   data-traducir                        → el valor se traduce (estados, métodos de pago)
   *   data-campo-src="FotoCorteReferencia" → atributo src (rutas del servidor incluidas)
   *   data-campo-valor="ID_Cliente"        → atributo value
   *   data-campo-id="ID_Venta"             → atributo data-id (para acciones)
   *   data-vacio="Texto"                   → texto si el valor viene vacío (por omisión «—»)
   * Los valores se insertan como texto (nunca como HTML) para evitar XSS.
   *
   * @param {Element|DocumentFragment} raiz
   * @param {Object} datos
   */
  function llenar(raiz, datos) {
    datos = datos || {};
    raiz.querySelectorAll('[data-campo]').forEach(function (el) {
      var valor = datos[el.getAttribute('data-campo')];
      var formato = FORMATOS[el.getAttribute('data-formato')];
      var vacio = el.hasAttribute('data-vacio') ? t(el.getAttribute('data-vacio')) : '—';
      var texto = formato ? (valor == null || valor === '' ? vacio : formato(valor)) : (valor == null || valor === '' ? vacio : valor);
      el.textContent = el.hasAttribute('data-traducir') ? t(String(texto)) : texto;
    });
    raiz.querySelectorAll('[data-campo-src]').forEach(function (el) {
      var src = datos[el.getAttribute('data-campo-src')];
      if (src) { el.src = urlArchivo(src); el.hidden = false; } else { el.removeAttribute('src'); el.hidden = true; }
    });
    // Avatar con la foto de corte de referencia (si no hay foto, quedan las iniciales).
    raiz.querySelectorAll('[data-avatar-foto]').forEach(function (el) {
      ponerFotoAvatar(el, datos[el.getAttribute('data-avatar-foto')]);
    });
    raiz.querySelectorAll('[data-campo-valor]').forEach(function (el) {
      var v = datos[el.getAttribute('data-campo-valor')];
      el.value = v == null ? '' : v;
    });
    raiz.querySelectorAll('[data-campo-id]').forEach(function (el) {
      var v = datos[el.getAttribute('data-campo-id')];
      el.setAttribute('data-id', v == null ? '' : v);
    });
  }

  /**
   * Clona un <template> de la página y lo llena con datos.
   * @param {string} idPlantilla
   * @param {Object} datos
   * @returns {Element}
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
   * @param {{contenedor: Element, plantilla: string, datos: Array, vacio?: Element, alCrear?: Function}} opciones
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

  /**
   * Llena un <select> con opciones de datos (los textos de los datos no se traducen).
   * @param {HTMLSelectElement} select
   * @param {Array<Object>} datos
   * @param {(d: Object) => string} texto
   * @param {string} campoValor
   * @param {string} [primera]  Texto de la primera opción vacía.
   */
  function llenarSelect(select, datos, texto, campoValor, primera) {
    select.replaceChildren();
    if (primera) select.add(new Option(t(primera), ''));
    (datos || []).forEach(function (d) {
      var o = new Option(texto(d), d[campoValor]);
      o.setAttribute('data-dato', '');
      select.add(o);
    });
  }

  // ---------------------------------------------------------------------------
  // Interfaz: avisos, confirmaciones, parámetros
  // ---------------------------------------------------------------------------

  /**
   * Muestra un aviso flotante que desaparece solo.
   * @param {string} mensaje
   * @param {'exito'|'error'|'info'} [tipo='exito']
   * @param {number} [duracionMs]
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
    el.textContent = t(mensaje);
    pila.appendChild(el);
    setTimeout(function () { el.remove(); }, duracionMs || (tipo === 'error' ? 4500 : 2800));
  }

  /**
   * Pide confirmación al usuario.
   * @param {string} mensaje
   * @returns {Promise<boolean>}
   */
  function confirmar(mensaje) { return Promise.resolve(window.confirm(mensaje)); }

  /** Parámetro de la URL: pagina.html?cliente=12 → "12". */
  function parametro(nombre) { return new URLSearchParams(window.location.search).get(nombre); }

  /** Retrasa la ejecución hasta que el usuario deja de escribir. */
  function retrasar(fn, esperaMs) {
    var temporizador;
    return function () {
      var args = arguments, ctx = this;
      clearTimeout(temporizador);
      temporizador = setTimeout(function () { fn.apply(ctx, args); }, esperaMs || 300);
    };
  }

  /** Estado «procesando» en un botón mientras dura una promesa. */
  function conCarga(boton, promesa) {
    if (!boton) return promesa;
    boton.disabled = true;
    boton.setAttribute('aria-busy', 'true');
    return promesa.finally(function () {
      boton.disabled = false;
      boton.removeAttribute('aria-busy');
    });
  }

  /** Teléfono mexicano de 10 dígitos. */
  function telefonoValido(telefono) { return /^\d{10}$/.test(String(telefono || '').replace(/\D/g, '')); }

  // ---------------------------------------------------------------------------
  // Dirección del servidor
  // ---------------------------------------------------------------------------

  /**
   * Completa lo que escribe el usuario: "192.168.1.70" → "http://192.168.1.70:3000".
   * @param {string} texto
   * @returns {string}
   */
  function normalizarServidor(texto) {
    var s = String(texto || '').trim().replace(/\/+$/, '').replace(/\/api$/, '');
    if (!s) return '';
    if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
    try {
      var u = new URL(s);
      if (!u.port && u.protocol === 'http:' && !/\.[a-z]{2,}$/i.test(u.hostname)) u.port = '3000';
      return u.origin;
    } catch (e) { return ''; }
  }

  /**
   * Comprueba que en la dirección responda el servidor de Engreídos.  GET /api/salud
   * @param {string} servidor  Ej. "http://192.168.1.70:3000"
   * @returns {Promise<Object>} Respuesta de /api/salud
   */
  async function probarServidor(servidor) {
    var control = new AbortController();
    var temporizador = setTimeout(function () { control.abort(); }, 8000);
    try {
      var r = await fetch(servidor + '/api/salud', { signal: control.signal, cache: 'no-store' });
      var datos = await r.json().catch(function () { return null; });
      if (!r.ok || !datos || datos.estado !== 'ok') throw new Error('respuesta');
      return datos;
    } catch (e) {
      throw new Error(t('No se encontró el servidor en {url}. Revisa que la computadora esté encendida, con el servidor iniciado y en la misma red Wi-Fi.', { url: servidor }));
    } finally { clearTimeout(temporizador); }
  }

  /**
   * Busca el servidor en la red Wi-Fi (puerto 3000) probando las direcciones
   * de la misma red que el teléfono. En la app de Android la IP del teléfono
   * la da el puente nativo; si no, se prueban las redes domésticas más comunes.
   * @param {(avance: number) => void} [alAvanzar]  Porcentaje 0–100.
   * @returns {Promise<string|null>} Dirección encontrada o null.
   */
  async function buscarServidor(alAvanzar) {
    var redes = [];
    try {
      var ip = window.EngreidosAndroid && window.EngreidosAndroid.ipLocal ? String(window.EngreidosAndroid.ipLocal() || '') : '';
      ip.split(',').forEach(function (x) { var m = /^(\d+\.\d+\.\d+)\.\d+$/.exec(x.trim()); if (m && redes.indexOf(m[1]) === -1) redes.push(m[1]); });
    } catch (e) { /* sin puente */ }
    // Sin la IP del teléfono se prueban las redes domésticas más comunes.
    if (!redes.length) redes = ['192.168.1', '192.168.0', '192.168.100', '192.168.2', '10.0.0', '192.168.8', '192.168.43', '192.168.137'];

    var candidatos = [];
    redes.forEach(function (red) { for (var h = 1; h < 255; h += 1) candidatos.push('http://' + red + '.' + h + ':3000'); });
    var encontrado = null;
    var hechos = 0;
    var indice = 0;

    function probar(url) {
      var control = new AbortController();
      var t = setTimeout(function () { control.abort(); }, 1500);
      return fetch(url + '/api/salud', { signal: control.signal, cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { if (d && d.estado === 'ok' && !encontrado) encontrado = url; })
        .catch(function () { /* no está ahí */ })
        .finally(function () { clearTimeout(t); hechos += 1; if (alAvanzar) alAvanzar(Math.round(hechos * 100 / candidatos.length)); });
    }
    async function trabajador() {
      while (!encontrado && indice < candidatos.length) { var url = candidatos[indice]; indice += 1; await probar(url); }
    }
    var trabajadores = [];
    for (var i = 0; i < 48; i += 1) trabajadores.push(trabajador());
    await Promise.all(trabajadores);
    return encontrado;
  }

  // ---------------------------------------------------------------------------
  // Archivos, fotos y enlaces
  // ---------------------------------------------------------------------------

  /**
   * Pone la foto de referencia del cliente dentro de un avatar (.avatar). Al
   * tocarla se ve en grande. Si no hay foto o no carga, quedan las iniciales.
   * @param {Element} el
   * @param {string} [ruta]  "/uploads/clientes/…"
   * @param {string} [titulo]
   */
  function ponerFotoAvatar(el, ruta, titulo) {
    if (!el) return;
    var anterior = el.querySelector('.avatar__foto');
    if (anterior) anterior.remove();
    el.classList.remove('avatar--foto');
    el.onclick = null;
    if (!ruta) return;
    var img = document.createElement('img');
    img.className = 'avatar__foto';
    img.alt = t('Foto de corte de referencia');
    img.loading = 'lazy';
    img.onerror = function () { img.remove(); el.classList.remove('avatar--foto'); el.onclick = null; };
    img.src = urlArchivo(ruta);
    el.appendChild(img);
    el.classList.add('avatar--foto');
    el.title = t('Ver foto de corte de referencia');
    el.onclick = function (e) {
      e.preventDefault();
      e.stopPropagation();
      verFoto(ruta, titulo || t('Corte de referencia'));
    };
  }

  /** Muestra una foto en grande sobre la pantalla (toque o Esc para cerrar). */
  function verFoto(ruta, titulo) {
    var capa = document.createElement('div');
    capa.className = 'visor-rapido';
    capa.setAttribute('role', 'dialog');
    capa.setAttribute('aria-modal', 'true');
    capa.setAttribute('aria-label', titulo || t('Foto'));
    var marco = document.createElement('figure');
    marco.className = 'visor-rapido__marco';
    var img = document.createElement('img');
    img.src = urlArchivo(ruta);
    img.alt = titulo || '';
    var pie = document.createElement('figcaption');
    pie.textContent = (titulo ? titulo + ' · ' : '') + t('Toca para cerrar');
    marco.appendChild(img);
    marco.appendChild(pie);
    capa.appendChild(marco);
    function cerrar() { capa.remove(); document.removeEventListener('keydown', tecla); }
    function tecla(e) { if (e.key === 'Escape') cerrar(); }
    capa.addEventListener('click', cerrar);
    document.addEventListener('keydown', tecla);
    document.body.appendChild(capa);
  }

  // ---------------------------------------------------------------------------
  // Archivos CSV (Excel, Google Sheets…)
  // ---------------------------------------------------------------------------

  /**
   * Celda que Excel debe mostrar tal cual, como texto (no la convierte en
   * fecha ni en número). Se usa para fecha y hora: así no aparece «#####».
   */
  function textoCSV(valor) { return { csvTexto: valor == null ? '' : String(valor) }; }

  /** Una celda CSV: entre comillas si hace falta; los textos «=…» o «+…» se neutralizan. */
  function celdaCSV(valor) {
    if (valor && typeof valor === 'object' && 'csvTexto' in valor) {
      // ="06/11/26" → Excel lo muestra como texto. En CSV las comillas se duplican.
      return '"=""' + valor.csvTexto.replace(/"/g, '""""') + '"""';
    }
    var texto = valor == null ? '' : String(valor);
    if (/^[=+\-@]/.test(texto) && !/^-?\d+(\.\d+)?$/.test(texto)) return celdaCSV(textoCSV(texto));
    return /[",\r\n;]/.test(texto) ? '"' + texto.replace(/"/g, '""') + '"' : texto;
  }

  /**
   * Arma un CSV para Excel: UTF-8 con BOM (acentos correctos), comas y
   * renglones CRLF.
   * @param {Array<Array>} filas
   * @returns {string}
   */
  function csv(filas) {
    return '﻿' + filas.map(function (f) { return (f || []).map(celdaCSV).join(','); }).join('\r\n') + '\r\n';
  }

  /**
   * Fecha y hora para CSV en columnas separadas, como texto corto que cabe en
   * la columna de Excel: { fecha: "06/11/26", hora: "18:58" }.
   * @param {string|Date} valor  "AAAA-MM-DD HH:MM:SS" o Date
   */
  function fechaHoraCSV(valor) {
    var f = aFecha(valor);
    if (!f) return { fecha: textoCSV(''), hora: textoCSV('') };
    var dos = function (n) { return (n < 10 ? '0' : '') + n; };
    return {
      fecha: textoCSV(dos(f.getDate()) + '/' + dos(f.getMonth() + 1) + '/' + dos(f.getFullYear() % 100)),
      hora: textoCSV(dos(f.getHours()) + ':' + dos(f.getMinutes()))
    };
  }

  function bytesABase64(bytes) {
    var texto = '';
    for (var i = 0; i < bytes.length; i += 0x8000) texto += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(texto);
  }

  /**
   * Descarga un archivo de texto. En la app de Android lo guarda en
   * «Descargas/Engreidos» y ofrece compartirlo (WhatsApp, correo, Drive…).
   * @param {string} nombre     Ej. "ventas_2026-11-01_2026-11-06.csv"
   * @param {string} contenido
   * @param {string} [tipo]     Tipo MIME (por omisión CSV)
   * @returns {Promise<string>} Dónde quedó el archivo.
   */
  async function descargarArchivo(nombre, contenido, tipo) {
    tipo = tipo || 'text/csv';
    var android = window.EngreidosAndroid;
    if (android) {
      if (typeof android.guardarArchivo !== 'function') {
        throw new Error(t('Actualiza la app de Android a la versión 2.4 o posterior para exportar archivos.'));
      }
      var r = {};
      try { r = JSON.parse(android.guardarArchivo(nombre, tipo, bytesABase64(new TextEncoder().encode(contenido))) || '{}'); }
      catch (e) { r = { error: e.message }; }
      if (r.error === 'PERMISO') throw new Error(t('Permite que la app guarde archivos y vuelve a intentarlo.'));
      if (!r.ok) throw new Error(r.error || t('No se pudo guardar el archivo.'));
      aviso(t('Archivo guardado en {ruta}', { ruta: r.ruta }));
      if (typeof android.compartirArchivo === 'function' &&
          await confirmar(t('Archivo guardado en {ruta}. ¿Quieres compartirlo (WhatsApp, correo, Drive…)?', { ruta: r.ruta }))) {
        var c = android.compartirArchivo(r.uri, tipo);
        if (c && c !== 'OK') aviso(t(c), 'error');
      }
      return r.ruta;
    }
    var archivo = new Blob([contenido], { type: tipo + ';charset=utf-8' });
    var enlace = document.createElement('a');
    enlace.href = URL.createObjectURL(archivo);
    enlace.download = nombre;
    document.body.appendChild(enlace);
    enlace.click();
    setTimeout(function () { URL.revokeObjectURL(enlace.href); enlace.remove(); }, 1500);
    return nombre;
  }

  /** Ruta del servidor ("/uploads/…") → URL completa (necesario en la app de Android). */
  function urlArchivo(ruta) {
    if (!ruta) return '';
    if (/^(https?:|data:|blob:)/.test(ruta)) return ruta;
    return CFG.SERVIDOR.replace(/\/+$/, '') + ruta;
  }

  /**
   * Reduce una foto (lado mayor FOTO_MAXIMO_PX) y la convierte a JPEG en base64.
   * @param {File} archivo
   * @returns {Promise<string>} data URL "data:image/jpeg;base64,…"
   */
  function prepararFoto(archivo) {
    return new Promise(function (resolver, rechazar) {
      if (!archivo || !/^image\//.test(archivo.type)) { rechazar(new Error(t('El archivo no es una imagen.'))); return; }
      var url = URL.createObjectURL(archivo);
      var img = new Image();
      img.onload = function () {
        var escala = Math.min(1, CFG.FOTO_MAXIMO_PX / Math.max(img.naturalWidth, img.naturalHeight));
        var lienzo = document.createElement('canvas');
        lienzo.width = Math.round(img.naturalWidth * escala);
        lienzo.height = Math.round(img.naturalHeight * escala);
        lienzo.getContext('2d').drawImage(img, 0, 0, lienzo.width, lienzo.height);
        URL.revokeObjectURL(url);
        resolver(lienzo.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = function () { URL.revokeObjectURL(url); rechazar(new Error(t('No se pudo leer la imagen.'))); };
      img.src = url;
    });
  }

  /**
   * Abre un enlace externo (WhatsApp, SMS) en la app correspondiente.
   * En la app de Android lo abre el puente nativo; en el navegador, una pestaña nueva.
   * @param {string} url
   */
  function abrirExterno(url) {
    if (!url) return;
    if (window.EngreidosAndroid && window.EngreidosAndroid.abrirEnlace) { window.EngreidosAndroid.abrirEnlace(url); return; }
    if (/^sms:/.test(url)) { window.location.href = url; return; }
    var ventana = window.open(url, '_blank', 'noopener');
    if (!ventana) window.location.href = url;
  }

  // ---------------------------------------------------------------------------
  // Textos de estados (se traducen con Idioma)
  // ---------------------------------------------------------------------------

  var ESTADOS_CITA = {
    Agendada: { texto: 'Agendada', clase: '' },
    EnEspera: { texto: 'En espera', clase: 'insignia--alerta' },
    EnAtencion: { texto: 'En atención', clase: 'insignia--oro' },
    Atendida: { texto: 'Atendida', clase: 'insignia--exito' },
    Cancelada: { texto: 'Cancelada', clase: 'insignia--error' },
    NoAsistio: { texto: 'No asistió', clase: 'insignia--error' }
  };

  /** @returns {{texto: string, clase: string}} Texto traducido e insignia de un estado de cita. */
  function estadoCita(estado) {
    var e = ESTADOS_CITA[estado] || { texto: estado || '—', clase: '' };
    return { texto: t(e.texto), clase: e.clase };
  }

  // ---------------------------------------------------------------------------
  // Beneficios de membresía (GET /membresias → Beneficios[])
  // ---------------------------------------------------------------------------

  /**
   * Regla de un beneficio en palabras: «Corte clásico: gratis · 1 por visita».
   * @param {Object} b  { Aplica, NombreServicio, NombreProducto, Categoria, Tipo, Porcentaje, Usos, Periodo, Etiqueta }
   * @returns {string}
   */
  function reglaBeneficio(b) {
    if (b.Aplica === 'Texto') return t('Beneficio informativo (no cambia el precio)');
    var sobre = b.Aplica === 'Producto' ? (b.NombreProducto || t('Producto'))
      : b.Aplica === 'Categoria' ? t('Categoría «{c}»', { c: b.Categoria || '' })
      : b.Aplica === 'Productos' ? t('Todos los productos')
      : (b.NombreServicio || t('Servicio'));
    var que = b.Tipo === 'Descuento' ? t('{p} % de descuento', { p: Number(b.Porcentaje) }) : t('gratis');
    var usos = b.Usos == null || b.Usos === '' ? t('ilimitado')
      : t(b.Periodo === 'Visita' ? '{n} por visita' : '{n} al mes', { n: b.Usos });
    return sobre + ': ' + que + ' · ' + usos;
  }

  /** «20 %» o «$30» de un descuento (promoción). */
  function valorDescuento(d) {
    return d.Tipo === 'Porcentaje' ? Number(d.Valor) + ' %' : formatoMoneda(d.Valor);
  }

  /** A qué aplica un descuento: «Todo», «Barba», «Productos de Cabello»… */
  function alcanceDescuento(d) {
    var t = window.Idioma.t;
    if (d.Aplica === 'Todo') return t('Toda la venta');
    if (d.Aplica === 'Servicios') return d.NombreServicio || t('Todos los servicios');
    if (d.Aplica === 'Membresias') return d.NombrePlan ? t('Membresía') + ' ' + d.NombrePlan : t('Todas las membresías');
    return d.NombreProducto || (d.Categoria ? t('Productos de {categoria}', { categoria: d.Categoria }) : t('Todos los productos'));
  }

  /**
   * Texto que ve el cliente: la etiqueta del cartel («Corte para amigo») o, si
   * no tiene, la regla.
   */
  function textoBeneficio(b) {
    return (b.Etiqueta && String(b.Etiqueta).trim()) || reglaBeneficio(b);
  }

  // ---------------------------------------------------------------------------
  // Respaldo sin conexión para los íconos
  // ---------------------------------------------------------------------------
  // Los íconos usan la fuente «Material Symbols» de Google. Si no se puede
  // descargar (sin internet), se marca <html class="sin-iconos"> para ocultar
  // los nombres de los íconos (ver comun.css).
  // La fuente se descarga sin bloquear la pantalla: los íconos quedan ocultos
  // hasta que la fuente está lista (sin internet, se quedan ocultos).
  if (document.fonts && document.fonts.load) {
    var raiz = document.documentElement;
    raiz.classList.add('sin-iconos');
    var revisarIconos = function () {
      if (!raiz.classList.contains('sin-iconos')) return;
      document.fonts.load('20px "Material Symbols Outlined"', 'home')
        .then(function (fuentes) { if (fuentes.length) raiz.classList.remove('sin-iconos'); })
        .catch(function () { /* sin internet */ });
    };
    revisarIconos();
    if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', revisarIconos);
    [500, 1500, 4000, 10000].forEach(function (ms) { setTimeout(revisarIconos, ms); });
  }

  window.Utilidades = Object.freeze({
    formatoMoneda: formatoMoneda,
    formatoFecha: formatoFecha,
    formatoFechaLarga: formatoFechaLarga,
    formatoHora: formatoHora,
    formatoFechaHora: formatoFechaHora,
    hora24: hora24,
    formatoTelefono: formatoTelefono,
    fechaISO: fechaISO,
    sumarDias: sumarDias,
    aFecha: aFecha,
    iniciales: iniciales,
    normalizarTexto: normalizarTexto,
    llenar: llenar,
    crearDesdePlantilla: crearDesdePlantilla,
    dibujarLista: dibujarLista,
    llenarSelect: llenarSelect,
    aviso: aviso,
    confirmar: confirmar,
    parametro: parametro,
    retrasar: retrasar,
    conCarga: conCarga,
    telefonoValido: telefonoValido,
    urlArchivo: urlArchivo,
    ponerFotoAvatar: ponerFotoAvatar,
    csv: csv,
    textoCSV: textoCSV,
    fechaHoraCSV: fechaHoraCSV,
    descargarArchivo: descargarArchivo,
    verFoto: verFoto,
    normalizarServidor: normalizarServidor,
    probarServidor: probarServidor,
    buscarServidor: buscarServidor,
    prepararFoto: prepararFoto,
    abrirExterno: abrirExterno,
    estadoCita: estadoCita,
    reglaBeneficio: reglaBeneficio,
    textoBeneficio: textoBeneficio,
    valorDescuento: valorDescuento,
    alcanceDescuento: alcanceDescuento,
    t: t
  });
})();
