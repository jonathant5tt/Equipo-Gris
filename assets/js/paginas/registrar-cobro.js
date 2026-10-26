/**
 * @file paginas/registrar-cobro.js
 * @description Controlador de «Registrar cobro» (registrar-cobro.html).
 *
 * Flujo (diagrama de secuencia 3.1.2):
 *   1. Carga catálogos y barberos.        GET /servicios, /productos, /membresias, /barberos
 *   2. (Opcional) asocia al cliente.      GET /clientes?buscar= | GET /clientes/:id
 *   3. Agrega conceptos validando existencias de productos.
 *   4. Calcula la vista previa de totales.
 *   5. Envía la venta.                    POST /ventas  → ticket-digital.html?venta=ID
 *
 * Cálculo de la vista previa (el servidor recalcula y manda el valor final):
 *   subtotal  = Σ (PrecioUnitario × Cantidad)
 *   descuento = subtotal de servicios × DescuentoServicios % (si la membresía está Activa)
 *   total     = subtotal − descuento
 *   IVA       = total − total / (1 + TASA_IVA)      (los precios ya incluyen IVA)
 */
(function () {
  'use strict';

  if (!window.Sesion.permitida) return;

  var U = window.Utilidades;
  var Api = window.Api;
  var CFG = window.APP_CONFIG;

  /**
   * @typedef {Object} Concepto
   * @property {'Servicio'|'Producto'|'Membresía'} TipoItem
   * @property {number|null} ID_Servicio
   * @property {number|null} ID_Producto
   * @property {number|null} ID_Membresia
   * @property {number|null} ID_Barbero
   * @property {string} NombreItem
   * @property {string|null} NombreBarbero
   * @property {number} PrecioUnitario
   * @property {number} Cantidad
   */

  var estado = {
    servicios: [],
    productos: [],
    membresias: [],
    barberos: [],
    cliente: null,
    /** @type {Concepto[]} */
    conceptos: [],
    metodo: 'Efectivo',
    cantidad: 1
  };

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    buscarCliente: $('buscar-cliente'),
    clienteBusqueda: $('cliente-busqueda'),
    sinResultados: $('clientes-sin-resultados'),
    resultadosClientes: $('resultados-clientes'),
    clienteElegido: $('cliente-elegido'),
    membresiaCliente: $('membresia-cliente'),
    cambiarCliente: $('cambiar-cliente'),
    servicio: $('servicio'),
    barbero: $('barbero'),
    agregarServicio: $('agregar-servicio'),
    producto: $('producto'),
    cantidad: $('cantidad'),
    cantidadMenos: $('cantidad-menos'),
    cantidadMas: $('cantidad-mas'),
    existencias: $('existencias'),
    alertaExistencias: $('alerta-existencias'),
    agregarProducto: $('agregar-producto'),
    membresia: $('membresia'),
    agregarMembresia: $('agregar-membresia'),
    numeroConceptos: $('numero-conceptos'),
    conceptosVacio: $('conceptos-vacio'),
    listaConceptos: $('lista-conceptos'),
    totalSubtotal: $('total-subtotal'),
    lineaDescuento: $('linea-descuento'),
    textoDescuento: $('texto-descuento'),
    totalDescuento: $('total-descuento'),
    totalIva: $('total-iva'),
    totalFinal: $('total-final'),
    datosEfectivo: $('datos-efectivo'),
    montoRecibido: $('monto-recibido'),
    cambio: $('cambio'),
    cobrar: $('cobrar'),
    cancelarVenta: $('cancelar-venta')
  };

  // ---------------------------------------------------------------------------
  // Catálogos
  // ---------------------------------------------------------------------------

  /**
   * Llena un <select> con un catálogo.
   * @param {HTMLSelectElement} select
   * @param {Array} lista
   * @param {string} vacio  Texto si no hay registros.
   * @param {function(Object):string} texto
   * @param {string} campoId
   */
  function llenarSelect(select, lista, vacio, texto, campoId) {
    select.replaceChildren(new Option(lista.length ? 'Selecciona una opción' : vacio, ''));
    lista.forEach(function (item) { select.add(new Option(texto(item), item[campoId])); });
    select.disabled = !lista.length;
  }

  /** Carga servicios, productos, membresías y barberos en paralelo; si uno falla, los demás siguen funcionando. */
  async function cargarCatalogos() {
    var respuestas = await Promise.allSettled([
      Api.catalogos.servicios(), Api.catalogos.productos(), Api.catalogos.membresias(), Api.barberos.listar()
    ]);
    var valor = function (i) {
      if (respuestas[i].status === 'rejected') { U.aviso(respuestas[i].reason.message, 'error'); return []; }
      return respuestas[i].value || [];
    };
    estado.servicios = valor(0);
    estado.productos = valor(1);
    estado.membresias = valor(2);
    estado.barberos = valor(3);

    llenarSelect(el.servicio, estado.servicios, 'No hay servicios registrados',
      function (s) { return s.NombreServicio + ' — ' + U.formatoMoneda(s.Precio); }, 'ID_Servicio');
    llenarSelect(el.barbero, estado.barberos, 'No hay barberos registrados',
      function (b) { return b.Nombre; }, 'ID_Barbero');
    llenarSelect(el.producto, estado.productos, 'No hay productos registrados',
      function (p) { return p.NombreProducto + ' — ' + U.formatoMoneda(p.Precio); }, 'ID_Producto');
    llenarSelect(el.membresia, estado.membresias, 'No hay planes registrados',
      function (m) { return m.NombrePlan + ' — ' + U.formatoMoneda(m.Precio); }, 'ID_Membresia');
    actualizarControles();
  }

  /** Busca un registro por id en un catálogo. */
  function buscarPorId(lista, campo, id) {
    return lista.find(function (x) { return String(x[campo]) === String(id); }) || null;
  }

  // ---------------------------------------------------------------------------
  // Cliente
  // ---------------------------------------------------------------------------

  var buscarClientes = U.retrasar(async function () {
    var texto = el.buscarCliente.value.trim();
    if (texto.length < 2) { el.resultadosClientes.hidden = true; el.sinResultados.hidden = true; return; }
    var clientes = [];
    try { clientes = (await Api.clientes.buscar(texto)) || []; }
    catch (error) { U.aviso(error.message, 'error'); }
    U.dibujarLista({
      contenedor: el.resultadosClientes,
      plantilla: 'plantilla-cliente',
      datos: clientes.slice(0, 6),
      vacio: el.sinResultados,
      alCrear: function (boton, cliente) { boton.addEventListener('click', function () { elegirCliente(cliente); }); }
    });
  }, 300);

  /** @param {Object|null} cliente */
  function elegirCliente(cliente) {
    estado.cliente = cliente;
    el.clienteElegido.hidden = !cliente;
    el.clienteBusqueda.hidden = !!cliente;
    el.membresiaCliente.replaceChildren();

    if (cliente) {
      U.llenar(el.clienteElegido, cliente);
      var activa = cliente.EstadoMembresia === 'Activa';
      var insignia = document.createElement('span');
      insignia.className = 'insignia ' + (activa ? 'insignia--exito' : '');
      insignia.textContent = activa
        ? 'Membresía activa' + (cliente.NombrePlan ? ': ' + cliente.NombrePlan : '') +
          (Number(cliente.DescuentoServicios) ? ' (' + Number(cliente.DescuentoServicios) + ' % en servicios)' : '')
        : 'Sin membresía activa';
      el.membresiaCliente.appendChild(insignia);
    } else {
      el.buscarCliente.value = '';
      el.resultadosClientes.hidden = true;
      el.sinResultados.hidden = true;
      // Las membresías requieren cliente: se quitan si se desasocia.
      estado.conceptos = estado.conceptos.filter(function (c) { return c.TipoItem !== 'Membresía'; });
    }
    dibujarConceptos();
  }

  /** Preselecciona al cliente recibido en ?cliente=ID (desde el perfil o una cita). */
  async function clienteDesdeURL() {
    var id = U.parametro('cliente');
    if (!id) return;
    try { var c = await Api.clientes.obtener(id); if (c) elegirCliente(c); }
    catch (error) { U.aviso(error.message, 'error'); }
  }

  // ---------------------------------------------------------------------------
  // Pestañas y existencias
  // ---------------------------------------------------------------------------

  /** @param {'servicio'|'producto'|'membresia'} pestana */
  function cambiarPestana(pestana) {
    document.querySelectorAll('[data-pestana]').forEach(function (b) {
      var activa = b.getAttribute('data-pestana') === pestana;
      b.setAttribute('aria-selected', String(activa));
      $('panel-' + b.getAttribute('data-pestana')).hidden = !activa;
    });
  }

  /** @returns {number} Existencias del producto elegido menos lo ya agregado. */
  function existenciasDisponibles() {
    var producto = buscarPorId(estado.productos, 'ID_Producto', el.producto.value);
    if (!producto) return 0;
    var reservado = estado.conceptos
      .filter(function (c) { return c.TipoItem === 'Producto' && String(c.ID_Producto) === String(producto.ID_Producto); })
      .reduce(function (suma, c) { return suma + c.Cantidad; }, 0);
    return Number(producto.Stock) - reservado;
  }

  /** Habilita o bloquea los botones de agregar según lo elegido. */
  function actualizarControles() {
    el.agregarServicio.disabled = !(el.servicio.value && el.barbero.value);

    var hayProducto = !!el.producto.value;
    var disponibles = existenciasDisponibles();
    el.existencias.textContent = hayProducto ? disponibles + (disponibles === 1 ? ' pieza' : ' piezas') : '—';
    el.existencias.className = 'numeros ' + (hayProducto ? (disponibles > 0 ? 'texto-exito' : 'texto-error') : '');
    var insuficiente = hayProducto && estado.cantidad > disponibles;
    el.alertaExistencias.hidden = !insuficiente;
    el.agregarProducto.disabled = !hayProducto || insuficiente;
    el.cantidad.textContent = String(estado.cantidad);

    el.agregarMembresia.disabled = !(el.membresia.value && estado.cliente);
  }

  // ---------------------------------------------------------------------------
  // Conceptos
  // ---------------------------------------------------------------------------

  /** Agrega el servicio elegido con el barbero que lo realizó. */
  function agregarServicio() {
    var s = buscarPorId(estado.servicios, 'ID_Servicio', el.servicio.value);
    var b = buscarPorId(estado.barberos, 'ID_Barbero', el.barbero.value);
    if (!s || !b) return;
    estado.conceptos.push({
      TipoItem: 'Servicio', ID_Servicio: s.ID_Servicio, ID_Producto: null, ID_Membresia: null,
      ID_Barbero: b.ID_Barbero, NombreBarbero: b.Nombre,
      NombreItem: s.NombreServicio, PrecioUnitario: Number(s.Precio), Cantidad: 1
    });
    dibujarConceptos();
  }

  /** Agrega el producto elegido (o suma la cantidad si ya estaba) sin rebasar las existencias. */
  function agregarProducto() {
    var p = buscarPorId(estado.productos, 'ID_Producto', el.producto.value);
    if (!p || estado.cantidad > existenciasDisponibles()) return;
    var existente = estado.conceptos.find(function (c) { return c.TipoItem === 'Producto' && String(c.ID_Producto) === String(p.ID_Producto); });
    if (existente) existente.Cantidad += estado.cantidad;
    else estado.conceptos.push({
      TipoItem: 'Producto', ID_Servicio: null, ID_Producto: p.ID_Producto, ID_Membresia: null,
      ID_Barbero: null, NombreBarbero: null,
      NombreItem: p.NombreProducto, PrecioUnitario: Number(p.Precio), Cantidad: estado.cantidad
    });
    estado.cantidad = 1;
    dibujarConceptos();
  }

  /** Agrega la membresía elegida; requiere un cliente asociado. */
  function agregarMembresia() {
    var m = buscarPorId(estado.membresias, 'ID_Membresia', el.membresia.value);
    if (!m || !estado.cliente) return;
    estado.conceptos.push({
      TipoItem: 'Membresía', ID_Servicio: null, ID_Producto: null, ID_Membresia: m.ID_Membresia,
      ID_Barbero: null, NombreBarbero: null,
      NombreItem: m.NombrePlan, PrecioUnitario: Number(m.Precio), Cantidad: 1
    });
    dibujarConceptos();
  }

  /** Dibuja la lista de conceptos de la venta y recalcula los totales. */
  function dibujarConceptos() {
    var total = estado.conceptos.length;
    el.numeroConceptos.textContent = total + (total === 1 ? ' concepto' : ' conceptos');

    U.dibujarLista({
      contenedor: el.listaConceptos,
      plantilla: 'plantilla-concepto',
      vacio: el.conceptosVacio,
      datos: estado.conceptos.map(function (c) {
        return {
          NombreItem: c.NombreItem,
          CantidadTexto: c.Cantidad > 1 ? '× ' + c.Cantidad : '',
          TipoItem: c.TipoItem,
          DetalleTexto: c.NombreBarbero ? 'Barbero: ' + c.NombreBarbero : (c.TipoItem === 'Producto' ? 'Mostrador' : 'Cliente asociado'),
          Importe: c.PrecioUnitario * c.Cantidad
        };
      }),
      alCrear: function (fila, datos, indice) {
        fila.querySelector('[data-accion="quitar"]').addEventListener('click', function () {
          estado.conceptos.splice(indice, 1);
          dibujarConceptos();
        });
      }
    });
    actualizarControles();
    calcularTotales();
  }

  // ---------------------------------------------------------------------------
  // Totales y pago
  // ---------------------------------------------------------------------------

  /** @returns {{subtotal:number, descuento:number, total:number, iva:number, porcentaje:number}} */
  function totales() {
    var redondear = function (n) { return Math.round(n * 100) / 100; };
    var subtotal = estado.conceptos.reduce(function (s, c) { return s + c.PrecioUnitario * c.Cantidad; }, 0);
    var servicios = estado.conceptos
      .filter(function (c) { return c.TipoItem === 'Servicio'; })
      .reduce(function (s, c) { return s + c.PrecioUnitario * c.Cantidad; }, 0);
    var porcentaje = estado.cliente && estado.cliente.EstadoMembresia === 'Activa' ? Number(estado.cliente.DescuentoServicios) || 0 : 0;
    var descuento = redondear(servicios * porcentaje / 100);
    var total = redondear(subtotal - descuento);
    var iva = redondear(total - total / (1 + CFG.TASA_IVA));
    return { subtotal: subtotal, descuento: descuento, total: total, iva: iva, porcentaje: porcentaje };
  }

  /** Muestra subtotal, descuento, IVA, total y cambio (vista previa; el servidor recalcula). */
  function calcularTotales() {
    var t = totales();
    el.totalSubtotal.textContent = U.formatoMoneda(t.subtotal);
    el.lineaDescuento.hidden = !t.descuento;
    el.textoDescuento.textContent = 'Descuento membresía (' + t.porcentaje + ' % en servicios)';
    el.totalDescuento.textContent = '−' + U.formatoMoneda(t.descuento);
    el.totalIva.textContent = U.formatoMoneda(t.iva);
    el.totalFinal.textContent = U.formatoMoneda(t.total);

    var efectivo = estado.metodo === 'Efectivo';
    var recibido = Number(el.montoRecibido.value) || 0;
    var cambio = recibido - t.total;
    el.datosEfectivo.hidden = !efectivo;
    el.cambio.textContent = recibido ? U.formatoMoneda(cambio) : U.formatoMoneda(0);
    el.cambio.className = 'numeros font-bold text-lg ' + (cambio < 0 && recibido ? 'texto-error' : 'texto-exito');

    el.cobrar.disabled = !estado.conceptos.length || (efectivo && recibido < t.total);
  }

  /** @param {'Efectivo'|'Transferencia'|'Tarjeta'} metodo */
  function elegirMetodo(metodo) {
    estado.metodo = metodo;
    document.querySelectorAll('.metodo-pago').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-metodo') === metodo));
    });
    calcularTotales();
  }

  /** Envía la venta al servidor y abre el ticket. */
  async function cobrar() {
    var t = totales();
    var datos = {
      ID_Cliente: estado.cliente ? estado.cliente.ID_Cliente : null,
      MetodoPago: estado.metodo,
      MontoRecibido: estado.metodo === 'Efectivo' ? Number(el.montoRecibido.value) : null,
      TotalEsperado: t.total,     // el servidor lo compara con su propio cálculo
      Detalle: estado.conceptos.map(function (c) {
        return {
          TipoItem: c.TipoItem, ID_Servicio: c.ID_Servicio, ID_Producto: c.ID_Producto,
          ID_Membresia: c.ID_Membresia, ID_Barbero: c.ID_Barbero, Cantidad: c.Cantidad
        };
      })
    };
    try {
      var venta = await U.conCarga(el.cobrar, Api.ventas.crear(datos));
      if (venta && venta.ID_Venta) {
        window.location.href = 'ticket-digital.html?venta=' + encodeURIComponent(venta.ID_Venta);
      }
    } catch (error) {
      U.aviso(error.message, 'error');
      if (error.estado === 409) cargarCatalogos();   // existencias cambiaron: se recargan
    }
  }

  /** Descarta la venta en curso previa confirmación. */
  async function cancelarVenta() {
    if (estado.conceptos.length && !(await U.confirmar('¿Cancelar la venta en curso?'))) return;
    estado.conceptos = [];
    estado.cantidad = 1;
    el.montoRecibido.value = '';
    elegirCliente(null);
    elegirMetodo('Efectivo');
  }

  // ---- Arranque ---------------------------------------------------------------
  el.buscarCliente.addEventListener('input', buscarClientes);
  el.cambiarCliente.addEventListener('click', function () { elegirCliente(null); });
  document.querySelectorAll('[data-pestana]').forEach(function (b) {
    b.addEventListener('click', function () { cambiarPestana(b.getAttribute('data-pestana')); });
  });
  [el.servicio, el.barbero, el.membresia].forEach(function (s) { s.addEventListener('change', actualizarControles); });
  el.producto.addEventListener('change', function () { estado.cantidad = 1; actualizarControles(); });
  el.cantidadMenos.addEventListener('click', function () { estado.cantidad = Math.max(1, estado.cantidad - 1); actualizarControles(); });
  el.cantidadMas.addEventListener('click', function () { estado.cantidad += 1; actualizarControles(); });
  el.agregarServicio.addEventListener('click', agregarServicio);
  el.agregarProducto.addEventListener('click', agregarProducto);
  el.agregarMembresia.addEventListener('click', agregarMembresia);
  document.querySelectorAll('.metodo-pago').forEach(function (b) {
    b.addEventListener('click', function () { elegirMetodo(b.getAttribute('data-metodo')); });
  });
  el.montoRecibido.addEventListener('input', calcularTotales);
  el.cobrar.addEventListener('click', cobrar);
  el.cancelarVenta.addEventListener('click', cancelarVenta);

  dibujarConceptos();
  cargarCatalogos();
  clienteDesdeURL();
})();
