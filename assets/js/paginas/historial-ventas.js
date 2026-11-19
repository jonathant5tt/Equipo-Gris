/**
 * @file paginas/historial-ventas.js
 * @description Controlador de «Historial de ventas» (historial-ventas.html).
 *
 * Flujo:
 *   1. Periodo inicial: hoy.
 *   2. Al filtrar consulta las ventas paginadas.
 *      GET /ventas?desde=&hasta=&concepto=&buscar=&pagina=&tamano=
 *      → { registros, total, pagina, resumen }
 *   3. Dibuja indicadores, tabla, paginación y totales por método.
 *   4. Exportar CSV descarga TODAS las ventas del filtro (no solo la página),
 *      sin IVA: Subtotal, Descuento (membresía) y Total.
 *   Búsqueda: folio, nombre del cliente o «Cliente 0» (ventas sin cliente).
 */
(function () {
  'use strict';

  if (!window.Sesion.permitida) return;

  var U = window.Utilidades;
  var Api = window.Api;
  var CFG = window.APP_CONFIG;
  var t = window.Idioma.t;

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    filtros: $('filtros'),
    desde: $('desde'),
    hasta: $('hasta'),
    etiquetaDesde: $('etiqueta-desde'),
    concepto: $('concepto'),
    buscar: $('buscar'),
    indicadores: $('indicadores'),
    cargando: $('ventas-cargando'),
    vacio: $('ventas-vacio'),
    tabla: $('ventas-tabla'),
    filas: $('ventas-filas'),
    paginacion: $('paginacion'),
    textoPaginacion: $('texto-paginacion'),
    numeroPagina: $('numero-pagina'),
    anterior: $('pagina-anterior'),
    siguiente: $('pagina-siguiente'),
    totales: $('totales'),
    exportar: $('exportar'),
  };

  var periodo = 'hoy';
  var pagina = 1;
  var totalRegistros = 0;
  var ultimoResumen = {};

  /** @param {'hoy'|'rango'|'fecha'} valor */
  function elegirPeriodo(valor) {
    periodo = valor;
    document.querySelectorAll('[data-periodo]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-periodo') === valor));
    });
    var hoy = U.fechaISO();
    if (valor === 'hoy') { el.desde.value = hoy; el.hasta.value = hoy; }
    if (!el.desde.value) el.desde.value = hoy;
    if (!el.hasta.value) el.hasta.value = hoy;
    el.desde.disabled = valor === 'hoy';
    el.hasta.disabled = valor !== 'rango';
    el.etiquetaDesde.textContent = t(valor === 'fecha' ? 'Fecha' : 'Desde');
  }

  /** @returns {Object} Filtros para la API. */
  function filtrosActuales() {
    var desde = el.desde.value || U.fechaISO();
    return {
      desde: desde,
      hasta: periodo === 'rango' ? (el.hasta.value || desde) : desde,
      concepto: el.concepto.value,
      buscar: el.buscar.value.trim()
    };
  }

  /** Consulta la página actual de ventas con los filtros y dibuja indicadores, tabla, paginación y totales. */
  async function consultar() {
    var f = filtrosActuales();
    if (f.hasta < f.desde) { U.aviso('La fecha final no puede ser anterior a la inicial.', 'error'); return; }

    el.cargando.hidden = false;
    var respuesta = null;
    try { respuesta = await Api.ventas.listar(Object.assign({ pagina: pagina, tamano: CFG.TAMANO_PAGINA }, f)); }
    catch (error) { U.aviso(error.message, 'error'); }
    el.cargando.hidden = true;

    var registros = (respuesta && respuesta.registros) || [];
    var resumen = (respuesta && respuesta.resumen) || {};
    var porMetodo = resumen.PorMetodo || {};
    totalRegistros = (respuesta && respuesta.total) || 0;

    U.llenar(el.indicadores, {
      Transacciones: resumen.Transacciones || 0, Servicios: resumen.Servicios || 0,
      Productos: resumen.Productos || 0, TicketPromedio: resumen.TicketPromedio || 0
    });
    var tipos = resumen.PorTipo || {};
    var tipo = function (n) { return tipos[n] || { Cantidad: 0, Importe: 0 }; };
    ultimoResumen = resumen;
    U.llenar(el.totales, {
      Efectivo: porMetodo.Efectivo || 0, Tarjeta: porMetodo.Tarjeta || 0,
      Transferencia: porMetodo.Transferencia || 0, Total: resumen.Total || 0, Descuentos: resumen.Descuentos || 0,
      Bruto: resumen.Bruto || 0, Reembolsos: resumen.Reembolsos || 0, Neto: resumen.Neto || 0,
      NumeroReembolsos: '(' + (resumen.NumeroReembolsos || 0) + ')',
      CantServicios: '× ' + tipo('Servicios').Cantidad, ImpServicios: tipo('Servicios').Importe,
      CantProductos: '× ' + tipo('Productos').Cantidad, ImpProductos: tipo('Productos').Importe,
      CantMembresias: '× ' + tipo('Membresias').Cantidad, ImpMembresias: tipo('Membresias').Importe
    });

    U.dibujarLista({
      contenedor: el.filas,
      plantilla: 'plantilla-venta',
      datos: registros,
      vacio: el.vacio,
      alCrear: function (fila, venta) {
        fila.querySelector('[data-accion="ver"]').setAttribute('data-nav', 'ticket-digital.html?venta=' + encodeURIComponent(venta.ID_Venta));
        fila.querySelector('[data-campo="Concepto"]').setAttribute('translate', 'no');
        fila.querySelector('[data-campo="CobradoPor"]').setAttribute('translate', 'no');
        if (Number(venta.Descuento) > 0) {
          var d = fila.querySelector('[data-descuento]');
          d.hidden = false;
          d.textContent = '−' + U.formatoMoneda(venta.Descuento);
          d.title = t('Descuento aplicado');
        }
        fila.querySelector('[data-accion="reembolsar"]').setAttribute('data-nav', 'reembolsos.html?venta=' + encodeURIComponent(venta.ID_Venta));
        if (Number(venta.Reembolsado) > 0) {
          var r = fila.querySelector('[data-reembolsado]');
          r.hidden = false;
          r.textContent = t('Reembolsado') + ' −' + U.formatoMoneda(venta.Reembolsado);
        }
      }
    });
    el.tabla.hidden = !registros.length;
    el.filas.hidden = false;
    el.exportar.disabled = !totalRegistros;

    // Paginación
    var paginas = Math.max(1, Math.ceil(totalRegistros / CFG.TAMANO_PAGINA));
    el.paginacion.hidden = !totalRegistros;
    el.textoPaginacion.textContent = t('Mostrando {n} de {total} ventas', { n: registros.length, total: totalRegistros });
    el.numeroPagina.textContent = pagina + ' / ' + paginas;
    el.anterior.disabled = pagina <= 1;
    el.siguiente.disabled = pagina >= paginas;
  }

  /** @param {number} delta */
  function cambiarPagina(delta) { pagina += delta; consultar(); }

  /**
   * Exporta TODAS las ventas del filtro (no solo la página) a CSV.
   * Fecha y hora van en columnas separadas para que Excel no muestre «#####».
   */
  async function exportarCSV() {
    try {
      var filtros = filtrosActuales();
      var r = await U.conCarga(el.exportar, Api.ventas.listar(Object.assign({ pagina: 1, tamano: Math.min(Math.max(totalRegistros, 1), 5000) }, filtros)));
      var ventas = (r && r.registros) || [];
      // Sin IVA: el negocio no desglosa impuestos en sus tickets.
      var filas = [['Folio', 'Fecha', 'Hora', 'Cliente', 'Tipo', 'Concepto', 'Barbero', 'Método', 'Subtotal', 'Descuento', 'Total', 'Reembolsado', 'Cobró'].map(function (c) { return t(c); })];
      var suma = { Subtotal: 0, Descuento: 0, ImporteTotal: 0, Reembolsado: 0 };
      ventas.forEach(function (v) {
        var fh = U.fechaHoraCSV(v.FechaHoraCobro);
        filas.push([v.NumeroFactura, fh.fecha, fh.hora, v.NombreCliente, t(v.TipoItem || ''), v.Concepto, v.NombreBarbero, t(v.MetodoPago || ''),
          Number(v.Subtotal || 0).toFixed(2), Number(v.Descuento || 0).toFixed(2), Number(v.ImporteTotal || 0).toFixed(2), Number(v.Reembolsado || 0).toFixed(2), v.CobradoPor]);
        Object.keys(suma).forEach(function (k) { suma[k] += Number(v[k] || 0); });
      });
      filas.push([]);
      filas.push([t('TOTAL'), '', '', t('{n} ventas', { n: ventas.length }), '', '', '', '',
        suma.Subtotal.toFixed(2), suma.Descuento.toFixed(2), suma.ImporteTotal.toFixed(2), suma.Reembolsado.toFixed(2), '']);
      // Resumen del periodo (lo mismo que se ve en pantalla).
      var x = (r && r.resumen) || ultimoResumen || {};
      var d2 = function (n) { return Number(n || 0).toFixed(2); };
      var pm = x.PorMetodo || {}, pt = x.PorTipo || {};
      filas.push([]);
      filas.push([t('Resumen del periodo'), t('Cantidad'), t('Importe')]);
      filas.push([t('Ventas brutas'), x.Transacciones || 0, d2(x.Bruto)]);
      filas.push([t('Descuentos y membresías'), '', '-' + d2(x.Descuentos)]);
      filas.push([t('Total cobrado'), '', d2(x.Total)]);
      filas.push([t('Reembolsos'), x.NumeroReembolsos || 0, '-' + d2(x.Reembolsos)]);
      filas.push([t('Ingreso neto'), '', d2(x.Neto)]);
      filas.push([t('Ticket promedio'), '', d2(x.TicketPromedio)]);
      filas.push([]);
      ['Efectivo', 'Tarjeta', 'Transferencia'].forEach(function (m) { filas.push([t(m), '', d2(pm[m])]); });
      filas.push([]);
      [['Servicios', 'Servicios'], ['Productos', 'Productos'], ['Membresías', 'Membresias']].forEach(function (k) {
        filas.push([t(k[0]), (pt[k[1]] || {}).Cantidad || 0, d2((pt[k[1]] || {}).Importe)]);
      });
      await U.descargarArchivo('ventas_' + filtros.desde + '_' + filtros.hasta + '.csv', U.csv(filas));
    } catch (error) { U.aviso(error.message, 'error'); }
  }

  // ---- Arranque ---------------------------------------------------------------
  document.querySelectorAll('[data-periodo]').forEach(function (b) {
    b.addEventListener('click', function () { elegirPeriodo(b.getAttribute('data-periodo')); });
  });
  el.filtros.addEventListener('submit', function (e) { e.preventDefault(); pagina = 1; consultar(); });
  el.anterior.addEventListener('click', function () { cambiarPagina(-1); });
  el.siguiente.addEventListener('click', function () { cambiarPagina(1); });
  el.exportar.addEventListener('click', exportarCSV);

  elegirPeriodo('hoy');
  consultar();
  Api.alCambiar(['ventas'], consultar);
})();
