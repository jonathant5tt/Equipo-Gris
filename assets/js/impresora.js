/**
 * @file impresora.js
 * @description Impresión del ticket en impresoras térmicas de 58 mm
 * (ESC/POS, 32 caracteres por renglón, 384 puntos de ancho), por ejemplo la
 * «Impresora Bluetooth-58MM» con USB y Bluetooth.
 *
 * Formas de conexión (Ajustes → Impresora; la elección se guarda en el equipo):
 *   'android'  App de Android: impresora Bluetooth vinculada en el teléfono
 *              (puente nativo EngreidosAndroid).
 *   'sistema'  Impresora instalada en la computadora o en el teléfono (USB o
 *              Bluetooth): abre el diálogo de impresión con formato de 58 mm.
 *   'serie'    Chrome/Edge en computadora: USB o Bluetooth emparejado que
 *              aparece como puerto COM (Web Serial), envío directo ESC/POS.
 *   'ble'      Chrome en Android o computadora: impresoras Bluetooth de baja
 *              energía (Web Bluetooth), envío directo ESC/POS.
 *
 * Expone el objeto global `Impresora`. Requiere: idioma.js, utilidades.js
 * Opcional: componentes/logo-engreidos.js (logotipo impreso).
 */
(function () {
  'use strict';

  var CLAVE = 'engreidos.impresora';
  var COLUMNAS = 32;
  var ANCHO_PUNTOS = 384;
  var t = function (x, v) { return window.Idioma.t(x, v); };

  // ---------------------------------------------------------------------------
  // Configuración guardada en el equipo
  // ---------------------------------------------------------------------------

  /** @returns {{tipo: 'android'|'sistema'|'serie'|'ble', direccion?: string, nombre?: string, logo?: boolean, velocidad?: number}} */
  function configuracion() {
    var guardada = null;
    try { guardada = JSON.parse(window.localStorage.getItem(CLAVE) || 'null'); } catch (e) { guardada = null; }
    return guardada || { tipo: window.EngreidosAndroid ? 'android' : 'sistema', logo: true };
  }

  function guardar(cfg) {
    try { window.localStorage.setItem(CLAVE, JSON.stringify(cfg)); } catch (e) { /* sin almacenamiento */ }
  }

  /** Formas de conexión disponibles en este equipo. */
  function disponibles() {
    return {
      android: !!(window.EngreidosAndroid && window.EngreidosAndroid.imprimir),
      sistema: !window.EngreidosAndroid || !!(window.EngreidosAndroid && window.EngreidosAndroid.imprimirPagina),
      serie: !!navigator.serial,
      ble: !!navigator.bluetooth
    };
  }

  /** Impresoras Bluetooth vinculadas en el teléfono (app de Android). */
  function listarAndroid() {
    if (!window.EngreidosAndroid) return { error: t('Solo disponible en la app de Android.') };
    try { return JSON.parse(window.EngreidosAndroid.listarImpresoras() || '[]'); } catch (e) { return { error: String(e.message || e) }; }
  }

  // ---------------------------------------------------------------------------
  // Codificación de texto (página de códigos PC850, con acentos y ñ)
  // ---------------------------------------------------------------------------

  var PC850 = {
    'Ç': 0x80, 'ü': 0x81, 'é': 0x82, 'â': 0x83, 'ä': 0x84, 'à': 0x85, 'ç': 0x87, 'ê': 0x88, 'ë': 0x89, 'è': 0x8a,
    'ï': 0x8b, 'î': 0x8c, 'ì': 0x8d, 'Ä': 0x8e, 'É': 0x90, 'ô': 0x93, 'ö': 0x94, 'ò': 0x95, 'û': 0x96, 'ù': 0x97,
    'Ö': 0x99, 'Ü': 0x9a, 'á': 0xa0, 'í': 0xa1, 'ó': 0xa2, 'ú': 0xa3, 'ñ': 0xa4, 'Ñ': 0xa5, 'ª': 0xa6, 'º': 0xa7,
    '¿': 0xa8, '¡': 0xad, 'Á': 0xb5, 'Â': 0xb6, 'À': 0xb7, 'Í': 0xd6, 'Ó': 0xe0, 'Ú': 0xe9, '°': 0xf8, '·': 0xfa
  };
  var SUSTITUTOS = { '•': '·', '—': '-', '–': '-', '«': '"', '»': '"', '“': '"', '”': '"', '‘': "'", '’': "'", '…': '...', '×': 'x', '−': '-', ' ': ' ', ' ': ' ' };

  /** Texto → bytes PC850 (los caracteres sin equivalente se cambian por «?»). */
  function codificar(texto) {
    var bytes = [];
    Array.from(String(texto)).forEach(function (c) {
      c = SUSTITUTOS[c] || c;
      var code = c.charCodeAt(0);
      if (code >= 32 && code < 127) bytes.push(code);
      else if (PC850[c] !== undefined) bytes.push(PC850[c]);
      else if (c === '\n') bytes.push(10);
      else if (code > 0xffff || /\p{Extended_Pictographic}/u.test(c)) { /* emoji: se omite */ }
      else bytes.push(63);
    });
    return bytes;
  }

  // ---------------------------------------------------------------------------
  // Documento ESC/POS
  // ---------------------------------------------------------------------------

  function Documento() { this.bytes = [0x1b, 0x40, 0x1b, 0x74, 0x02]; }   // ESC @ (inicio) · ESC t 2 (PC850)
  Documento.prototype = {
    raw: function (arr) { Array.prototype.push.apply(this.bytes, arr); return this; },
    alinear: function (pos) { return this.raw([0x1b, 0x61, { izquierda: 0, centro: 1, derecha: 2 }[pos] || 0]); },
    negrita: function (si) { return this.raw([0x1b, 0x45, si ? 1 : 0]); },
    doble: function (si) { return this.raw([0x1d, 0x21, si ? 0x11 : 0x00]); },
    texto: function (s) { return this.raw(codificar(s)); },
    linea: function (s) { return this.texto(s || '').raw([0x0a]); },
    separador: function () { return this.linea('-'.repeat(COLUMNAS)); },
    /** Texto a la izquierda y otro a la derecha en el mismo renglón. */
    columnas: function (izq, der, ancho) {
      ancho = ancho || COLUMNAS;
      izq = String(izq); der = String(der);
      var espacio = ancho - der.length;
      if (izq.length > espacio - 1) {
        // El concepto largo ocupa su propio renglón.
        partir(izq, espacio - 1).forEach(function (r, i, arr) { if (i < arr.length - 1) this.linea(r); else izq = r; }, this);
        if (izq.length > espacio - 1) { this.linea(izq); izq = ''; }
      }
      return this.linea(izq + ' '.repeat(Math.max(1, ancho - izq.length - der.length)) + der);
    },
    /** Imagen monocromática (GS v 0). */
    imagen: function (img) {
      var anchoBytes = img.ancho / 8;
      return this.raw([0x1d, 0x76, 0x30, 0x00, anchoBytes & 0xff, anchoBytes >> 8, img.alto & 0xff, img.alto >> 8]).raw(img.datos);
    },
    avanzar: function (n) { return this.raw([0x1b, 0x64, n || 3]); },
    cortar: function () { return this.raw([0x1d, 0x56, 0x42, 0x00]); },
    resultado: function () { return new Uint8Array(this.bytes); }
  };

  /** Divide un texto en renglones de `ancho` caracteres sin cortar palabras. */
  function partir(texto, ancho) {
    var renglones = [];
    var actual = '';
    String(texto || '').split(/\s+/).forEach(function (palabra) {
      while (palabra.length > ancho) { if (actual) { renglones.push(actual); actual = ''; } renglones.push(palabra.slice(0, ancho)); palabra = palabra.slice(ancho); }
      if ((actual + ' ' + palabra).trim().length > ancho) { renglones.push(actual); actual = palabra; }
      else actual = (actual + ' ' + palabra).trim();
    });
    if (actual) renglones.push(actual);
    return renglones;
  }

  /** Logotipo como imagen de 1 bit para la impresora (o null si no se puede dibujar). */
  function logoRaster() {
    return new Promise(function (resolver) {
      if (!window.LogoEngreidos) { resolver(null); return; }
      var svg = window.LogoEngreidos.svg({ decorativo: true }).replace('fill="currentColor"', 'fill="#000"');
      var img = new Image();
      img.onload = function () {
        var anchoLogo = 300;
        var alto = Math.round(anchoLogo / window.LogoEngreidos.PROPORCION);
        var lienzo = document.createElement('canvas');
        lienzo.width = ANCHO_PUNTOS; lienzo.height = alto;
        var ctx = lienzo.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, ANCHO_PUNTOS, alto);
        ctx.drawImage(img, (ANCHO_PUNTOS - anchoLogo) / 2, 0, anchoLogo, alto);
        var px = ctx.getImageData(0, 0, ANCHO_PUNTOS, alto).data;
        var datos = [];
        for (var y = 0; y < alto; y += 1) {
          for (var xb = 0; xb < ANCHO_PUNTOS / 8; xb += 1) {
            var byte = 0;
            for (var b = 0; b < 8; b += 1) {
              var i = (y * ANCHO_PUNTOS + xb * 8 + b) * 4;
              if (px[i] < 128) byte |= 0x80 >> b;
            }
            datos.push(byte);
          }
        }
        resolver({ ancho: ANCHO_PUNTOS, alto: alto, datos: datos });
      };
      img.onerror = function () { resolver(null); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }

  var dinero = function (n) { return window.Utilidades.formatoMoneda(n); };

  /**
   * Arma el ticket ESC/POS de una venta.
   * @param {Object} venta  Respuesta de GET /ventas/:id
   * @returns {Promise<Uint8Array>}
   */
  async function documentoVenta(venta) {
    var U = window.Utilidades;
    var n = venta.Establecimiento || {};
    var d = new Documento();
    var cfg = configuracion();

    d.alinear('centro');
    var logo = cfg.logo === false ? null : await logoRaster();
    if (logo) d.imagen(logo).linea('');
    else d.doble(true).negrita(true).linea('[ ENGREIDOS ]').doble(false).linea('BARBERSHOP').negrita(false);
    if (n.Eslogan) partir(n.Eslogan, COLUMNAS).forEach(function (r) { d.linea(r); });
    if (n.Direccion) partir(n.Direccion, COLUMNAS).forEach(function (r) { d.linea(r); });
    if (n.Telefono) d.linea(t('Tel.') + ' ' + n.Telefono);
    if (n.DatosFiscales) partir(n.DatosFiscales, COLUMNAS).forEach(function (r) { d.linea(r); });

    d.alinear('izquierda').separador();
    d.columnas(t('Folio') + ':', venta.NumeroFactura);
    d.columnas(t('Fecha') + ':', U.formatoFecha(venta.FechaHoraCobro) + ' ' + U.formatoHora(venta.FechaHoraCobro));
    d.columnas(t('Atendió') + ':', String(venta.CobradoPor || '').replace(/\s*\(.*\)$/, ''));
    d.linea(t('Cliente') + ': ' + (venta.ID_Cliente ? venta.NombreCliente : t('Cliente 0')));
    if (venta.ClienteConMembresia && venta.PlanCliente) d.linea(t('Membresía') + ' ' + venta.PlanCliente);
    d.separador();

    (venta.Detalle || []).forEach(function (l) {
      var nombre = (l.Cantidad > 1 ? l.Cantidad + ' x ' : '') + l.NombreItem;
      d.columnas(nombre, dinero(l.PrecioUnitario * l.Cantidad));
      if (l.NombreBarbero) d.linea('  ' + t('Barbero') + ': ' + l.NombreBarbero);
      if (Number(l.Descuento) > 0) d.columnas('  ' + t(l.Beneficio || 'Descuento'), '-' + dinero(l.Descuento));
      if (l.VenceMembresia) d.linea('  ' + t('Vence') + ': ' + U.formatoFecha(l.VenceMembresia));
    });

    d.separador();
    d.columnas(t('Subtotal'), dinero(venta.Subtotal));
    if (Number(venta.Descuento) > 0) d.columnas(t('Descuento membresía'), '-' + dinero(venta.Descuento));
    d.negrita(true).doble(true).columnas(t('TOTAL'), dinero(venta.ImporteTotal), COLUMNAS / 2).doble(false).negrita(false);
    d.columnas(t('Pago') + ':', t(venta.MetodoPago));
    if (venta.MetodoPago === 'Efectivo' && venta.MontoRecibido != null) {
      d.columnas(t('Recibido'), dinero(venta.MontoRecibido));
      d.columnas(t('Cambio'), dinero(venta.Cambio));
    }
    d.separador().alinear('centro');
    if (n.MensajeTicket) partir(t(n.MensajeTicket), COLUMNAS).forEach(function (r) { d.linea(r); });
    if (n.RedesSociales) d.linea(n.RedesSociales);
    return d.avanzar(4).cortar().resultado();
  }

  /** Ticket corto para probar la conexión. */
  function documentoPrueba() {
    return new Documento().alinear('centro').negrita(true).linea('ENGREIDOS BARBERSHOP').negrita(false)
      .linea(t('Prueba de impresora')).separador().alinear('izquierda')
      .linea('ÁÉÍÓÚ áéíóú Ññ ¿? ¡!').columnas(t('Total'), '$123.45')
      .separador().alinear('centro').linea(t('¡La impresora funciona!')).avanzar(4).cortar().resultado();
  }

  /**
   * Reporte de corte de caja (58 mm).
   * @param {Object} c  Resumen de GET /cierres/resumen o corte de POST /cierres,
   *                    con Responsable, Desde, PorMetodo, EfectivoContado, Diferencia…
   * @returns {Uint8Array}
   */
  function documentoCorte(c) {
    var U = window.Utilidades;
    var m = c.PorMetodo || { Efectivo: c.TotalEfectivo, Tarjeta: c.TotalTarjeta, Transferencia: c.TotalTransferencia };
    var d = new Documento();
    d.alinear('centro').negrita(true).linea('ENGREIDOS BARBERSHOP').doble(true).linea(t('CORTE DE CAJA')).doble(false).negrita(false);
    d.alinear('izquierda').separador();
    if (c.ID_Corte) d.columnas(t('Folio del corte') + ':', '#' + c.ID_Corte);
    d.columnas(t('Fecha') + ':', U.formatoFecha(c.FechaCorte || new Date()) + ' ' + U.formatoHora(c.FechaCorte || new Date()));
    if (c.Desde) d.columnas(t('Desde') + ':', U.formatoFecha(c.Desde) + ' ' + U.formatoHora(c.Desde));
    d.linea(t('Responsable') + ': ' + String(c.RealizadoPor || c.Responsable || '').replace(/\s*\(.*\)$/, ''));
    d.separador();
    d.columnas(t('Ventas'), String(c.NumeroVentas || 0));
    if (c.Servicios != null) d.columnas(t('Servicios'), String(c.Servicios));
    if (c.Productos != null) d.columnas(t('Productos'), String(c.Productos));
    d.columnas(t('Efectivo'), dinero(m.Efectivo || 0));
    d.columnas(t('Tarjeta'), dinero(m.Tarjeta || 0));
    d.columnas(t('Transferencia'), dinero(m.Transferencia || 0));
    if (c.Descuentos != null) d.columnas(t('Descuentos'), '-' + dinero(c.Descuentos));
    d.negrita(true).columnas(t('TOTAL'), dinero(c.TotalIngresos || 0)).negrita(false);
    d.separador();
    d.columnas(t('Fondo inicial'), dinero(c.FondoInicial || 0));
    d.columnas(t('Efectivo esperado'), dinero(c.EfectivoEsperado != null ? c.EfectivoEsperado : Number(c.FondoInicial || 0) + Number(m.Efectivo || 0)));
    if (c.EfectivoContado != null) {
      d.columnas(t('Efectivo contado'), dinero(c.EfectivoContado));
      d.negrita(true).columnas(t('Diferencia'), dinero(c.Diferencia || 0)).negrita(false);
    }
    d.separador().linea('').linea('').alinear('centro').linea('______________________').linea(t('Firma'));
    return d.avanzar(4).cortar().resultado();
  }

  // ---------------------------------------------------------------------------
  // Envío a la impresora
  // ---------------------------------------------------------------------------

  function aBase64(bytes) {
    var texto = '';
    for (var i = 0; i < bytes.length; i += 0x8000) texto += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(texto);
  }

  /** Mensaje de error de la app de Android → texto para el usuario. */
  function errorAndroid(r) {
    if (r === 'PERMISO') return new Error(t('Permite el acceso a «Dispositivos cercanos» y vuelve a intentarlo.'));
    return new Error(t(String(r)));
  }

  async function enviarAndroid(bytes, cfg) {
    if (!cfg.direccion) throw new Error(t('Elige la impresora en Ajustes → Impresora.'));
    var r = window.EngreidosAndroid.imprimir(cfg.direccion, aBase64(bytes));
    if (r !== 'OK') throw errorAndroid(r);
  }

  // ---- Puerto serie (USB o Bluetooth emparejado en la computadora) -----------

  var puertoSerie = null;

  /** Cierra el puerto para poder abrirlo de nuevo (otra velocidad o tras un error). */
  async function cerrarSerie() {
    var p = puertoSerie;
    if (!p) return;
    try { if (p.writable && p.writable.locked) { /* otro envío en curso */ } else if (p.readable || p.writable) await p.close(); } catch (e) { /* ya cerrado */ }
  }

  /** Texto para mostrar el puerto elegido. */
  function nombrePuerto(p) {
    if (!p) return '';
    var i = p.getInfo ? p.getInfo() : {};
    return i.usbVendorId ? 'USB ' + ('0000' + i.usbVendorId.toString(16)).slice(-4) + ':' + ('0000' + (i.usbProductId || 0).toString(16)).slice(-4) : t('Puerto serie (COM)');
  }

  /** Pide al usuario el puerto de la impresora (debe llamarse desde un clic). */
  async function elegirPuerto() {
    if (!navigator.serial) throw new Error(t('Este navegador no permite la conexión directa. Usa Chrome o Edge en computadora.'));
    await cerrarSerie();
    try { puertoSerie = await navigator.serial.requestPort(); }
    catch (e) { throw new Error(t('No se eligió ningún puerto.')); }
    return nombrePuerto(puertoSerie);
  }

  /** Puerto ya autorizado antes (si existe). */
  async function puertoGuardado() {
    if (!navigator.serial) return '';
    if (!puertoSerie) puertoSerie = (await navigator.serial.getPorts())[0] || null;
    return nombrePuerto(puertoSerie);
  }

  async function enviarSerie(bytes, cfg) {
    if (!puertoSerie) puertoSerie = (await navigator.serial.getPorts())[0] || null;
    if (!puertoSerie) {
      try { puertoSerie = await navigator.serial.requestPort(); }
      catch (e) { throw new Error(t('Elige el puerto de la impresora en Ajustes → Impresora.')); }
    }
    try {
      if (!puertoSerie.writable) await puertoSerie.open({ baudRate: Number(cfg && cfg.velocidad) || 9600 });
      var escritor = puertoSerie.writable.getWriter();
      try {
        for (var i = 0; i < bytes.length; i += 512) await escritor.write(bytes.subarray(i, i + 512));
      } finally { escritor.releaseLock(); }
    } catch (e) {
      await cerrarSerie();
      throw new Error(t('No se pudo abrir el puerto de la impresora. Revisa que esté encendida, conectada y que ningún otro programa la esté usando.') + ' (' + (e.message || e) + ')');
    }
  }

  // ---- Bluetooth de baja energía (Web Bluetooth) ------------------------------

  /** Servicios BLE más comunes de impresoras térmicas genéricas. */
  var SERVICIOS_BLE = ['000018f0-0000-1000-8000-00805f9b34fb', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
    '49535343-fe7d-4ae5-8fa9-9fafd205e455', '0000ff00-0000-1000-8000-00805f9b34fb', '0000ffe0-0000-1000-8000-00805f9b34fb',
    '0000fff0-0000-1000-8000-00805f9b34fb', '0000ae30-0000-1000-8000-00805f9b34fb'];
  var dispositivoBle = null;
  var caracteristicaBle = null;

  /** Conecta con el dispositivo BLE y busca por dónde escribir. */
  async function conectarBle() {
    var servidor;
    try { servidor = await dispositivoBle.gatt.connect(); }
    catch (e) { throw new Error(t('No se pudo conectar con la impresora. Revisa que esté encendida y cerca.')); }
    caracteristicaBle = null;
    var servicios = await servidor.getPrimaryServices();
    for (var i = 0; i < servicios.length && !caracteristicaBle; i += 1) {
      var caracteristicas = await servicios[i].getCharacteristics();
      caracteristicaBle = caracteristicas.find(function (c) { return c.properties.writeWithoutResponse || c.properties.write; }) || null;
    }
    if (!caracteristicaBle) throw new Error(t('La impresora no aceptó la conexión Bluetooth.'));
  }

  /** Busca y conecta una impresora BLE (debe llamarse desde un clic). */
  async function elegirBle() {
    if (!navigator.bluetooth) throw new Error(t('Este navegador no permite Bluetooth. Usa Chrome.'));
    try { dispositivoBle = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: SERVICIOS_BLE }); }
    catch (e) { throw new Error(t('No se eligió ninguna impresora.')); }
    await conectarBle();
    return dispositivoBle.name || t('Impresora Bluetooth');
  }

  async function enviarBle(bytes) {
    if (!dispositivoBle) await elegirBle();
    else if (!caracteristicaBle || !dispositivoBle.gatt.connected) await conectarBle();
    for (var p = 0; p < bytes.length; p += 100) {
      var trozo = bytes.slice(p, p + 100);
      if (caracteristicaBle.properties.writeWithoutResponse) await caracteristicaBle.writeValueWithoutResponse(trozo);
      else await caracteristicaBle.writeValue(trozo);
    }
  }

  /**
   * Comprueba la conexión sin imprimir.
   * @returns {Promise<string>} Texto del resultado («Impresora conectada…»)
   */
  async function probarConexion() {
    var cfg = configuracion();
    if (cfg.tipo === 'android') {
      if (!cfg.direccion) throw new Error(t('Elige la impresora en Ajustes → Impresora.'));
      var A = window.EngreidosAndroid;
      // Las versiones anteriores de la app no tienen esta prueba: se manda solo el comando de inicio.
      var r = A.probarImpresora ? A.probarImpresora(cfg.direccion) : A.imprimir(cfg.direccion, aBase64(new Uint8Array([0x1b, 0x40])));
      if (r !== 'OK') throw errorAndroid(r);
      return t('Impresora conectada: {nombre}', { nombre: cfg.nombre || cfg.direccion });
    }
    if (cfg.tipo === 'serie') {
      await enviarSerie(new Uint8Array([0x1b, 0x40]), cfg);
      return t('Puerto abierto. Imprime la prueba para confirmar la velocidad.');
    }
    if (cfg.tipo === 'ble') {
      await enviarBle(new Uint8Array([0x1b, 0x40]));
      return t('Impresora conectada: {nombre}', { nombre: (dispositivoBle && dispositivoBle.name) || 'BLE' });
    }
    return t('La impresora del sistema se elige en el diálogo de impresión.');
  }

  /**
   * Envía bytes ESC/POS según la configuración. Con 'sistema' abre el diálogo de impresión.
   * @param {Uint8Array} bytes
   */
  async function enviar(bytes) {
    var cfg = configuracion();
    if (cfg.tipo === 'android' && disponibles().android) return enviarAndroid(bytes, cfg);
    if (cfg.tipo === 'serie' && navigator.serial) return enviarSerie(bytes, cfg);
    if (cfg.tipo === 'ble' && navigator.bluetooth) return enviarBle(bytes);
    return imprimirSistema();
  }

  /** Diálogo de impresión (la página del ticket tiene estilos de 58 mm para imprimir). */
  function imprimirSistema() {
    if (window.EngreidosAndroid && window.EngreidosAndroid.imprimirPagina) window.EngreidosAndroid.imprimirPagina();
    else window.print();
  }

  window.Impresora = Object.freeze({
    configuracion: configuracion,
    guardar: guardar,
    disponibles: disponibles,
    listarAndroid: listarAndroid,
    /** Abre los ajustes de Bluetooth del teléfono (app de Android 2.5 o posterior). */
    abrirBluetooth: function () {
      var A = window.EngreidosAndroid;
      if (!A || !A.abrirBluetooth) return false;
      return A.abrirBluetooth() === 'OK';
    },
    probarConexion: probarConexion,
    elegirPuerto: elegirPuerto,
    puertoGuardado: puertoGuardado,
    cerrarPuerto: cerrarSerie,
    elegirBle: elegirBle,
    /** Imprime el ticket de una venta con la impresora configurada. */
    imprimirVenta: async function (venta) {
      if (configuracion().tipo === 'sistema') return imprimirSistema();
      return enviar(await documentoVenta(venta));
    },
    /**
     * Imprime el reporte de corte. Con la impresora del sistema abre el
     * diálogo de impresión de la página.
     */
    imprimirCorte: function (corte) {
      if (configuracion().tipo === 'sistema') return imprimirSistema();
      return enviar(documentoCorte(corte));
    },
    /** Imprime un ticket de prueba. */
    prueba: function () {
      if (configuracion().tipo === 'sistema') return imprimirSistema();
      return enviar(documentoPrueba());
    },
    /** Para pruebas: bytes ESC/POS del ticket. */
    documentoVenta: documentoVenta,
    documentoCorte: documentoCorte,
    partir: partir
  });
})();
