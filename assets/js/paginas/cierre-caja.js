/**
 * @file paginas/cierre-caja.js
 * @description Controlador de «Cierre de caja» (cierre-caja.html).
 *
 * Flujo (diagrama de secuencia 3.1.3):
 *   1. Consulta las ventas y reembolsos sin corte.    GET /cierres/resumen
 *      { NumeroVentas, VentasBrutas, Descuentos, TotalIngresos, NumeroReembolsos, TotalReembolsos,
 *        IngresoNeto, PorMetodo, Operaciones, ReembolsosPorMetodo, PorTipo, PorBarbero, PorCajero,
 *        ProductosVendidos, TicketPromedio, FondoInicial, EfectivoEsperado, Desde, Hasta,
 *        Responsable, Denominaciones[], Ventas[], Reembolsos[] }
 *   2. Compara el efectivo esperado (fondo + efectivo − reembolsos en efectivo)
 *      contra el contado; se puede contar por billetes y monedas.
 *   3. Registra el corte.        POST /cierres { EfectivoContado, Arqueo?, Observaciones? }
 *   4. Exporta el resumen o un corte a CSV (Excel).   GET /cierres/:id
 *   5. Muestra los cortes anteriores.                 GET /cierres?limite=10
 */
(function () {
  'use strict';

  if (!window.Sesion.permitida) return;

  var U = window.Utilidades;
  var Api = window.Api;
  var t = window.Idioma.t;

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    datosTurno: $('datos-turno'), numeroTickets: $('numero-tickets'), buscarFolio: $('buscar-folio'),
    ventasCargando: $('ventas-cargando'), ventasVacio: $('ventas-vacio'), ventasTabla: $('ventas-tabla'), ventasFilas: $('ventas-filas'),
    indicadores: $('indicadores'), resumen: $('resumen'),
    efectivoContado: $('efectivo-contado'), resultadoArqueo: $('resultado-arqueo'),
    generarCierre: $('generar-cierre'), exportarResumen: $('exportar-resumen'),
    cortesVacio: $('cortes-vacio'), cortesTabla: $('cortes-tabla'), cortesFilas: $('cortes-filas'), exportarCortes: $('exportar-cortes'),
    reembolsosSeccion: $('reembolsos-seccion'), reembolsosFilas: $('reembolsos-filas'), numeroReembolsos: $('numero-reembolsos'),
    reporteTipos: $('reporte-tipos'), reporteBarberos: $('reporte-barberos'), reporteProductos: $('reporte-productos'), reporteCajeros: $('reporte-cajeros'),
    arqueo: $('arqueo'), arqueoLista: $('arqueo-lista'), arqueoTotal: $('arqueo-total'), observaciones: $('observaciones'),
    modal: $('cierre-exitoso'), cerrarModal: $('cerrar-modal'), exportarCorte: $('exportar-corte')
  };

  var resumen = null;      // Respuesta de GET /cierres/resumen
  var ultimoCorte = null;  // Corte recién registrado
  var cortes = [];         // Cortes anteriores (GET /cierres)
  var filtroMetodo = '';

  /** @returns {number} Fondo inicial + ventas en efectivo. */
  function efectivoEsperado() { return resumen ? Number(resumen.EfectivoEsperado || 0) : 0; }

  /** Carga el resumen y llena indicadores, totales y tabla de ventas. */
  async function cargar() {
    try { resumen = await Api.cierres.resumen(); }
    catch (error) { resumen = null; U.aviso(error.message, 'error'); }
    el.ventasCargando.hidden = true;

    var r = resumen || {};
    var porMetodo = r.PorMetodo || {};
    var datos = Object.assign({}, r, {
      Efectivo: porMetodo.Efectivo || 0,
      Tarjeta: porMetodo.Tarjeta || 0,
      Transferencia: porMetodo.Transferencia || 0,
      Servicios: r.Servicios || 0,
      Productos: r.Productos || 0,
      NumeroVentas: r.NumeroVentas || 0,
      NumeroReembolsos: r.NumeroReembolsos || 0,
      VentasBrutas: r.VentasBrutas || 0, TotalReembolsos: r.TotalReembolsos || 0, IngresoNeto: r.IngresoNeto || 0,
      ReembolsoEfectivo: (r.ReembolsosPorMetodo || {}).Efectivo || 0,
      OpEfectivo: '(' + ((r.Operaciones || {}).Efectivo || 0) + ')',
      OpTarjeta: '(' + ((r.Operaciones || {}).Tarjeta || 0) + ')',
      OpTransferencia: '(' + ((r.Operaciones || {}).Transferencia || 0) + ')'
    });
    U.llenar(el.datosTurno, datos);
    U.llenar(el.indicadores, datos);
    U.llenar(el.resumen, datos);

    var total = (r.Ventas || []).length;
    el.numeroTickets.textContent = t(total === 1 ? '{n} ticket' : '{n} tickets', { n: total });
    document.getElementById('conteo-turno').textContent = t('{n} ventas', { n: datos.NumeroVentas }) + ' · ' +
      t(datos.NumeroReembolsos === 1 ? '{n} reembolso' : '{n} reembolsos', { n: datos.NumeroReembolsos });
    dibujarVentas();
    dibujarReembolsos();
    dibujarReporte();
    dibujarArqueo();
    revisarArqueo();
  }

  /** Reembolsos del turno (la sección se oculta si no hay). */
  function dibujarReembolsos() {
    var lista = (resumen && resumen.Reembolsos) || [];
    el.reembolsosSeccion.hidden = !lista.length;
    el.numeroReembolsos.textContent = t(lista.length === 1 ? '{n} reembolso' : '{n} reembolsos', { n: lista.length });
    U.dibujarLista({ contenedor: el.reembolsosFilas, plantilla: 'plantilla-reembolso', datos: lista });
    el.reembolsosFilas.hidden = false;
  }

  /** Renglones «nombre · cantidad · importe» de un bloque del reporte. */
  function renglones(contenedor, filas) {
    contenedor.replaceChildren();
    if (!filas.length) {
      var vacio = document.createElement('p');
      vacio.className = 'ayuda'; vacio.textContent = t('Sin movimientos.');
      contenedor.appendChild(vacio);
      return;
    }
    filas.forEach(function (f) {
      var linea = document.createElement('div'); linea.className = 'total-linea';
      var nombre = document.createElement('span');
      if (f.traducir) nombre.textContent = t(f.Nombre); else { nombre.textContent = f.Nombre; nombre.setAttribute('translate', 'no'); }
      var cantidad = document.createElement('span'); cantidad.className = 'texto-tenue numeros'; cantidad.textContent = ' × ' + f.Cantidad;
      nombre.appendChild(cantidad);
      var importe = document.createElement('span'); importe.textContent = U.formatoMoneda(f.Importe);
      linea.append(nombre, importe);
      contenedor.appendChild(linea);
    });
  }

  function dibujarReporte() {
    var r = resumen || {};
    var tipos = r.PorTipo || {};
    renglones(el.reporteTipos, ['Servicios', 'Productos', 'Membresías'].map(function (n) {
      var x = tipos[n === 'Membresías' ? 'Membresias' : n] || { Cantidad: 0, Importe: 0 };
      return { Nombre: n, Cantidad: x.Cantidad, Importe: x.Importe, traducir: true };
    }));
    renglones(el.reporteBarberos, (r.PorBarbero || []).map(function (x) { return Object.assign({ traducir: x.Nombre === 'Sin barbero' }, x); }));
    renglones(el.reporteProductos, r.ProductosVendidos || []);
    renglones(el.reporteCajeros, r.PorCajero || []);
  }

  // ---- Arqueo por billetes y monedas ----------------------------------------

  var denominacionesDibujadas = false;
  function dibujarArqueo() {
    if (denominacionesDibujadas || !resumen || !resumen.Denominaciones) return;
    denominacionesDibujadas = true;
    resumen.Denominaciones.forEach(function (d) {
      var fila = document.createElement('label'); fila.className = 'arqueo__fila';
      var texto = document.createElement('span'); texto.className = 'numeros'; texto.textContent = U.formatoMoneda(Number(d));
      var por = document.createElement('span'); por.className = 'texto-tenue'; por.textContent = '×';
      var campo = document.createElement('input');
      campo.className = 'campo numeros'; campo.type = 'number'; campo.inputMode = 'numeric'; campo.min = '0'; campo.step = '1'; campo.placeholder = '0';
      campo.setAttribute('data-denominacion', d);
      campo.setAttribute('aria-label', t('Piezas de {monto}', { monto: U.formatoMoneda(Number(d)) }));
      var sub = document.createElement('span'); sub.className = 'numeros arqueo__subtotal'; sub.textContent = U.formatoMoneda(0);
      campo.addEventListener('input', function () {
        sub.textContent = U.formatoMoneda((parseInt(campo.value, 10) || 0) * Number(d));
        var total = totalArqueo();
        el.arqueoTotal.textContent = U.formatoMoneda(total);
        el.efectivoContado.value = total ? total.toFixed(2) : '';
        revisarArqueo();
      });
      fila.append(texto, por, campo, sub);
      el.arqueoLista.appendChild(fila);
    });
  }

  /** { "500": 2, "0.5": 4 } con las piezas capturadas (o null). */
  function leerArqueo() {
    var arqueo = {}, alguno = false;
    el.arqueoLista.querySelectorAll('[data-denominacion]').forEach(function (c) {
      var n = parseInt(c.value, 10) || 0;
      if (n > 0) { arqueo[c.getAttribute('data-denominacion')] = n; alguno = true; }
    });
    return alguno ? arqueo : null;
  }

  function totalArqueo() {
    var a = leerArqueo() || {};
    return Math.round(Object.keys(a).reduce(function (s, d) { return s + a[d] * Number(d); }, 0) * 100) / 100;
  }

  function limpiarArqueo() {
    el.arqueoLista.querySelectorAll('[data-denominacion]').forEach(function (c) { c.value = ''; });
    el.arqueoLista.querySelectorAll('.arqueo__subtotal').forEach(function (x) { x.textContent = U.formatoMoneda(0); });
    el.arqueoTotal.textContent = U.formatoMoneda(0);
    el.arqueo.open = false;
  }

  /** Dibuja la tabla aplicando el filtro de método y la búsqueda. */
  function dibujarVentas() {
    var texto = U.normalizarTexto(el.buscarFolio.value);
    var ventas = ((resumen && resumen.Ventas) || []).filter(function (v) {
      var coincideMetodo = !filtroMetodo || v.MetodoPago === filtroMetodo;
      var coincideTexto = !texto || U.normalizarTexto(v.NumeroFactura + ' ' + (v.NombreCliente || '') + ' ' + (v.Concepto || '')).indexOf(texto) !== -1;
      return coincideMetodo && coincideTexto;
    });
    U.dibujarLista({
      contenedor: el.ventasFilas, plantilla: 'plantilla-venta', datos: ventas, vacio: el.ventasVacio,
      alCrear: function (fila) {
        fila.querySelector('[data-campo="Concepto"]').setAttribute('translate', 'no');
        fila.querySelector('[data-campo="CobradoPor"]').setAttribute('translate', 'no');
      }
    });
    el.ventasTabla.hidden = !ventas.length;
    el.ventasFilas.hidden = false;
  }

  /** Compara lo contado con lo esperado y habilita el cierre. */
  function revisarArqueo() {
    // También hay corte si solo hubo reembolsos (salió efectivo de la caja).
    var hayVentas = !!(resumen && ((resumen.Ventas && resumen.Ventas.length) || (resumen.Reembolsos && resumen.Reembolsos.length)));
    var capturado = el.efectivoContado.value !== '';
    var diferencia = (Number(el.efectivoContado.value) || 0) - efectivoEsperado();

    if (!hayVentas) {
      el.resultadoArqueo.textContent = t('No hay ventas ni reembolsos pendientes de corte.');
      el.resultadoArqueo.className = 'ayuda';
    } else if (!capturado) {
      el.resultadoArqueo.textContent = t('Captura el efectivo contado para continuar.');
      el.resultadoArqueo.className = 'ayuda';
    } else if (Math.abs(diferencia) < 0.005) {
      el.resultadoArqueo.textContent = t('Arqueo exacto: sin diferencias.');
      el.resultadoArqueo.className = 'ayuda ayuda--exito';
    } else {
      el.resultadoArqueo.textContent = t(diferencia > 0 ? 'Sobrante de {monto}. Se registrará en el corte.' : 'Faltante de {monto}. Se registrará en el corte.',
        { monto: U.formatoMoneda(Math.abs(diferencia)) });
      el.resultadoArqueo.className = 'ayuda ayuda--error';
    }
    el.generarCierre.disabled = !(hayVentas && capturado);
  }

  /** Registra el corte; si hay diferencia en el arqueo pide confirmación. */
  async function generarCierre() {
    var contado = Number(el.efectivoContado.value) || 0;
    var diferencia = contado - efectivoEsperado();
    if (Math.abs(diferencia) >= 0.005 &&
        !(await U.confirmar(t('Hay una diferencia de {monto}. ¿Registrar el corte de todos modos?', { monto: U.formatoMoneda(diferencia) })))) return;

    try {
      // El detalle por billetes solo se guarda si coincide con el efectivo capturado.
      var arqueo = Math.abs(totalArqueo() - contado) < 0.005 ? leerArqueo() : null;
      var corte = await U.conCarga(el.generarCierre, Api.cierres.crear({
        EfectivoContado: contado, Arqueo: arqueo || undefined, Observaciones: el.observaciones.value.trim() || undefined
      }));
      ultimoCorte = corte;
      U.llenar(el.modal, ultimoCorte);
      el.modal.hidden = false;
      el.efectivoContado.value = '';
      el.observaciones.value = '';
      limpiarArqueo();
      cargar();
      cargarCortes();
    } catch (error) { U.aviso(error.message, 'error'); }
  }

  /** Lista los últimos cortes.  GET /cierres?limite=10 */
  async function cargarCortes() {
    cortes = [];
    try { cortes = (await Api.cierres.listar(10)) || []; }
    catch (error) { U.aviso(error.message, 'error'); }
    U.dibujarLista({
      contenedor: el.cortesFilas, plantilla: 'plantilla-corte', vacio: el.cortesVacio,
      datos: cortes.map(function (c) { return Object.assign({}, c, { Folio: '#' + c.ID_Corte }); }),
      alCrear: function (fila, c) {
        fila.querySelector('[data-campo="RealizadoPor"]').setAttribute('translate', 'no');
        var dif = Number(c.Diferencia || 0);
        if (Math.abs(dif) >= 0.005) fila.querySelector('[data-campo="Diferencia"]').classList.add(dif > 0 ? 'texto-exito' : 'texto-error');
        fila.querySelector('[data-exportar]').addEventListener('click', function (e) {
          exportarCorteGuardado(c.ID_Corte, e.currentTarget);
        });
      }
    });
    el.exportarCortes.hidden = !cortes.length;
    el.cortesTabla.hidden = !cortes.length;
    el.cortesFilas.hidden = false;
  }

  // ---- Archivos CSV (Excel) -------------------------------------------------

  var d2 = function (n) { return Number(n || 0).toFixed(2); };

  /**
   * CSV de un corte (o del resumen del turno): totales, desgloses, ventas y reembolsos.
   * @param {Object} c  Corte o resumen (con Ventas[] y Reembolsos[])
   * @returns {string}
   */
  function csvCorte(c) {
    var m = c.PorMetodo || { Efectivo: c.TotalEfectivo, Tarjeta: c.TotalTarjeta, Transferencia: c.TotalTransferencia };
    var op = c.Operaciones || {};
    var rm = c.ReembolsosPorMetodo || {};
    var fecha = U.fechaHoraCSV(c.FechaCorte || c.Hasta || new Date());
    var desde = U.fechaHoraCSV(c.Desde);
    var esperado = c.EfectivoEsperado != null ? c.EfectivoEsperado : Number(c.FondoInicial || 0) + Number(m.Efectivo || 0);
    var filas = [
      ['Engreídos Barbershop', t(c.ID_Corte ? 'Corte de caja' : 'Resumen del turno (sin cerrar)')],
      [t('Folio del corte'), c.ID_Corte ? '#' + c.ID_Corte : '—'],
      [t('Desde'), desde.fecha, t('Hora'), desde.hora],
      [t('Hasta'), fecha.fecha, t('Hora'), fecha.hora],
      [t('Responsable'), String(c.RealizadoPor || c.Responsable || '').replace(/\s*\(.*\)$/, '')],
      [],
      [t('Resumen'), t('Cantidad'), t('Importe')],
      [t('Ventas brutas'), c.NumeroVentas || 0, d2(c.VentasBrutas != null ? c.VentasBrutas : Number(c.TotalIngresos || 0) + Number(c.Descuentos || 0))],
      [t('Descuentos y membresías'), '', '-' + d2(c.Descuentos)],
      [t('Total cobrado'), '', d2(c.TotalIngresos)],
      [t('Reembolsos'), c.NumeroReembolsos || 0, '-' + d2(c.TotalReembolsos)],
      [t('Ingreso neto'), '', d2(c.IngresoNeto != null ? c.IngresoNeto : Number(c.TotalIngresos || 0) - Number(c.TotalReembolsos || 0))],
      [t('Ticket promedio'), '', d2(c.TicketPromedio)],
      [],
      [t('Método de pago'), t('Ventas'), t('Cobrado'), t('Reembolsado'), t('Neto')]
    ];
    ['Efectivo', 'Tarjeta', 'Transferencia'].forEach(function (x) {
      filas.push([t(x), op[x] != null ? op[x] : '', d2(m[x]), d2(rm[x]), d2(Number(m[x] || 0) - Number(rm[x] || 0))]);
    });
    filas.push([]);
    filas.push([t('Arqueo de efectivo'), '', t('Importe')]);
    filas.push([t('Fondo inicial'), '', d2(c.FondoInicial)]);
    filas.push([t('Ventas en efectivo'), '', d2(m.Efectivo)]);
    filas.push([t('Reembolsos en efectivo'), '', '-' + d2(rm.Efectivo != null ? rm.Efectivo : c.ReembolsosEfectivo)]);
    filas.push([t('Efectivo esperado'), '', d2(esperado)]);
    if (c.EfectivoContado != null) {
      filas.push([t('Efectivo contado'), '', d2(c.EfectivoContado)]);
      filas.push([t('Diferencia'), '', d2(c.Diferencia)]);
    }
    if (c.Arqueo) {
      filas.push([]);
      filas.push([t('Denominación'), t('Piezas'), t('Importe')]);
      Object.keys(c.Arqueo).sort(function (a, b) { return Number(b) - Number(a); }).forEach(function (d) {
        filas.push([d2(d), c.Arqueo[d], d2(Number(d) * c.Arqueo[d])]);
      });
    }
    if (c.Observaciones) { filas.push([]); filas.push([t('Observaciones'), c.Observaciones]); }

    var bloque = function (titulo, lista, traducir) {
      if (!lista || !lista.length) return;
      filas.push([]);
      filas.push([t(titulo), t('Cantidad'), t('Importe')]);
      lista.forEach(function (x) { filas.push([traducir ? t(x.Nombre) : x.Nombre, x.Cantidad, d2(x.Importe)]); });
    };
    if (c.PorTipo) {
      bloque('Ventas por tipo', [['Servicios', c.PorTipo.Servicios], ['Productos', c.PorTipo.Productos], ['Membresías', c.PorTipo.Membresias]]
        .map(function (x) { return { Nombre: x[0], Cantidad: (x[1] || {}).Cantidad || 0, Importe: (x[1] || {}).Importe || 0 }; }), true);
    }
    bloque('Servicios por barbero', c.PorBarbero);
    bloque('Productos vendidos', c.ProductosVendidos);
    bloque('Cobrado por', c.PorCajero);

    filas.push([]);
    filas.push([t('Ventas incluidas')]);
    filas.push(['Folio', 'Fecha', 'Hora', 'Cliente', 'Concepto', 'Método', 'Descuento', 'Total', 'Cobró'].map(function (x) { return t(x); }));
    (c.Ventas || []).forEach(function (v) {
      var fh = U.fechaHoraCSV(v.FechaHoraCobro);
      filas.push([v.NumeroFactura, fh.fecha, fh.hora, t(v.NombreCliente || ''), v.Concepto, t(v.MetodoPago || ''), d2(v.Descuento), d2(v.ImporteTotal), v.CobradoPor]);
    });
    if (c.Reembolsos && c.Reembolsos.length) {
      filas.push([]);
      filas.push([t('Reembolsos incluidos')]);
      filas.push(['Ticket', 'Fecha', 'Hora', 'Cliente', 'Motivo', 'Devolución', 'Monto', 'Autorizó'].map(function (x) { return t(x); }));
      c.Reembolsos.forEach(function (r) {
        var fh = U.fechaHoraCSV(r.Fecha);
        filas.push([r.NumeroFactura, fh.fecha, fh.hora, t(r.NombreCliente || ''), r.Motivo, t(r.MetodoDevolucion || ''), d2(r.Monto), r.RealizadoPor]);
      });
    }
    return U.csv(filas);
  }

  /** Nombre del archivo: corte_5_2026-11-06.csv · resumen_2026-11-06.csv */
  function nombreArchivo(c) {
    var f = new Date(c.FechaCorte ? String(c.FechaCorte).replace(' ', 'T') : Date.now());
    var dia = isNaN(f.getTime()) ? '' : f.getFullYear() + '-' + ('0' + (f.getMonth() + 1)).slice(-2) + '-' + ('0' + f.getDate()).slice(-2);
    return (c.ID_Corte ? 'corte_' + c.ID_Corte + '_' : 'resumen_') + dia + '.csv';
  }

  async function exportar(datos, boton) {
    try { await U.conCarga(boton, U.descargarArchivo(nombreArchivo(datos), csvCorte(datos))); }
    catch (error) { U.aviso(error.message || String(error), 'error'); }
  }

  /** Resumen actual (antes de cerrar), con el efectivo capturado. */
  function exportarResumen() {
    if (!resumen) return;
    var datos = Object.assign({}, resumen);
    if (el.efectivoContado.value !== '') {
      datos.EfectivoContado = Number(el.efectivoContado.value) || 0;
      datos.Diferencia = datos.EfectivoContado - efectivoEsperado();
    }
    exportar(datos, el.exportarResumen);
  }

  /** Un corte anterior con sus ventas.  GET /cierres/:id */
  async function exportarCorteGuardado(id, boton) {
    try {
      var corte = await U.conCarga(boton, Api.cierres.obtener(id));
      await U.descargarArchivo(nombreArchivo(corte), csvCorte(corte));
    } catch (error) { U.aviso(error.message || String(error), 'error'); }
  }

  /** Lista de cortes anteriores (un renglón por corte). */
  async function exportarListaCortes() {
    var filas = [['Folio', 'Fecha', 'Hora', 'Responsable', 'Ventas', 'Efectivo', 'Tarjeta', 'Transferencia', 'Total', 'Reembolsos', 'Fondo inicial', 'Efectivo contado', 'Diferencia', 'Observaciones']
      .map(function (x) { return t(x); })];
    cortes.forEach(function (c) {
      var fh = U.fechaHoraCSV(c.FechaCorte);
      filas.push(['#' + c.ID_Corte, fh.fecha, fh.hora, String(c.RealizadoPor || ''), c.NumeroVentas, d2(c.TotalEfectivo), d2(c.TotalTarjeta),
        d2(c.TotalTransferencia), d2(c.TotalIngresos), d2(c.TotalReembolsos), d2(c.FondoInicial), d2(c.EfectivoContado), d2(c.Diferencia), c.Observaciones || '']);
    });
    try { await U.conCarga(el.exportarCortes, U.descargarArchivo('cortes_de_caja.csv', U.csv(filas))); }
    catch (error) { U.aviso(error.message || String(error), 'error'); }
  }

  // ---- Arranque ---------------------------------------------------------------
  document.querySelectorAll('[data-filtro]').forEach(function (b) {
    b.addEventListener('click', function () {
      filtroMetodo = b.getAttribute('data-filtro');
      document.querySelectorAll('[data-filtro]').forEach(function (o) { o.setAttribute('aria-pressed', String(o === b)); });
      dibujarVentas();
    });
  });
  el.buscarFolio.addEventListener('input', U.retrasar(dibujarVentas, 200));
  el.efectivoContado.addEventListener('input', revisarArqueo);
  el.generarCierre.addEventListener('click', generarCierre);
  el.exportarResumen.addEventListener('click', exportarResumen);
  el.exportarCorte.addEventListener('click', function () { if (ultimoCorte) exportar(ultimoCorte, el.exportarCorte); });
  el.exportarCortes.addEventListener('click', exportarListaCortes);
  el.cerrarModal.addEventListener('click', function () { el.modal.hidden = true; });

  cargar();
  cargarCortes();
  // Cobros y reembolsos hechos en otro equipo entran al resumen sin recargar la página.
  Api.alCambiar(['ventas'], function () { if (el.modal.hidden) { cargar(); cargarCortes(); } });
})();
