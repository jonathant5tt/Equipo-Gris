/**
 * @file paginas/ticket-digital.js
 * @description Controlador de «Ticket digital» (ticket-digital.html).
 *
 * Flujo:
 *   1. Lee ?venta=ID de la URL.
 *   2. Consulta la venta y los datos del negocio.  GET /ventas/:id, GET /establecimiento
 *   3. Dibuja el comprobante.
 *   4. Acciones: imprimir (navegador), enviar por WhatsApp o SMS
 *      (POST /ventas/:id/enviar) o iniciar otra venta.
 */
(function () {
  'use strict';

  if (!window.Sesion.permitida) return;

  var U = window.Utilidades;
  var Api = window.Api;

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    cargando: $('ticket-cargando'),
    vacio: $('ticket-vacio'),
    contenido: $('ticket-contenido'),
    lineas: $('ticket-lineas'),
    descuento: $('ticket-descuento'),
    efectivo: $('ticket-efectivo'),
    direccion: $('ticket-direccion'),
    mensaje: $('ticket-mensaje'),
    imprimir: $('imprimir')
  };

  var idVenta = U.parametro('venta');

  /** @param {Object|null} venta */
  function mostrar(venta) {
    el.cargando.hidden = true;
    el.vacio.hidden = !!venta;
    el.contenido.hidden = !venta;
    if (!venta) return;

    U.llenar(el.contenido, venta);
    el.descuento.hidden = !Number(venta.Descuento);
    el.efectivo.hidden = venta.MetodoPago !== 'Efectivo';

    U.dibujarLista({
      contenedor: el.lineas,
      plantilla: 'plantilla-linea',
      datos: (venta.Detalle || []).map(function (d) {
        return {
          NombreItem: d.NombreItem,
          CantidadTexto: Number(d.Cantidad) > 1 ? '× ' + d.Cantidad : '',
          DetalleTexto: d.NombreBarbero ? 'Barbero: ' + d.NombreBarbero : (d.TipoItem === 'Producto' ? 'Mostrador' : d.TipoItem),
          Importe: Number(d.PrecioUnitario) * Number(d.Cantidad)
        };
      })
    });
  }

  /** Datos del negocio para el encabezado del ticket. */
  async function cargarNegocio() {
    try {
      var negocio = await Api.establecimiento.obtener();
      if (negocio && negocio.Direccion) { el.direccion.textContent = negocio.Direccion; el.direccion.hidden = false; }
      if (negocio && negocio.MensajeTicket) el.mensaje.textContent = negocio.MensajeTicket;
    } catch (e) { /* el ticket se muestra sin dirección */ }
  }

  /** Carga la venta indicada en ?venta=ID.  GET /ventas/:id */
  async function cargarVenta() {
    if (!idVenta) { mostrar(null); return; }
    try { mostrar(await Api.ventas.obtener(idVenta)); }
    catch (error) { U.aviso(error.message, 'error'); mostrar(null); }
  }

  /** @param {HTMLButtonElement} boton */
  async function enviar(boton) {
    var canal = boton.getAttribute('data-canal');
    try {
      var r = await U.conCarga(boton, Api.ventas.enviarTicket(idVenta, canal));
      if (!(r && r.simulado)) U.aviso('Ticket enviado por ' + (canal === 'sms' ? 'SMS' : 'WhatsApp') + '.');
    } catch (error) { U.aviso(error.message, 'error'); }
  }

  // ---- Arranque ---------------------------------------------------------------
  el.imprimir.addEventListener('click', function () { window.print(); });
  document.querySelectorAll('[data-canal]').forEach(function (b) {
    b.addEventListener('click', function () { enviar(b); });
  });
  cargarNegocio();
  cargarVenta();
})();
