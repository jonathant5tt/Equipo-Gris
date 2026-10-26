/**
 * @file paginas/cierre-caja.js
 * @description Controlador de «Cierre de caja» (cierre-caja.html).
 *
 * Flujo (diagrama de secuencia 3.1.3):
 *   1. Consulta las ventas del turno sin corte.   GET /cierres/resumen
 *   2. Muestra totales por método e indicadores.
 *   3. Compara efectivo esperado (fondo inicial + ventas en efectivo) contra
 *      el efectivo contado y avisa si hay diferencia.
 *   4. Registra el corte.                         POST /cierres { EfectivoContado }
 */
(function () {
  'use strict';

  if (!window.Sesion.permitida) return;

  var U = window.Utilidades;
  var Api = window.Api;

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    datosTurno: $('datos-turno'),
    numeroTickets: $('numero-tickets'),
    buscarFolio: $('buscar-folio'),
    ventasCargando: $('ventas-cargando'),
    ventasVacio: $('ventas-vacio'),
    ventasTabla: $('ventas-tabla'),
    ventasFilas: $('ventas-filas'),
    indicadores: $('indicadores'),
    resumen: $('resumen'),
    efectivoContado: $('efectivo-contado'),
    resultadoArqueo: $('resultado-arqueo'),
    generarCierre: $('generar-cierre'),
    imprimir: $('imprimir'),
    modal: $('cierre-exitoso'),
    cerrarModal: $('cerrar-modal')
  };

  var resumen = null;   // Respuesta de GET /cierres/resumen
  var filtroMetodo = '';

  /** @returns {number} Fondo inicial + ventas en efectivo. */
  function efectivoEsperado() {
    if (!resumen) return 0;
    return Number(resumen.FondoInicial || 0) + Number((resumen.PorMetodo || {}).Efectivo || 0);
  }

  /** Carga el resumen del turno y llena indicadores, totales y tabla de ventas. */
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
      EfectivoEsperado: efectivoEsperado()
    });
    U.llenar(el.datosTurno, datos);
    U.llenar(el.indicadores, datos);
    U.llenar(el.resumen, datos);

    var total = (r.Ventas || []).length;
    el.numeroTickets.textContent = total + (total === 1 ? ' ticket' : ' tickets');
    dibujarVentas();
    revisarArqueo();
  }

  /** Dibuja la tabla aplicando el filtro de método y la búsqueda. */
  function dibujarVentas() {
    var texto = U.normalizarTexto(el.buscarFolio.value);
    var ventas = ((resumen && resumen.Ventas) || []).filter(function (v) {
      var coincideMetodo = !filtroMetodo || v.MetodoPago === filtroMetodo;
      var coincideTexto = !texto || U.normalizarTexto(v.NumeroFactura + ' ' + (v.NombreCliente || '')).indexOf(texto) !== -1;
      return coincideMetodo && coincideTexto;
    });
    U.dibujarLista({ contenedor: el.ventasFilas, plantilla: 'plantilla-venta', datos: ventas, vacio: el.ventasVacio });
    el.ventasTabla.hidden = !ventas.length;
    el.ventasFilas.hidden = false;
  }

  /** Compara lo contado con lo esperado y habilita el cierre. */
  function revisarArqueo() {
    var hayVentas = !!(resumen && resumen.Ventas && resumen.Ventas.length);
    var capturado = el.efectivoContado.value !== '';
    var diferencia = (Number(el.efectivoContado.value) || 0) - efectivoEsperado();

    if (!capturado) {
      el.resultadoArqueo.textContent = 'Captura el efectivo contado para continuar.';
      el.resultadoArqueo.className = 'ayuda';
    } else if (Math.abs(diferencia) < 0.005) {
      el.resultadoArqueo.textContent = 'Arqueo exacto: sin diferencias.';
      el.resultadoArqueo.className = 'ayuda ayuda--exito';
    } else {
      el.resultadoArqueo.textContent = (diferencia > 0 ? 'Sobrante de ' : 'Faltante de ') + U.formatoMoneda(Math.abs(diferencia)) + '. Se registrará en el corte.';
      el.resultadoArqueo.className = 'ayuda ayuda--error';
    }
    el.generarCierre.disabled = !(hayVentas && capturado);
  }

  /** Registra el corte; si hay diferencia en el arqueo pide confirmación. */
  async function generarCierre() {
    var contado = Number(el.efectivoContado.value) || 0;
    var diferencia = contado - efectivoEsperado();
    if (Math.abs(diferencia) >= 0.005 &&
        !(await U.confirmar('Hay una diferencia de ' + U.formatoMoneda(diferencia) + '. ¿Registrar el corte de todos modos?'))) return;

    try {
      var corte = await U.conCarga(el.generarCierre, Api.cierres.crear({ EfectivoContado: contado }));
      if (corte && corte.ID_Corte) {
        U.llenar(el.modal, Object.assign({ Diferencia: diferencia }, corte));
        el.modal.hidden = false;
        cargar();
      }
    } catch (error) { U.aviso(error.message, 'error'); }
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
  el.imprimir.addEventListener('click', function () { window.print(); });
  el.cerrarModal.addEventListener('click', function () { el.modal.hidden = true; });

  cargar();
})();
