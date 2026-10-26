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
 *   4. Exportar CSV descarga TODAS las ventas del filtro (no solo la página).
 */
(function () {
  'use strict';

  if (!window.Sesion.permitida) return;

  var U = window.Utilidades;
  var Api = window.Api;
  var CFG = window.APP_CONFIG;

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
    imprimir: $('imprimir')
  };

  var periodo = 'hoy';
  var pagina = 1;
  var totalRegistros = 0;

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
    el.etiquetaDesde.textContent = valor === 'fecha' ? 'Fecha' : 'Desde';
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
    U.llenar(el.totales, {
      Efectivo: porMetodo.Efectivo || 0, Tarjeta: porMetodo.Tarjeta || 0,
      Transferencia: porMetodo.Transferencia || 0, Total: resumen.Total || 0
    });

    U.dibujarLista({
      contenedor: el.filas,
      plantilla: 'plantilla-venta',
      datos: registros,
      vacio: el.vacio,
      alCrear: function (fila, venta) {
        fila.querySelector('[data-accion="ver"]').setAttribute('data-nav', 'ticket-digital.html?venta=' + encodeURIComponent(venta.ID_Venta));
      }
    });
    el.tabla.hidden = !registros.length;
    el.filas.hidden = false;
    el.exportar.disabled = !totalRegistros;

    // Paginación
    var paginas = Math.max(1, Math.ceil(totalRegistros / CFG.TAMANO_PAGINA));
    el.paginacion.hidden = !totalRegistros;
    el.textoPaginacion.textContent = 'Mostrando ' + registros.length + ' de ' + totalRegistros + ' ventas';
    el.numeroPagina.textContent = pagina + ' / ' + paginas;
    el.anterior.disabled = pagina <= 1;
    el.siguiente.disabled = pagina >= paginas;
  }

  /** @param {number} delta */
  function cambiarPagina(delta) { pagina += delta; consultar(); }

  /** Convierte un valor a celda CSV segura. */
  function celdaCSV(valor) {
    var texto = valor == null ? '' : String(valor);
    return /[",\n;]/.test(texto) ? '"' + texto.replace(/"/g, '""') + '"' : texto;
  }

  /** Descarga todas las ventas del filtro como archivo CSV (UTF-8, compatible con Excel). */
  async function exportarCSV() {
    try {
      var r = await U.conCarga(el.exportar, Api.ventas.listar(Object.assign({ pagina: 1, tamano: totalRegistros }, filtrosActuales())));
      var columnas = ['NumeroFactura', 'FechaHoraCobro', 'NombreCliente', 'TipoItem', 'Concepto', 'NombreBarbero', 'MetodoPago', 'ImporteTotal', 'IVA'];
      var lineas = [columnas.join(',')].concat(((r && r.registros) || []).map(function (v) {
        return columnas.map(function (c) { return celdaCSV(v[c]); }).join(',');
      }));
      var archivo = new Blob(['﻿' + lineas.join('\n')], { type: 'text/csv;charset=utf-8' });
      var enlace = document.createElement('a');
      enlace.href = URL.createObjectURL(archivo);
      enlace.download = 'ventas_' + filtrosActuales().desde + '_' + filtrosActuales().hasta + '.csv';
      document.body.appendChild(enlace);
      enlace.click();
      setTimeout(function () { URL.revokeObjectURL(enlace.href); enlace.remove(); }, 1000);
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
  el.imprimir.addEventListener('click', function () { window.print(); });

  elegirPeriodo('hoy');
  consultar();
})();
