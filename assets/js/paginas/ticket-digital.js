/**
 * @file paginas/ticket-digital.js
 * @description Controlador de «Ticket digital» (ticket-digital.html).
 *
 * Flujo:
 *   1. Lee ?venta=ID y consulta la venta (incluye datos del negocio).  GET /ventas/:id
 *   2. Dibuja el comprobante (sin IVA): precio normal, descuento y precio final.
 *   3. Imprimir → Impresora.imprimirVenta (Bluetooth, USB o sistema, 58 mm).
 *   4. WhatsApp / SMS → POST /ventas/:id/enviar. Si la API de WhatsApp no está
 *      configurada (o es SMS) se abre la app con el mensaje ya escrito.
 *      Con «Cliente 0» se pide el número al que se enviará.
 */
(function () {
  'use strict';

  if (!window.Sesion.permitida) return;

  var U = window.Utilidades;
  var Api = window.Api;
  var t = window.Idioma.t;

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    cargando: $('ticket-cargando'), vacio: $('ticket-vacio'), contenido: $('ticket-contenido'),
    avisoExito: $('aviso-exito'), lineas: $('ticket-lineas'), descuento: $('ticket-descuento'), efectivo: $('ticket-efectivo'),
    eslogan: $('ticket-eslogan'), direccion: $('ticket-direccion'), cajero: $('ticket-cajero'),
    cliente: $('ticket-cliente'), telefono: $('ticket-telefono'), plan: $('ticket-plan'), vence: $('ticket-vence'),
    mensaje: $('ticket-mensaje'), redes: $('ticket-redes'), imprimir: $('imprimir'), textoImpresora: $('texto-impresora')
  };

  var idVenta = U.parametro('venta');
  var venta = null;

  /** @param {HTMLElement} nodo @param {string|null} texto */
  function mostrarTexto(nodo, texto) { nodo.textContent = texto || ''; nodo.hidden = !texto; }

  function dibujar(v) {
    el.cargando.hidden = true;
    el.vacio.hidden = !!v;
    el.contenido.hidden = !v;
    if (!v) return;

    U.llenar(el.contenido, v);
    el.avisoExito.hidden = U.parametro('nueva') !== '1';
    el.descuento.hidden = !Number(v.Descuento);
    el.efectivo.hidden = v.MetodoPago !== 'Efectivo';

    var n = v.Establecimiento || {};
    mostrarTexto(el.eslogan, n.Eslogan);
    mostrarTexto(el.direccion, [n.Direccion, n.Telefono ? t('Tel.') + ' ' + n.Telefono : ''].filter(Boolean).join(' · '));
    mostrarTexto(el.redes, n.RedesSociales ? t('Síguenos') + ': ' + n.RedesSociales : '');
    if (n.MensajeTicket) el.mensaje.textContent = n.MensajeTicket;

    el.cajero.textContent = String(v.CobradoPor || '').replace(/\s*\(.*\)$/, '');
    el.cliente.textContent = v.ID_Cliente ? v.NombreCliente : t('Cliente 0');
    el.telefono.textContent = v.TelefonoCliente ? '(' + (v.Lada || '+52') + ' ' + U.formatoTelefono(v.TelefonoCliente) + ')' : '';

    var compraMembresia = (v.Detalle || []).find(function (d) { return d.TipoItem === 'Membresía'; });
    var plan = v.ClienteConMembresia ? v.PlanCliente : null;
    mostrarTexto(el.plan, plan ? t('Membresía') + ' ' + plan : '');
    mostrarTexto(el.vence, compraMembresia
      ? t('Tu membresía vence el {fecha}', { fecha: U.formatoFecha(compraMembresia.VenceMembresia) }) : '');

    var reembolso = document.getElementById('ticket-reembolso');
    mostrarTexto(reembolso, Number(v.Reembolsado) > 0 ? t('Reembolsado') + ': −' + U.formatoMoneda(v.Reembolsado) : '');
    var botonReembolso = document.getElementById('reembolsar');
    botonReembolso.setAttribute('data-nav', 'reembolsos.html?venta=' + encodeURIComponent(v.ID_Venta));
    botonReembolso.hidden = window.Sesion.rol() === window.Sesion.ROLES.BARBERO;

    U.dibujarLista({
      contenedor: el.lineas, plantilla: 'plantilla-linea',
      datos: (v.Detalle || []).map(function (d) {
        return Object.assign({}, d, {
          CantidadTexto: Number(d.Cantidad) > 1 ? '× ' + d.Cantidad : '',
          Bruto: Number(d.PrecioUnitario) * Number(d.Cantidad)
        });
      }),
      alCrear: function (li, d) {
        li.querySelector('[data-campo="NombreItem"]').setAttribute('translate', 'no');
        var detalle = d.TipoItem === 'Servicio' ? t('Barbero') + ': ' + (d.NombreBarbero || '—')
          : d.TipoItem === 'Producto' ? t('Despacho: mostrador')
          : t('Vence') + ': ' + U.formatoFecha(d.VenceMembresia);
        li.querySelector('[data-detalle]').textContent = detalle;
        if (Number(d.Descuento) > 0) {
          li.querySelector('.ticket__tachado').hidden = false;
          var desc = li.querySelector('[data-descuento]');
          desc.hidden = false;
          desc.textContent = t(d.Beneficio || 'Descuento') + ' · −' + U.formatoMoneda(d.Descuento);
        }
      }
    });
  }

  /** Carga la venta indicada en ?venta=ID.  GET /ventas/:id */
  async function cargarVenta() {
    if (!idVenta) { dibujar(null); return; }
    try { venta = await Api.ventas.obtener(idVenta); dibujar(venta); }
    catch (error) { U.aviso(error.message, 'error'); dibujar(null); }
  }

  async function imprimir() {
    try {
      await U.conCarga(el.imprimir, Promise.resolve(window.Impresora.imprimirVenta(venta)));
      if (window.Impresora.configuracion().tipo !== 'sistema') U.aviso('Ticket enviado a la impresora.');
    } catch (error) { U.aviso(error.message || String(error), 'error'); }
  }

  /** @param {HTMLButtonElement} boton */
  async function enviar(boton) {
    var canal = boton.getAttribute('data-canal');
    var telefono = null;
    if (!venta.TelefonoCliente) {
      telefono = window.prompt(t('Número de 10 dígitos al que se enviará el ticket:'));
      if (!telefono) return;
      if (!U.telefonoValido(telefono)) { U.aviso('El teléfono debe tener exactamente 10 dígitos.', 'error'); return; }
    }
    try {
      var r = await U.conCarga(boton, Api.ventas.enviarTicket(idVenta, canal, telefono));
      if (r.Enviado) U.aviso('Ticket enviado por WhatsApp.');
      else if (r.Enlace) {
        if (canal === 'whatsapp' && r.Configurado && r.Error) U.aviso(t('No se pudo enviar automáticamente: {e}', { e: r.Error }), 'error');
        U.abrirExterno(r.Enlace);
      }
    } catch (error) { U.aviso(error.message, 'error'); }
  }

  // ---- Arranque ---------------------------------------------------------------
  var cfg = window.Impresora.configuracion();
  el.textoImpresora.textContent = cfg.nombre
    ? t('Impresora') + ': ' + cfg.nombre
    : t({ android: 'Impresora Bluetooth (elígela en Ajustes)', sistema: 'Impresora del sistema · 58 mm', serie: 'USB o Bluetooth (puerto serie) · 58 mm', ble: 'Bluetooth BLE · 58 mm' }[cfg.tipo] || 'Impresora térmica de 58 mm');
  el.imprimir.addEventListener('click', imprimir);
  document.querySelectorAll('[data-canal]').forEach(function (b) { b.addEventListener('click', function () { enviar(b); }); });
  cargarVenta();
})();
