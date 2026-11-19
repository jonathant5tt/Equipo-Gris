/**
 * @file paginas/reembolsos.js
 * @description Controlador de «Reembolsos» (reembolsos.html).
 *
 * Flujo:
 *   1. Busca tickets por fechas, folio o cliente.        GET /ventas
 *      (o llega con ?venta=ID desde el historial o el ticket)
 *   2. Muestra los conceptos que aún se pueden devolver. GET /reembolsos/venta/:id
 *      Cada renglón trae CantidadDisponible e ImporteDisponible (lo pagado).
 *   3. Registra el reembolso.                            POST /reembolsos
 *      { ID_Venta, Renglones[{ID_Detalle, Cantidad}], Motivo, MetodoDevolucion,
 *        RegresarInventario, Contrasena }
 *   4. Lista los reembolsos de las fechas y los exporta. GET /reembolsos
 */
(function () {
  'use strict';

  if (!window.Sesion.permitida) return;

  var U = window.Utilidades;
  var Api = window.Api;
  var t = window.Idioma.t;
  var $ = function (id) { return document.getElementById(id); };

  var el = {
    buscarVenta: $('buscar-venta'), desde: $('desde'), hasta: $('hasta'), buscar: $('buscar'), botonBuscar: $('boton-buscar'),
    ventas: $('ventas'), ventasVacio: $('ventas-vacio'),
    folio: $('venta-folio'), sinVenta: $('sin-venta'), formulario: $('formulario'), datos: $('venta-datos'),
    yaReembolsada: $('ya-reembolsada'), renglones: $('renglones'), marcarTodo: $('marcar-todo'),
    motivo: $('motivo'), metodo: $('metodo'), contrasena: $('contrasena'),
    filaInventario: $('fila-inventario'), regresar: $('regresar-inventario'), avisoMembresia: $('aviso-membresia'),
    total: $('total-devolver'), confirmar: $('confirmar'),
    historialTotal: $('historial-total'), exportar: $('exportar'), historialVacio: $('historial-vacio'),
    historialTabla: $('historial-tabla'), historialFilas: $('historial-filas')
  };

  var venta = null;        // Venta elegida (GET /reembolsos/venta/:id)
  var eleccion = {};       // { ID_Detalle: piezas a devolver }
  var historial = [];

  // Mismo redondeo comercial que el servidor (servicios/validar.js).
  var redondear = function (n) { return Math.round(Number((n * 100).toPrecision(12))) / 100; };

  // ---------------------------------------------------------------------------
  // 1. Buscar el ticket
  // ---------------------------------------------------------------------------

  async function buscarVentas() {
    var desde = el.desde.value || U.fechaISO();
    var hasta = el.hasta.value || desde;
    if (hasta < desde) { U.aviso('La fecha final no puede ser anterior a la inicial.', 'error'); return; }
    var lista = [];
    try {
      var r = await U.conCarga(el.botonBuscar, Api.ventas.listar({ desde: desde, hasta: hasta, buscar: el.buscar.value.trim(), pagina: 1, tamano: 50 }));
      lista = (r && r.registros) || [];
    } catch (error) { U.aviso(error.message, 'error'); }
    U.dibujarLista({
      contenedor: el.ventas, plantilla: 'plantilla-venta', datos: lista, vacio: el.ventasVacio,
      alCrear: function (fila, v) {
        if (Number(v.Reembolsado) > 0) {
          var r = fila.querySelector('[data-reembolsado]');
          r.hidden = false;
          r.textContent = t('Reembolsado') + ' −' + U.formatoMoneda(v.Reembolsado);
        }
        if (venta && venta.ID_Venta === v.ID_Venta) fila.setAttribute('aria-current', 'true');
        fila.addEventListener('click', function () { abrirVenta(v.ID_Venta); });
      }
    });
    el.ventas.hidden = false;
    cargarHistorial();
  }

  // ---------------------------------------------------------------------------
  // 2. Conceptos de la venta
  // ---------------------------------------------------------------------------

  async function abrirVenta(id) {
    try { venta = await Api.reembolsos.venta(id); }
    catch (error) { U.aviso(error.message, 'error'); return; }
    eleccion = {};
    el.sinVenta.hidden = true;
    el.formulario.hidden = false;
    el.folio.hidden = false;
    el.folio.textContent = venta.NumeroFactura;
    U.llenar(el.datos, venta);
    el.metodo.value = venta.MetodoPago || 'Efectivo';
    el.motivo.value = '';
    el.contrasena.value = '';
    var disponible = venta.Detalle.some(function (d) { return d.CantidadDisponible > 0; });
    el.yaReembolsada.hidden = disponible;
    el.marcarTodo.hidden = !disponible;
    dibujarRenglones();
    if (window.matchMedia('(max-width: 1023px)').matches) el.formulario.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** Importe que se devuelve por `piezas` de un renglón (lo que el cliente pagó). */
  function importeDe(d, piezas) {
    if (piezas >= d.CantidadDisponible) return Number(d.ImporteDisponible);
    return redondear(Number(d.Importe) / Number(d.Cantidad) * piezas);
  }

  function dibujarRenglones() {
    U.dibujarLista({
      contenedor: el.renglones, plantilla: 'plantilla-renglon', datos: venta.Detalle,
      alCrear: function (fila, d) {
        var marca = fila.querySelector('[data-marcar]');
        var detalle = fila.querySelector('[data-detalle]');
        var cantidad = fila.querySelector('[data-cantidad]');
        var piezas = fila.querySelector('[data-piezas]');
        var importe = fila.querySelector('[data-importe]');
        var agotado = d.CantidadDisponible <= 0;
        var partes = [t(d.TipoItem)];
        if (d.Cantidad > 1) partes.push(t('{n} piezas', { n: d.Cantidad }));
        if (d.NombreBarbero) partes.push(d.NombreBarbero);
        if (d.Beneficio) partes.push(t(d.Beneficio));
        if (d.CantidadReembolsada > 0) partes.push(t(agotado ? 'Ya reembolsado' : 'Ya reembolsadas: {n}', { n: d.CantidadReembolsada }));
        detalle.textContent = partes.join(' · ');
        fila.setAttribute('data-agotado', String(agotado));
        marca.disabled = agotado;

        function pintar() {
          var n = eleccion[d.ID_Detalle] || 0;
          marca.checked = n > 0;
          fila.setAttribute('data-marcado', String(n > 0));
          cantidad.hidden = !(n > 0 && d.CantidadDisponible > 1);
          piezas.textContent = n + ' / ' + d.CantidadDisponible;
          importe.textContent = U.formatoMoneda(n > 0 ? importeDe(d, n) : (agotado ? 0 : Number(d.ImporteDisponible)));
          importe.classList.toggle('texto-tenue', !(n > 0));
          actualizarTotal();
        }
        marca.addEventListener('change', function () {
          if (marca.checked) eleccion[d.ID_Detalle] = d.CantidadDisponible; else delete eleccion[d.ID_Detalle];
          pintar();
        });
        fila.querySelector('[data-menos]').addEventListener('click', function () {
          var n = (eleccion[d.ID_Detalle] || 0) - 1;
          if (n <= 0) delete eleccion[d.ID_Detalle]; else eleccion[d.ID_Detalle] = n;
          pintar();
        });
        fila.querySelector('[data-mas]').addEventListener('click', function () {
          eleccion[d.ID_Detalle] = Math.min(d.CantidadDisponible, (eleccion[d.ID_Detalle] || 0) + 1);
          pintar();
        });
        fila._pintar = pintar;
        pintar();
      }
    });
    el.renglones.hidden = false;
  }

  function elegidos() {
    return venta ? venta.Detalle.filter(function (d) { return eleccion[d.ID_Detalle] > 0; }) : [];
  }

  function actualizarTotal() {
    var lista = elegidos();
    var total = redondear(lista.reduce(function (s, d) { return s + importeDe(d, eleccion[d.ID_Detalle]); }, 0));
    el.total.textContent = U.formatoMoneda(total);
    el.filaInventario.hidden = !lista.some(function (d) { return d.TipoItem === 'Producto'; });
    el.avisoMembresia.hidden = !lista.some(function (d) { return d.TipoItem === 'Membresía'; });
    el.confirmar.disabled = !lista.length;
    return total;
  }

  function marcarTodo() {
    venta.Detalle.forEach(function (d) { if (d.CantidadDisponible > 0) eleccion[d.ID_Detalle] = d.CantidadDisponible; });
    Array.prototype.forEach.call(el.renglones.children, function (fila) { if (fila._pintar) fila._pintar(); });
  }

  // ---------------------------------------------------------------------------
  // 3. Registrar
  // ---------------------------------------------------------------------------

  async function registrar(e) {
    e.preventDefault();
    var lista = elegidos();
    if (!lista.length) return;
    if (el.motivo.value.trim().length < 3) { U.aviso('Escribe el motivo del reembolso.', 'error'); el.motivo.focus(); return; }
    if (!el.contrasena.value) { U.aviso('Escribe tu contraseña para autorizar el reembolso.', 'error'); el.contrasena.focus(); return; }
    var total = actualizarTotal();
    if (!(await U.confirmar(t('¿Devolver {monto} del ticket {folio}? Esta acción no se puede deshacer.', { monto: U.formatoMoneda(total), folio: venta.NumeroFactura })))) return;
    try {
      var r = await U.conCarga(el.confirmar, Api.reembolsos.crear({
        ID_Venta: venta.ID_Venta,
        Renglones: lista.map(function (d) { return { ID_Detalle: d.ID_Detalle, Cantidad: eleccion[d.ID_Detalle] }; }),
        Motivo: el.motivo.value.trim(), MetodoDevolucion: el.metodo.value,
        RegresarInventario: !el.filaInventario.hidden && el.regresar.checked,
        Contrasena: el.contrasena.value
      }));
      U.aviso(t('Reembolso registrado: {monto}.', { monto: U.formatoMoneda(r.Monto) }));
      await abrirVenta(venta.ID_Venta);
      buscarVentas();
    } catch (error) {
      U.aviso(error.message, 'error');
      if (error.estado === 403) { el.contrasena.value = ''; el.contrasena.focus(); }
    }
  }

  // ---------------------------------------------------------------------------
  // 4. Reembolsos del periodo
  // ---------------------------------------------------------------------------

  async function cargarHistorial() {
    var desde = el.desde.value || U.fechaISO();
    var r = null;
    try { r = await Api.reembolsos.listar({ desde: desde, hasta: el.hasta.value || desde }); }
    catch (error) { U.aviso(error.message, 'error'); }
    historial = (r && r.registros) || [];
    var resumen = (r && r.resumen) || { Numero: 0, Total: 0 };
    el.historialTotal.textContent = t(resumen.Numero === 1 ? '{n} reembolso' : '{n} reembolsos', { n: resumen.Numero }) + ' · ' + U.formatoMoneda(resumen.Total);
    U.dibujarLista({
      contenedor: el.historialFilas, plantilla: 'plantilla-historial', datos: historial, vacio: el.historialVacio,
      alCrear: function (fila, x) { fila.querySelector('[data-inventario]').hidden = !x.RegresaInventario; }
    });
    el.historialTabla.hidden = !historial.length;
    el.historialFilas.hidden = false;
    el.exportar.hidden = !historial.length;
  }

  async function exportar() {
    var filas = [['Fecha', 'Hora', 'Ticket', 'Cliente', 'Qué se devolvió', 'Motivo', 'Devolución', 'Regresó al inventario', 'Monto', 'Autorizó', 'Corte'].map(function (x) { return t(x); })];
    var total = 0;
    historial.forEach(function (x) {
      var fh = U.fechaHoraCSV(x.Fecha);
      total += Number(x.Monto || 0);
      filas.push([fh.fecha, fh.hora, x.NumeroFactura, t(x.NombreCliente || ''), x.Concepto, x.Motivo, t(x.MetodoDevolucion), t(x.RegresaInventario ? 'Sí' : 'No'),
        Number(x.Monto || 0).toFixed(2), x.RealizadoPor, x.ID_Corte ? '#' + x.ID_Corte : t('Sin corte')]);
    });
    filas.push([]);
    filas.push([t('TOTAL'), '', '', t('{n} reembolsos', { n: historial.length }), '', '', '', '', total.toFixed(2), '', '']);
    var desde = el.desde.value || U.fechaISO();
    try { await U.conCarga(el.exportar, U.descargarArchivo('reembolsos_' + desde + '_' + (el.hasta.value || desde) + '.csv', U.csv(filas))); }
    catch (error) { U.aviso(error.message || String(error), 'error'); }
  }

  // ---- Arranque ---------------------------------------------------------------
  el.desde.value = U.fechaISO();
  el.hasta.value = U.fechaISO();
  el.buscarVenta.addEventListener('submit', function (e) { e.preventDefault(); buscarVentas(); });
  el.formulario.addEventListener('submit', registrar);
  el.marcarTodo.addEventListener('click', marcarTodo);
  el.exportar.addEventListener('click', exportar);

  buscarVentas();
  var inicial = U.parametro('venta');
  if (inicial) abrirVenta(inicial);
  Api.alCambiar(['ventas'], function () { if (!elegidos().length && !el.motivo.value) buscarVentas(); });
})();
