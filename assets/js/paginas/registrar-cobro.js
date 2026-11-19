/**
 * @file paginas/registrar-cobro.js
 * @description Controlador de «Registrar cobro» (registrar-cobro.html).
 *
 * Flujo (diagrama de secuencia 3.1.2):
 *   1. Carga catálogos: servicios, productos, membresías y barberos.
 *   2. Cliente: buscador con vista previa, «Cliente 0» o cliente nuevo.
 *      Al elegirlo se agregan sus citas atendidas sin pagar.  GET /clientes/:id/pendientes
 *   3. Cada cambio en la venta pide los importes al servidor.  POST /ventas/calcular
 *      (beneficios de membresía, descuentos, vencimiento, existencias).
 *   4. Cobrar → POST /ventas → ticket-digital.html?venta=ID
 *
 * La lista local `carrito` guarda lo que se va a vender; el servidor devuelve
 * los renglones calculados en el mismo orden.
 */
(function () {
  'use strict';

  if (!window.Sesion.permitida) return;

  var U = window.Utilidades;
  var Api = window.Api;
  var t = window.Idioma.t;

  var estado = {
    servicios: [], productos: [], membresias: [], barberos: [],
    cliente: null,          // Cliente elegido
    clienteCero: false,     // true = «Cliente 0»
    carrito: [],            // [{ TipoItem, ID_Servicio, ID_Barbero, ID_Cita, ID_Producto, Cantidad, ID_Membresia }]
    calculo: null,          // Respuesta de POST /ventas/calcular
    membresiaCliente: null, // GET /clientes/:id/membresia (beneficios que aplican hoy)
    metodo: 'Efectivo',
    pestana: 'servicio',
    consulta: 0
  };

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    buscador: $('buscador'), clienteElegido: $('cliente-elegido'), clienteAvatar: $('cliente-avatar'),
    clienteNombre: $('cliente-nombre'), clienteTelefono: $('cliente-telefono'), clienteMembresia: $('cliente-membresia'),
    cambiarCliente: $('cambiar-cliente'),
    servicio: $('servicio'), barbero: $('barbero'), agregarServicio: $('agregar-servicio'),
    listaProductos: $('lista-productos'), productosVacio: $('productos-vacio'),
    listaMembresias: $('lista-membresias'), membresiasVacio: $('membresias-vacio'), ayudaMembresia: $('ayuda-membresia'),
    numeroConceptos: $('numero-conceptos'), conceptosVacio: $('conceptos-vacio'), calculando: $('calculando'),
    listaConceptos: $('lista-conceptos'),
    totalSubtotal: $('total-subtotal'), lineaDescuento: $('linea-descuento'), totalDescuento: $('total-descuento'),
    totalFinal: $('total-final'), venceMembresia: $('vence-membresia'),
    beneficiosCliente: $('beneficios-cliente'), beneficiosTitulo: $('beneficios-cliente-titulo'), beneficiosLista: $('beneficios-cliente-lista'),
    datosEfectivo: $('datos-efectivo'), montoRecibido: $('monto-recibido'), cambio: $('cambio'),
    cobrar: $('cobrar'), cancelarVenta: $('cancelar-venta')
  };

  // ---------------------------------------------------------------------------
  // Catálogos
  // ---------------------------------------------------------------------------

  /** Carga los catálogos en paralelo; si uno falla, los demás siguen funcionando. */
  async function cargarCatalogos() {
    var r = await Promise.allSettled([
      Api.catalogos.servicios(), Api.catalogos.productos(), Api.catalogos.membresias(), Api.barberos.listar()
    ]);
    var valor = function (i) { return r[i].status === 'fulfilled' ? (r[i].value || []) : []; };
    r.forEach(function (x) { if (x.status === 'rejected') U.aviso(x.reason.message, 'error'); });
    estado.servicios = valor(0);
    estado.productos = valor(1);
    estado.membresias = valor(2);
    estado.barberos = valor(3);

    U.llenarSelect(el.servicio, estado.servicios, function (s) { return s.NombreServicio + ' — ' + U.formatoMoneda(s.Precio); },
      'ID_Servicio', estado.servicios.length ? 'Selecciona un servicio' : 'No hay servicios registrados');
    U.llenarSelect(el.barbero, estado.barberos, function (b) { return b.Nombre; }, 'ID_Barbero',
      estado.barberos.length ? 'Selecciona al barbero' : 'No hay barberos registrados');
    dibujarProductos();
    dibujarMembresias();
    validarServicio();
  }

  /** Promociones vigentes (se aplican solas; aquí solo se le recuerdan al cajero).  GET /descuentos?vigentes=1 */
  async function cargarPromociones() {
    var lista = [];
    try { lista = (await Api.descuentos.listar(true)) || []; } catch (e) { lista = []; }
    var ul = document.getElementById('lista-promociones');
    ul.replaceChildren();
    lista.forEach(function (d) {
      var li = document.createElement('li');
      var nombre = document.createElement('span');
      nombre.className = 'font-semibold text-white'; nombre.setAttribute('translate', 'no'); nombre.textContent = d.Nombre;
      li.append(nombre, document.createTextNode(' · −' + U.valorDescuento(d) + ' · ' + U.alcanceDescuento(d)));
      if (d.Descripcion) li.title = d.Descripcion;
      ul.appendChild(li);
    });
    document.getElementById('promociones').hidden = !lista.length;
  }

  function validarServicio() { el.agregarServicio.disabled = !(el.servicio.value && el.barbero.value); }

  /** Piezas de un producto que ya están en la venta. */
  function enCarrito(idProducto) {
    return estado.carrito.filter(function (c) { return c.ID_Producto === idProducto; })
      .reduce(function (s, c) { return s + c.Cantidad; }, 0);
  }

  /** Tarjetas de productos con precio, existencias y botón para agregar. */
  function dibujarProductos() {
    U.dibujarLista({
      contenedor: el.listaProductos, plantilla: 'plantilla-producto', datos: estado.productos, vacio: el.productosVacio,
      alCrear: function (tarjeta, p) {
        var disponibles = p.Stock - enCarrito(p.ID_Producto);
        var cantidad = 1;
        var salida = tarjeta.querySelector('output');
        tarjeta.querySelector('[data-existencias]').textContent = disponibles > 0
          ? t('Existencias: {n}', { n: disponibles }) : t('Sin existencias');
        tarjeta.classList.toggle('articulo--agotado', disponibles <= 0);
        var agregar = tarjeta.querySelector('[data-accion="agregar"]');
        agregar.disabled = disponibles <= 0;
        tarjeta.querySelector('[data-accion="menos"]').addEventListener('click', function () { cantidad = Math.max(1, cantidad - 1); salida.value = cantidad; });
        tarjeta.querySelector('[data-accion="mas"]').addEventListener('click', function () { cantidad = Math.min(Math.max(1, disponibles), cantidad + 1); salida.value = cantidad; });
        agregar.addEventListener('click', function () { agregarProducto(p, cantidad); });
      }
    });
    el.listaProductos.hidden = !estado.productos.length;
  }

  /** Beneficios de una membresía tal como aparecen en el cartel. */
  function textoBeneficios(m) {
    var lista = (m.Beneficios || []).map(function (b) { return { texto: U.textoBeneficio(b), regla: U.reglaBeneficio(b) }; });
    return lista.length ? lista : [{ texto: t('Sin beneficios configurados'), regla: '' }];
  }

  function dibujarMembresias() {
    U.dibujarLista({
      contenedor: el.listaMembresias, plantilla: 'plantilla-membresia', datos: estado.membresias, vacio: el.membresiasVacio,
      alCrear: function (tarjeta, m) {
        var ul = tarjeta.querySelector('[data-beneficios]');
        ul.setAttribute('translate', 'no');
        textoBeneficios(m).forEach(function (x) {
          var li = document.createElement('li');
          li.textContent = x.texto;
          if (x.regla && x.regla !== x.texto) li.title = x.regla;
          ul.appendChild(li);
        });
        var boton = tarjeta.querySelector('[data-accion="agregar"]');
        boton.disabled = !estado.cliente;
        boton.addEventListener('click', function () { agregarMembresia(m); });
      }
    });
    el.listaMembresias.hidden = !estado.membresias.length;
    el.ayudaMembresia.hidden = !!estado.cliente;
  }

  // ---------------------------------------------------------------------------
  // Cliente
  // ---------------------------------------------------------------------------

  /**
   * Asocia la venta a un cliente (o a Cliente 0) y agrega sus pendientes de pago.
   * @param {Object|null} cliente  null = Cliente 0
   */
  async function elegirCliente(cliente) {
    estado.cliente = cliente;
    estado.clienteCero = !cliente;
    // Se quitan los pendientes del cliente anterior y, con Cliente 0, las membresías.
    estado.carrito = estado.carrito.filter(function (c) { return !c.ID_Cita && !(c.TipoItem === 'Membresía' && !cliente); });

    el.buscador.hidden = true;
    el.clienteElegido.hidden = false;
    el.clienteNombre.textContent = cliente ? cliente.Nombre : t('Cliente 0');
    el.clienteNombre.classList.toggle('texto-membresia', !!(cliente && cliente.MembresiaActiva));
    el.clienteAvatar.textContent = cliente ? U.iniciales(cliente.Nombre) : '0';
    U.ponerFotoAvatar(el.clienteAvatar, cliente && cliente.FotoCorteReferencia, cliente ? cliente.Nombre : '');
    el.clienteTelefono.textContent = cliente ? U.formatoTelefono(cliente.Telefono) : t('Público en general · sin datos en el ticket');
    el.clienteMembresia.replaceChildren();
    if (cliente) {
      var insignia = document.createElement('span');
      insignia.className = 'insignia ' + (cliente.MembresiaActiva ? 'insignia--oro' : '');
      insignia.textContent = cliente.MembresiaActiva
        ? t('Membresía') + ' ' + (cliente.NombrePlan || '') + ' · ' + t('vence') + ' ' + U.formatoFecha(cliente.FechaVencimiento)
        : t('Sin membresía');
      el.clienteMembresia.appendChild(insignia);
    }
    dibujarMembresias();

    // Beneficios de su membresía, visibles desde que se elige al cliente.
    estado.membresiaCliente = null;
    if (cliente && cliente.MembresiaActiva) {
      try { estado.membresiaCliente = await Api.clientes.membresia(cliente.ID_Cliente); }
      catch (error) { /* se verán al calcular */ }
    }
    dibujarBeneficios(estado.calculo && estado.calculo.Membresia);

    if (cliente) {
      try {
        var pendientes = (await Api.clientes.pendientes(cliente.ID_Cliente)) || [];
        pendientes.forEach(function (p) {
          estado.carrito.unshift({ TipoItem: 'Servicio', ID_Cita: p.ID_Cita, ID_Servicio: p.ID_Servicio, ID_Barbero: p.ID_Barbero });
        });
        if (pendientes.length) {
          U.aviso(pendientes.length === 1 ? t('Se agregó 1 servicio pendiente de pago.') : t('Se agregaron {n} servicios pendientes de pago.', { n: pendientes.length }), 'info');
        }
      } catch (error) { U.aviso(error.message, 'error'); }
    }
    calcular();
  }

  function quitarCliente() {
    estado.cliente = null;
    estado.clienteCero = false;
    estado.carrito = estado.carrito.filter(function (c) { return !c.ID_Cita && c.TipoItem !== 'Membresía'; });
    el.clienteElegido.hidden = true;
    el.buscador.hidden = false;
    el.buscador.limpiar();
    el.buscador.enfocar();
    dibujarMembresias();
    calcular();
  }

  async function clienteDesdeURL() {
    var id = U.parametro('cliente');
    if (!id) return;
    try { await elegirCliente(await Api.clientes.obtener(id)); } catch (error) { U.aviso(error.message, 'error'); }
  }

  // ---------------------------------------------------------------------------
  // Agregar y quitar conceptos
  // ---------------------------------------------------------------------------

  function agregarServicio() {
    estado.carrito.push({ TipoItem: 'Servicio', ID_Servicio: Number(el.servicio.value), ID_Barbero: Number(el.barbero.value) });
    el.servicio.value = '';
    validarServicio();
    calcular();
  }

  /** Suma la cantidad si el producto ya estaba en la venta. */
  function agregarProducto(producto, cantidad) {
    var existente = estado.carrito.find(function (c) { return c.ID_Producto === producto.ID_Producto; });
    if (existente) existente.Cantidad += cantidad;
    else estado.carrito.push({ TipoItem: 'Producto', ID_Producto: producto.ID_Producto, Cantidad: cantidad });
    calcular();
  }

  function agregarMembresia(m) {
    if (!estado.cliente) { U.aviso('Selecciona primero al cliente: la membresía no se puede vender a Cliente 0.', 'error'); return; }
    estado.carrito = estado.carrito.filter(function (c) { return c.TipoItem !== 'Membresía'; });
    estado.carrito.push({ TipoItem: 'Membresía', ID_Membresia: m.ID_Membresia });
    U.aviso('Los beneficios de la membresía se aplican en esta misma venta.', 'info');
    calcular();
  }

  function quitar(indice) {
    estado.carrito.splice(indice, 1);
    calcular();
  }

  // ---------------------------------------------------------------------------
  // Cálculo en el servidor y resumen
  // ---------------------------------------------------------------------------

  /** Pide los importes al servidor.  POST /ventas/calcular */
  var calcular = U.retrasar(async function () {
    var numero = ++estado.consulta;
    if (!estado.carrito.length) { estado.calculo = null; dibujarResumen(); return; }
    el.calculando.hidden = false;
    try {
      var calculo = await Api.ventas.calcular({ ID_Cliente: estado.cliente ? estado.cliente.ID_Cliente : null, Detalle: estado.carrito });
      if (numero !== estado.consulta) return;
      estado.calculo = calculo;
    } catch (error) {
      if (numero !== estado.consulta) return;
      U.aviso(error.message, 'error');
      // El último concepto provocó el error (ej. sin existencias): se retira.
      estado.carrito.pop();
      estado.calculo = null;
      if (estado.carrito.length) { el.calculando.hidden = true; calcular(); return; }
    }
    el.calculando.hidden = true;
    dibujarResumen();
  }, 150);

  /** Dibuja los renglones calculados, los totales y el botón de cobro. */
  function dibujarResumen() {
    var c = estado.calculo;
    var lineas = c ? c.Lineas : [];
    U.dibujarLista({
      contenedor: el.listaConceptos, plantilla: 'plantilla-concepto', vacio: el.conceptosVacio,
      datos: lineas.map(function (l) {
        var detalle = l.TipoItem === 'Servicio' ? t('Barbero') + ': ' + l.NombreBarbero
          : l.TipoItem === 'Producto' ? t('Producto') + ' · ' + U.formatoMoneda(l.PrecioUnitario) + ' c/u'
          : t('Vence') + ': ' + U.formatoFecha(l.VenceMembresia);
        return Object.assign({}, l, {
          CantidadTexto: l.Cantidad > 1 ? '× ' + l.Cantidad : '',
          Detalle: detalle,
          Bruto: l.PrecioUnitario * l.Cantidad
        });
      }),
      alCrear: function (li, l, i) {
        li.querySelector('[data-campo="NombreItem"]').setAttribute('translate', 'no');
        if (l.Descuento > 0) li.querySelector('.precio-normal').hidden = false;
        if (l.Beneficio && !l.UsaBeneficio && l.Descuento === 0) li.querySelector('.concepto__beneficio').classList.add('concepto__beneficio--limite');
        if (l.Beneficio && l.Descuento > 0) {
          li.querySelector('.concepto__beneficio').textContent = t(l.Beneficio) + ' · −' + U.formatoMoneda(l.Descuento);
        }
        var quitarBoton = li.querySelector('[data-accion="quitar"]');
        if (l.Pendiente) {
          li.classList.add('concepto--pendiente');
          quitarBoton.remove();
          li.querySelector('[data-pendiente]').hidden = false;
        } else {
          // Un producto puede venir en dos renglones (ej. 1 gratis + 1 con descuento): Indice es su concepto.
          quitarBoton.addEventListener('click', function () { quitar(l.Indice != null ? l.Indice : i); });
        }
      }
    });

    var total = c ? c.Total : 0;
    var conceptos = c ? estado.carrito.length : 0;
    el.numeroConceptos.textContent = conceptos === 1 ? t('1 concepto') : t('{n} conceptos', { n: conceptos });
    el.totalSubtotal.textContent = U.formatoMoneda(c ? c.Subtotal : 0);
    el.lineaDescuento.hidden = !(c && c.Descuento > 0);
    el.totalDescuento.textContent = '−' + U.formatoMoneda(c ? c.Descuento : 0);
    el.totalFinal.textContent = U.formatoMoneda(total);
    var m = c && c.Membresia;
    el.venceMembresia.hidden = !(m && m.VenceNueva);
    if (m && m.VenceNueva) {
      el.venceMembresia.textContent = t('Membresía {plan}: vence el {fecha}', { plan: m.NombrePlan, fecha: U.formatoFecha(m.VenceNueva) }) +
        (m.Renovacion ? ' · ' + t('se suma a la fecha actual') : '');
    }
    dibujarBeneficios(m);
    dibujarProductos();
    actualizarCambio();
  }

  var SVG_PALOMITA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

  /** Beneficios de la membresía que se aplica (la vigente o la que se compra). */
  function dibujarBeneficios(m) {
    m = m || (estado.cliente ? estado.membresiaCliente : null);
    var lista = m && m.Beneficios ? m.Beneficios : null;
    el.beneficiosCliente.hidden = !(estado.cliente && m);
    if (el.beneficiosCliente.hidden) return;
    el.beneficiosTitulo.textContent = t('Beneficios de la membresía {plan}', { plan: m.NombrePlan });
    el.beneficiosLista.replaceChildren();
    (lista && lista.length ? lista : [{ Aplica: 'Texto', Etiqueta: t('Sin beneficios configurados') }]).forEach(function (b) {
      var li = document.createElement('li');
      li.innerHTML = SVG_PALOMITA;
      var cuerpo = document.createElement('span');
      var texto = document.createElement('span');
      texto.className = 'lista-beneficios__texto';
      texto.textContent = U.textoBeneficio(b);
      cuerpo.appendChild(texto);
      if (b.Etiqueta && b.Aplica !== 'Texto') {
        var regla = document.createElement('span');
        regla.className = 'lista-beneficios__regla';
        regla.textContent = U.reglaBeneficio(b);
        cuerpo.appendChild(regla);
      }
      li.appendChild(cuerpo);
      el.beneficiosLista.appendChild(li);
    });
  }

  // ---------------------------------------------------------------------------
  // Pago
  // ---------------------------------------------------------------------------

  function elegirMetodo(metodo) {
    estado.metodo = metodo;
    document.querySelectorAll('.metodo-pago').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-metodo') === metodo)); });
    el.datosEfectivo.hidden = metodo !== 'Efectivo';
    actualizarCambio();
  }

  function actualizarCambio() {
    var total = estado.calculo ? estado.calculo.Total : 0;
    var recibido = Number(el.montoRecibido.value) || 0;
    var cambio = recibido - total;
    el.cambio.textContent = U.formatoMoneda(Math.max(0, cambio));
    el.cambio.classList.toggle('texto-error', estado.metodo === 'Efectivo' && el.montoRecibido.value !== '' && cambio < 0);
    var listo = !!(estado.calculo && estado.carrito.length && (estado.cliente || estado.clienteCero));
    // Con total $0 (todo cubierto por la membresía) no hace falta capturar efectivo.
    if (estado.metodo === 'Efectivo' && total > 0.009) listo = listo && el.montoRecibido.value !== '' && cambio >= -0.009;
    el.cobrar.disabled = !listo;
  }

  /** Registra la venta y abre el ticket.  POST /ventas */
  async function cobrar() {
    if (!estado.cliente && !estado.clienteCero) { U.aviso('Elige al cliente o «Cliente 0».', 'error'); return; }
    try {
      var venta = await U.conCarga(el.cobrar, Api.ventas.crear({
        ID_Cliente: estado.cliente ? estado.cliente.ID_Cliente : null,
        MetodoPago: estado.metodo,
        MontoRecibido: estado.metodo === 'Efectivo' ? Number(el.montoRecibido.value) || 0 : null,
        TotalEsperado: estado.calculo.Total,
        Detalle: estado.carrito
      }));
      window.location.href = 'ticket-digital.html?venta=' + encodeURIComponent(venta.ID_Venta) + '&nueva=1';
    } catch (error) {
      U.aviso(error.message, 'error');
      if (error.estado === 409 || error.estado === 400) calcular();
    }
  }

  async function cancelarVenta() {
    if (!estado.carrito.length && !estado.cliente && !estado.clienteCero) return;
    if (!(await U.confirmar('¿Cancelar la venta en curso? Se quitarán todos los conceptos.'))) return;
    estado.carrito = [];
    el.montoRecibido.value = '';
    quitarCliente();
  }

  // ---------------------------------------------------------------------------
  // Pestañas y arranque
  // ---------------------------------------------------------------------------

  function elegirPestana(nombre) {
    estado.pestana = nombre;
    document.querySelectorAll('[data-pestana]').forEach(function (b) {
      var activa = b.getAttribute('data-pestana') === nombre;
      b.setAttribute('aria-selected', String(activa));
      $('panel-' + b.getAttribute('data-pestana')).hidden = !activa;
    });
  }

  document.querySelectorAll('[data-pestana]').forEach(function (b) {
    b.addEventListener('click', function () { elegirPestana(b.getAttribute('data-pestana')); });
  });
  document.querySelectorAll('.metodo-pago').forEach(function (b) {
    b.addEventListener('click', function () { elegirMetodo(b.getAttribute('data-metodo')); });
  });
  el.buscador.addEventListener('cliente:elegido', function (e) { elegirCliente(e.detail.cliente); });
  el.cambiarCliente.addEventListener('click', quitarCliente);
  el.servicio.addEventListener('change', validarServicio);
  el.barbero.addEventListener('change', validarServicio);
  el.agregarServicio.addEventListener('click', agregarServicio);
  el.montoRecibido.addEventListener('input', actualizarCambio);
  el.cobrar.addEventListener('click', cobrar);
  el.cancelarVenta.addEventListener('click', cancelarVenta);

  dibujarResumen();
  cargarCatalogos().then(clienteDesdeURL);
  cargarPromociones();
  // Precios, existencias o promociones cambiados desde otro equipo: se actualizan sin perder la venta.
  Api.alCambiar(['catalogo'], function () {
    var servicio = el.servicio.value, barbero = el.barbero.value;
    cargarCatalogos().then(function () {
      el.servicio.value = servicio; el.barbero.value = barbero; validarServicio();
      if (estado.carrito.length) calcular();
    });
    cargarPromociones();
  });
})();
