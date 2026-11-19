/**
 * @file paginas/ajustes.js
 * @description Controlador de «Ajustes» (ajustes.html). El menú numerado
 * (componentes/menu-ajustes.js) muestra solo las secciones del rol; cada una
 * se abre con el hash de la URL (ajustes.html#impresora). En teléfono se ve
 * primero el menú y, al elegir, la sección con el botón «‹ Ajustes del sistema».
 *
 * Secciones y endpoints:
 *   servicios   D     GET/POST/PUT/DELETE /servicios
 *   productos   D C   GET /productos · POST/PUT/DELETE (D) · POST /:id/entrada ·
 *                     POST /:id/baja { Cantidad, Motivo, Contrasena } · GET /:id/movimientos
 *   membresias  D     GET/POST/PUT/DELETE /membresias  (Beneficios[]: servicio, producto,
 *                     categoría, todos los productos o texto; por visita o por mes)
 *   cuentas     D     GET/POST /cuentas · PUT /cuentas/:rol/:id/contrasena · DELETE /cuentas/:rol/:id
 *   negocio     D     GET/PUT /establecimiento
 *   impresora   D C   Se guarda en el equipo (impresora.js)
 *   whatsapp    D     GET/PUT /ajustes/whatsapp · POST /ajustes/whatsapp/prueba
 *   idioma      todos Idioma.cambiar(codigo)
 *   servidor    todos Dirección del back end guardada en el equipo
 */
(function () {
  'use strict';

  if (!window.Sesion.permitida) return;

  var U = window.Utilidades;
  var Api = window.Api;
  var Sesion = window.Sesion;
  var CFG = window.APP_CONFIG;
  var t = window.Idioma.t;
  var rol = Sesion.rol();
  var esDueno = rol === Sesion.ROLES.DUENO;

  var $ = function (id) { return document.getElementById(id); };
  var DIAS = [['L', 'Lunes'], ['M', 'Martes'], ['X', 'Miércoles'], ['J', 'Jueves'], ['V', 'Viernes'], ['S', 'Sábado'], ['D', 'Domingo']];

  /** Secciones ya cargadas (se cargan la primera vez que se abren). */
  var cargadas = {};

  // ===========================================================================
  // Navegación entre secciones
  // ===========================================================================

  /** Oculta todo lo que no corresponde al rol. */
  function aplicarRoles(raiz) {
    (raiz || document).querySelectorAll('[data-roles]').forEach(function (n) {
      if (n.getAttribute('data-roles').split(',').indexOf(rol) === -1) { n.hidden = true; n.setAttribute('data-oculto-rol', ''); }
    });
  }

  var contenedor = $('ajustes');
  var menu = $('menu-ajustes');
  var pantallaGrande = window.matchMedia('(min-width: 1024px)');

  /** Secciones del rol, en orden (las define menu-ajustes.js). */
  function seccionesVisibles() {
    return window.MenuAjustes ? window.MenuAjustes.secciones()
      : Array.prototype.map.call(document.querySelectorAll('[data-seccion]'), function (x) { return x.getAttribute('data-seccion'); });
  }

  /**
   * Muestra una sección. Sin sección válida: en computadora se abre la
   * primera; en teléfono se queda el menú.
   * @param {string} nombre
   */
  function abrirSeccion(nombre) {
    var visibles = seccionesVisibles();
    if (visibles.indexOf(nombre) === -1) {
      if (!pantallaGrande.matches) {
        contenedor.setAttribute('data-vista', 'menu');
        if (menu.marcar) menu.marcar(null);
        document.querySelectorAll('[data-seccion]').forEach(function (x) { x.hidden = true; });
        return;
      }
      nombre = visibles[0];
    }
    var cambio = contenedor.getAttribute('data-vista') !== 'seccion';
    contenedor.setAttribute('data-vista', 'seccion');
    if (menu.marcar) menu.marcar(nombre);
    document.querySelectorAll('[data-seccion]').forEach(function (x) { x.hidden = x.getAttribute('data-seccion') !== nombre; });
    if (window.location.hash !== '#' + nombre) history.replaceState(null, '', '#' + nombre);
    if (!cargadas[nombre] && CARGAR[nombre]) { cargadas[nombre] = true; CARGAR[nombre](); }
    if (cambio && !pantallaGrande.matches) window.scrollTo(0, 0);
  }

  /** «‹ Ajustes del sistema» (teléfono): vuelve al menú. */
  function volverAlMenu() {
    history.replaceState(null, '', window.location.pathname + window.location.search);
    abrirSeccion('');
    window.scrollTo(0, 0);
  }

  // ===========================================================================
  // Utilidades de esta pantalla
  // ===========================================================================

  function abrirModal(modal) { modal.hidden = false; var f = modal.querySelector('input:not([type=hidden]),button[type=submit]'); if (f) f.focus(); }
  function cerrarModales() { document.querySelectorAll('.modal').forEach(function (m) { m.hidden = true; }); }

  /** Duración legible: 90 → "1 h 30 min". */
  function textoDuracion(min) {
    min = Number(min) || 0;
    var h = Math.floor(min / 60);
    var m = min % 60;
    return h ? (h + ' h' + (m ? ' ' + m + ' min' : '')) : m + ' min';
  }

  /** "L,X,V" → "Lunes, Miércoles, Viernes" (vacío = todos los días). */
  function textoDias(lista) {
    if (!lista) return t('Todos los días');
    var letras = String(lista).split(',');
    return DIAS.filter(function (d) { return letras.indexOf(d[0]) !== -1; }).map(function (d) { return t(d[1]).slice(0, 3); }).join(', ');
  }

  /** Dibuja las casillas de días de la semana dentro de un contenedor. */
  function dibujarCasillasDias(contenedor) {
    contenedor.replaceChildren();
    DIAS.forEach(function (d) {
      var etiqueta = document.createElement('label');
      etiqueta.title = t(d[1]);
      var casilla = document.createElement('input');
      casilla.type = 'checkbox';
      casilla.value = d[0];
      casilla.setAttribute('aria-label', t(d[1]));
      var letra = document.createElement('span');
      letra.textContent = d[0];
      letra.setAttribute('translate', 'no');
      etiqueta.append(casilla, letra);
      contenedor.appendChild(etiqueta);
    });
  }

  function leerDias(contenedor) {
    return Array.prototype.filter.call(contenedor.querySelectorAll('input'), function (c) { return c.checked; }).map(function (c) { return c.value; });
  }

  function marcarDias(contenedor, lista) {
    var letras = String(lista || '').split(',');
    contenedor.querySelectorAll('input').forEach(function (c) { c.checked = letras.indexOf(c.value) !== -1; });
  }

  /** Pone el formulario en modo «nuevo» o «editar». */
  function modoFormulario(formulario, editando, tituloNuevo, tituloEditar) {
    formulario.querySelector('[data-titulo-formulario]').textContent = t(editando ? tituloEditar : tituloNuevo);
    var cancelar = formulario.querySelector('[id$="-cancelar"]');
    if (cancelar) cancelar.hidden = !editando;
  }

  // ===========================================================================
  // Servicios
  // ===========================================================================

  var servicio = {
    formulario: $('formulario-servicio'), nombre: $('servicio-nombre'), precio: $('servicio-precio'),
    duracion: $('servicio-duracion'), dias: $('servicio-dias'), descripcion: $('servicio-descripcion'),
    guardar: $('servicio-guardar'), cancelar: $('servicio-cancelar'),
    total: $('servicios-total'), vacio: $('servicios-vacio'), tabla: $('servicios-tabla'), filas: $('servicios-filas'),
    lista: [], editando: null
  };

  async function cargarServicios() {
    try { servicio.lista = (await Api.catalogos.servicios()) || []; }
    catch (error) { servicio.lista = []; U.aviso(error.message, 'error'); }
    servicio.total.textContent = t(servicio.lista.length === 1 ? '{n} servicio' : '{n} servicios', { n: servicio.lista.length });
    U.dibujarLista({
      contenedor: servicio.filas, plantilla: 'plantilla-servicio', vacio: servicio.vacio,
      datos: servicio.lista.map(function (s) { return Object.assign({}, s, { Duracion: textoDuracion(s.DuracionMin), Dias: textoDias(s.DiasDisponibles) }); }),
      alCrear: function (fila, s) {
        fila.querySelector('[data-campo="NombreServicio"]').setAttribute('translate', 'no');
        fila.querySelector('[data-campo="Descripcion"]').setAttribute('translate', 'no');
        fila.querySelector('[data-campo="Dias"]').setAttribute('translate', 'no');
        fila.querySelector('[data-accion="editar"]').addEventListener('click', function () { editarServicio(s); });
        fila.querySelector('[data-accion="eliminar"]').addEventListener('click', function (e) { eliminarServicio(s, e.currentTarget); });
      }
    });
    servicio.tabla.hidden = !servicio.lista.length;
    servicio.filas.hidden = false;
  }

  function limpiarServicio() {
    servicio.editando = null;
    servicio.formulario.reset();
    servicio.duracion.value = '30';
    marcarDias(servicio.dias, '');
    modoFormulario(servicio.formulario, false, 'Nuevo servicio', 'Editar servicio');
  }

  function editarServicio(s) {
    servicio.editando = s;
    servicio.nombre.value = s.NombreServicio;
    servicio.precio.value = s.Precio;
    if (!servicio.duracion.querySelector('option[value="' + s.DuracionMin + '"]')) {
      var op = document.createElement('option');
      op.value = s.DuracionMin; op.textContent = textoDuracion(s.DuracionMin);
      servicio.duracion.appendChild(op);
    }
    servicio.duracion.value = String(s.DuracionMin);
    servicio.descripcion.value = s.Descripcion || '';
    marcarDias(servicio.dias, s.DiasDisponibles);
    modoFormulario(servicio.formulario, true, 'Nuevo servicio', 'Editar servicio');
    servicio.formulario.scrollIntoView({ behavior: 'smooth', block: 'start' });
    servicio.nombre.focus();
  }

  async function guardarServicio(e) {
    e.preventDefault();
    if (servicio.nombre.value.trim().length < 2) { U.aviso('Escribe el nombre del servicio.', 'error'); servicio.nombre.focus(); return; }
    if (servicio.precio.value === '' || Number(servicio.precio.value) < 0) { U.aviso('Escribe un precio válido.', 'error'); servicio.precio.focus(); return; }
    var datos = {
      NombreServicio: servicio.nombre.value.trim(), Precio: Number(servicio.precio.value),
      DuracionMin: Number(servicio.duracion.value), DiasDisponibles: leerDias(servicio.dias).join(',') || null,
      Descripcion: servicio.descripcion.value.trim()
    };
    try {
      await U.conCarga(servicio.guardar, servicio.editando
        ? Api.servicios.actualizar(servicio.editando.ID_Servicio, datos) : Api.servicios.crear(datos));
      U.aviso(servicio.editando ? 'Servicio actualizado.' : 'Servicio creado.');
      limpiarServicio();
      cargarServicios();
      cargadas.membresias = false; cargadas.descuentos = false;   // los beneficios dependen de los servicios
    } catch (error) { U.aviso(error.message, 'error'); }
  }

  async function eliminarServicio(s, boton) {
    if (!(await U.confirmar(t('¿Eliminar el servicio «{nombre}»? Ya no aparecerá en agenda ni en caja, y se quitará de los beneficios de las membresías.', { nombre: s.NombreServicio })))) return;
    try {
      await U.conCarga(boton, Api.servicios.eliminar(s.ID_Servicio));
      U.aviso('Servicio eliminado.');
      if (servicio.editando && servicio.editando.ID_Servicio === s.ID_Servicio) limpiarServicio();
      cargarServicios();
      cargadas.membresias = false; cargadas.descuentos = false;
    } catch (error) { U.aviso(error.message, 'error'); }
  }

  // ===========================================================================
  // Productos e inventario
  // ===========================================================================

  var producto = {
    formulario: $('formulario-producto'), nombre: $('producto-nombre'), precio: $('producto-precio'),
    categoria: $('producto-categoria'), stock: $('producto-stock'), stockBloque: $('producto-stock-bloque'), descripcion: $('producto-descripcion'),
    ayudaEdicion: $('producto-ayuda-edicion'), guardar: $('producto-guardar'), cancelar: $('producto-cancelar'),
    total: $('productos-total'), vacio: $('productos-vacio'), filas: $('productos-filas'),
    lista: [], editando: null
  };
  var inventario = {
    modal: $('modal-inventario'), formulario: $('formulario-inventario'), titulo: $('inventario-titulo'),
    producto: $('inventario-producto'), existencias: $('inventario-existencias'), cantidad: $('inventario-cantidad'),
    motivo: $('inventario-motivo'), autorizacion: $('inventario-autorizacion'), contrasena: $('inventario-contrasena'),
    confirmar: $('inventario-confirmar'), tipo: null, actual: null
  };
  var movimientos = {
    modal: $('modal-movimientos'), producto: $('movimientos-producto'), vacio: $('movimientos-vacio'),
    tabla: $('movimientos-tabla'), filas: $('movimientos-filas')
  };

  function textoExistencias(n) { return t(Number(n) === 1 ? 'Existencias: {n} pieza' : 'Existencias: {n} piezas', { n: n }); }

  async function cargarProductos() {
    try { producto.lista = (await Api.catalogos.productos()) || []; }
    catch (error) { producto.lista = []; U.aviso(error.message, 'error'); }
    producto.total.textContent = t(producto.lista.length === 1 ? '{n} producto' : '{n} productos', { n: producto.lista.length });
    U.dibujarLista({
      contenedor: producto.filas, plantilla: 'plantilla-producto', vacio: producto.vacio, datos: producto.lista,
      alCrear: function (fila, p) {
        aplicarRoles(fila);
        fila.querySelector('[data-campo="NombreProducto"]').setAttribute('translate', 'no');
        var cat = fila.querySelector('[data-categoria]');
        if (p.Categoria) { cat.textContent = p.Categoria; cat.hidden = false; }
        var ex = fila.querySelector('[data-existencias]');
        ex.textContent = textoExistencias(p.Stock);
        if (Number(p.Stock) <= 0) ex.classList.add('texto-error'); else if (Number(p.Stock) <= 3) ex.classList.add('texto-aviso');
        fila.querySelector('[data-accion="entrada"]').addEventListener('click', function () { abrirInventario(p, 'entrada'); });
        var baja = fila.querySelector('[data-accion="baja"]');
        baja.disabled = Number(p.Stock) <= 0;
        baja.addEventListener('click', function () { abrirInventario(p, 'baja'); });
        fila.querySelector('[data-accion="movimientos"]').addEventListener('click', function () { verMovimientos(p); });
        fila.querySelector('[data-accion="editar"]').addEventListener('click', function () { editarProducto(p); });
        fila.querySelector('[data-accion="eliminar"]').addEventListener('click', function (e) { eliminarProducto(p, e.currentTarget); });
      }
    });
    producto.filas.hidden = !producto.lista.length;
    actualizarCategorias();
  }

  function limpiarProducto() {
    producto.editando = null;
    producto.formulario.reset();
    producto.stock.value = '0';
    producto.stockBloque.hidden = false;
    producto.ayudaEdicion.hidden = true;
    modoFormulario(producto.formulario, false, 'Nuevo producto', 'Editar producto');
  }

  function editarProducto(p) {
    producto.editando = p;
    producto.nombre.value = p.NombreProducto;
    producto.precio.value = p.Precio;
    producto.categoria.value = p.Categoria || '';
    producto.descripcion.value = p.Descripcion || '';
    producto.stockBloque.hidden = true;
    producto.ayudaEdicion.hidden = false;
    modoFormulario(producto.formulario, true, 'Nuevo producto', 'Editar producto');
    producto.formulario.scrollIntoView({ behavior: 'smooth', block: 'start' });
    producto.nombre.focus();
  }

  async function guardarProducto(e) {
    e.preventDefault();
    if (producto.nombre.value.trim().length < 2) { U.aviso('Escribe el nombre del producto.', 'error'); producto.nombre.focus(); return; }
    if (producto.precio.value === '' || Number(producto.precio.value) < 0) { U.aviso('Escribe un precio válido.', 'error'); producto.precio.focus(); return; }
    var categoria = producto.categoria.value.trim();
    if (categoria.length === 1) { U.aviso('La categoría debe tener al menos 2 letras.', 'error'); producto.categoria.focus(); return; }
    var datos = {
      NombreProducto: producto.nombre.value.trim(), Categoria: categoria || null,
      Precio: Number(producto.precio.value), Descripcion: producto.descripcion.value.trim()
    };
    if (!producto.editando) datos.Stock = Math.max(0, parseInt(producto.stock.value, 10) || 0);
    try {
      await U.conCarga(producto.guardar, producto.editando
        ? Api.productos.actualizar(producto.editando.ID_Producto, datos) : Api.productos.crear(datos));
      U.aviso(producto.editando ? 'Producto actualizado.' : 'Producto creado.');
      limpiarProducto();
      cargarProductos();
      cargadas.membresias = false; cargadas.descuentos = false;   // los beneficios pueden usar productos y categorías
    } catch (error) { U.aviso(error.message, 'error'); }
  }

  async function eliminarProducto(p, boton) {
    if (!(await U.confirmar(t('¿Eliminar el producto «{nombre}» del catálogo?', { nombre: p.NombreProducto })))) return;
    try {
      await U.conCarga(boton, Api.productos.eliminar(p.ID_Producto));
      U.aviso('Producto eliminado.');
      if (producto.editando && producto.editando.ID_Producto === p.ID_Producto) limpiarProducto();
      cargarProductos();
      cargadas.membresias = false; cargadas.descuentos = false;
    } catch (error) { U.aviso(error.message, 'error'); }
  }

  /**
   * Abre la ventana para agregar existencias o darlas de baja.
   * @param {Object} p
   * @param {'entrada'|'baja'} tipo
   */
  function abrirInventario(p, tipo) {
    inventario.tipo = tipo;
    inventario.actual = p;
    var baja = tipo === 'baja';
    inventario.titulo.textContent = t(baja ? 'Dar de baja del inventario' : 'Agregar inventario');
    inventario.producto.textContent = p.NombreProducto;
    inventario.existencias.textContent = textoExistencias(p.Stock);
    inventario.cantidad.value = '1';
    inventario.cantidad.max = baja ? String(p.Stock) : '100000';
    inventario.motivo.value = '';
    inventario.motivo.placeholder = t(baja ? 'Ej. Producto dañado o caducado' : 'Ej. Compra a proveedor');
    inventario.autorizacion.hidden = !baja;
    inventario.contrasena.value = '';
    inventario.confirmar.textContent = t(baja ? 'Confirmar baja' : 'Agregar al inventario');
    inventario.confirmar.className = 'boton ' + (baja ? 'boton--peligro' : 'boton--primario');
    abrirModal(inventario.modal);
    inventario.cantidad.select();
  }

  async function confirmarInventario(e) {
    e.preventDefault();
    var p = inventario.actual;
    var cantidad = parseInt(inventario.cantidad.value, 10);
    var baja = inventario.tipo === 'baja';
    if (!(cantidad >= 1)) { U.aviso('Escribe una cantidad válida.', 'error'); return; }
    if (baja && cantidad > Number(p.Stock)) { U.aviso(t('Solo hay {n} pieza(s) en existencia.', { n: p.Stock }), 'error'); return; }
    if (baja && inventario.motivo.value.trim().length < 3) { U.aviso('Escribe el motivo de la baja.', 'error'); inventario.motivo.focus(); return; }
    if (baja && !inventario.contrasena.value) { U.aviso('Escribe tu contraseña para autorizar la baja.', 'error'); inventario.contrasena.focus(); return; }
    try {
      var r = await U.conCarga(inventario.confirmar, baja
        ? Api.productos.baja(p.ID_Producto, { Cantidad: cantidad, Motivo: inventario.motivo.value.trim(), Contrasena: inventario.contrasena.value })
        : Api.productos.entrada(p.ID_Producto, { Cantidad: cantidad, Motivo: inventario.motivo.value.trim() || undefined }));
      U.aviso(t(baja ? 'Baja registrada. Quedan {n} pieza(s).' : 'Inventario agregado. Ahora hay {n} pieza(s).', { n: r.Stock }));
      cerrarModales();
      cargarProductos();
    } catch (error) {
      U.aviso(error.message, 'error');
      if (error.estado === 403) { inventario.contrasena.value = ''; inventario.contrasena.focus(); }
    }
  }

  async function verMovimientos(p) {
    movimientos.producto.textContent = p.NombreProducto + ' · ' + textoExistencias(p.Stock);
    var lista = [];
    abrirModal(movimientos.modal);
    try { lista = (await Api.productos.movimientos(p.ID_Producto)) || []; }
    catch (error) { U.aviso(error.message, 'error'); }
    U.dibujarLista({
      contenedor: movimientos.filas, plantilla: 'plantilla-movimiento', datos: lista, vacio: movimientos.vacio,
      alCrear: function (fila, m) {
        var clase = { Alta: 'insignia--exito', Entrada: 'insignia--exito', Baja: 'insignia--error', Venta: 'insignia--oro' }[m.Tipo] || '';
        fila.querySelector('.insignia').className = 'insignia ' + clase;
        fila.querySelector('[data-campo="RealizadoPor"]').setAttribute('translate', 'no');
        var cant = fila.querySelector('[data-campo="Cantidad"]');
        cant.textContent = (m.Tipo === 'Baja' || m.Tipo === 'Venta' ? '−' : '+') + m.Cantidad;
      }
    });
    movimientos.tabla.hidden = !lista.length;
    movimientos.filas.hidden = false;
  }

  // ===========================================================================
  // Membresías
  // ===========================================================================

  var membresia = {
    formulario: $('formulario-membresia'), nombre: $('membresia-nombre'), precio: $('membresia-precio'),
    duracion: $('membresia-duracion'), descripcion: $('membresia-descripcion'),
    beneficios: $('membresia-beneficios'), sinBeneficios: $('membresia-sin-beneficios'), sinServicios: $('membresia-sin-servicios'),
    agregar: $('membresia-agregar'), agregarTexto: $('membresia-agregar-texto'),
    guardar: $('membresia-guardar'), cancelar: $('membresia-cancelar'),
    vacio: $('membresias-vacio'), lista: $('membresias-lista'),
    planes: [], servicios: [], productos: [], editando: null
  };

  /** Categorías que se sugieren aunque todavía no haya productos con ellas. */
  var CATEGORIAS_BASE = ['Bebida', 'Cabello', 'Barba', 'Accesorios'];
  var SVG_PALOMITA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

  /**
   * Categorías conocidas (sin repetir mayúsculas ni acentos) con su número de productos.
   * @param {boolean} [conBase]  Incluir las sugeridas sin productos.
   * @returns {Array<{nombre: string, productos: number}>}
   */
  function categorias(conBase) {
    // «Bebida», «bebida» y «bébida» son la misma: se muestra la forma más usada.
    var mapa = {};
    function sumar(nombre, cuenta, peso) {
      if (!nombre) return;
      var limpio = String(nombre).trim();
      var clave = U.normalizarTexto(limpio);
      if (!mapa[clave]) mapa[clave] = { productos: 0, formas: {} };
      mapa[clave].productos += cuenta;
      mapa[clave].formas[limpio] = (mapa[clave].formas[limpio] || 0) + peso;
    }
    var productos = membresia.productos.length ? membresia.productos : producto.lista;
    productos.forEach(function (p) { sumar(p.Categoria, 1, 2); });
    membresia.planes.forEach(function (m) { (m.Beneficios || []).forEach(function (b) { sumar(b.Categoria, 0, 1); }); });
    if (conBase) CATEGORIAS_BASE.forEach(function (c) { sumar(c, 0, 0.5); });
    return Object.keys(mapa).map(function (k) {
      var formas = Object.keys(mapa[k].formas).sort(function (a, b) {
        return (mapa[k].formas[b] - mapa[k].formas[a]) || (/^[A-ZÁÉÍÓÚÑ]/.test(b) - /^[A-ZÁÉÍÓÚÑ]/.test(a));
      });
      return { nombre: formas[0], productos: mapa[k].productos };
    }).sort(function (a, b) { return a.nombre.localeCompare(b.nombre, 'es'); });
  }

  /** Sugerencias del campo «Categoría» (productos y beneficios). */
  function actualizarCategorias() {
    var lista = $('lista-categorias');
    lista.replaceChildren();
    categorias(true).forEach(function (c) {
      var o = document.createElement('option');
      o.value = c.nombre;
      lista.appendChild(o);
    });
  }

  async function cargarMembresias() {
    try {
      var r = await Promise.all([Api.catalogos.membresias(), Api.catalogos.servicios(), Api.catalogos.productos()]);
      membresia.planes = r[0] || [];
      membresia.servicios = r[1] || [];
      membresia.productos = r[2] || [];
    } catch (error) { U.aviso(error.message, 'error'); }
    actualizarCategorias();
    membresia.sinServicios.hidden = membresia.servicios.length > 0;
    dibujarEditorBeneficios(membresia.editando ? membresia.editando.Beneficios : []);
    U.dibujarLista({
      contenedor: membresia.lista, plantilla: 'plantilla-membresia', vacio: membresia.vacio,
      datos: membresia.planes.map(function (m) {
        return Object.assign({}, m, { Duracion: t(Number(m.DuracionMeses) === 1 ? '{n} mes' : '{n} meses', { n: m.DuracionMeses }) });
      }),
      alCrear: function (tarjeta, m) {
        tarjeta.querySelector('[data-campo="NombrePlan"]').setAttribute('translate', 'no');
        tarjeta.querySelector('[data-campo="Descripcion"]').setAttribute('translate', 'no');
        dibujarListaBeneficios(tarjeta.querySelector('[data-beneficios]'), m.Beneficios);
        tarjeta.querySelector('[data-accion="editar"]').addEventListener('click', function () { editarMembresia(m); });
        tarjeta.querySelector('[data-accion="eliminar"]').addEventListener('click', function (e) { eliminarMembresia(m, e.currentTarget); });
      }
    });
    membresia.lista.hidden = !membresia.planes.length;
  }

  /** Lista de la tarjeta: texto del cartel y, debajo, la regla que aplica la caja. */
  function dibujarListaBeneficios(ul, beneficios) {
    ul.replaceChildren();
    if (!beneficios || !beneficios.length) {
      var vacio = document.createElement('li');
      vacio.className = 'texto-tenue text-sm';
      vacio.textContent = t('Sin beneficios configurados');
      ul.appendChild(vacio);
      return;
    }
    beneficios.forEach(function (b) {
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
      ul.appendChild(li);
    });
  }

  // ---- Editor de beneficios (una fila por beneficio) -------------------------

  /** Opciones de «Aplica a»: servicios, productos, categorías y solo texto. */
  function llenarAplica(select, b) {
    select.replaceChildren();
    select.setAttribute('translate', 'no');
    function grupo(nombre) { var g = document.createElement('optgroup'); g.label = t(nombre); select.appendChild(g); return g; }
    function opcion(padre, valor, texto) { var o = document.createElement('option'); o.value = valor; o.textContent = texto; padre.appendChild(o); }
    var gs = grupo('Servicios');
    membresia.servicios.forEach(function (x) { opcion(gs, 'S:' + x.ID_Servicio, x.NombreServicio + ' · ' + U.formatoMoneda(x.Precio)); });
    var gp = grupo('Productos');
    opcion(gp, 'TODOS', t('Todos los productos'));
    var lista = categorias(false);
    if (b && b.Aplica === 'Categoria' && b.Categoria && !lista.some(function (c) { return U.normalizarTexto(c.nombre) === U.normalizarTexto(b.Categoria); })) {
      lista.push({ nombre: b.Categoria, productos: 0 });
    }
    lista.forEach(function (c) {
      opcion(gp, 'C:' + c.nombre, t('Categoría: {c}', { c: c.nombre }) + (c.productos ? ' (' + c.productos + ')' : ''));
    });
    opcion(gp, 'CAT', t('Otra categoría…'));
    membresia.productos.forEach(function (x) { opcion(gp, 'P:' + x.ID_Producto, x.NombreProducto + ' · ' + U.formatoMoneda(x.Precio)); });
    var go = grupo('Otro');
    opcion(go, 'TXT', t('Solo texto (no cambia el precio)'));
  }

  /** Valor de «Aplica a» para un beneficio guardado. */
  function valorAplica(select, b) {
    if (b.Aplica === 'Texto') return 'TXT';
    if (b.Aplica === 'Productos') return 'TODOS';
    if (b.Aplica === 'Producto') return 'P:' + b.ID_Producto;
    if (b.Aplica === 'Categoria') {
      var buscada = U.normalizarTexto(b.Categoria);
      var o = Array.prototype.find.call(select.options, function (x) { return x.value.indexOf('C:') === 0 && U.normalizarTexto(x.value.slice(2)) === buscada; });
      return o ? o.value : 'CAT';
    }
    return 'S:' + b.ID_Servicio;
  }

  /** Lee una fila del editor. */
  function leerFila(fila) {
    var c = fila._c;
    var v = c.aplica.value;
    var b = { ID_Beneficio: fila._id || null, Etiqueta: c.etiqueta.value.trim() || null };
    if (v === 'TXT') { b.Aplica = 'Texto'; return b; }
    if (v.indexOf('S:') === 0) {
      var s = membresia.servicios.find(function (x) { return String(x.ID_Servicio) === v.slice(2); });
      b.Aplica = 'Servicio'; b.ID_Servicio = Number(v.slice(2)); b.NombreServicio = s ? s.NombreServicio : '';
    } else if (v.indexOf('P:') === 0) {
      var p = membresia.productos.find(function (x) { return String(x.ID_Producto) === v.slice(2); });
      b.Aplica = 'Producto'; b.ID_Producto = Number(v.slice(2)); b.NombreProducto = p ? p.NombreProducto : '';
    } else if (v.indexOf('C:') === 0) {
      b.Aplica = 'Categoria'; b.Categoria = v.slice(2);
    } else if (v === 'CAT') {
      b.Aplica = 'Categoria'; b.Categoria = c.categoria.value.trim();
    } else {
      b.Aplica = 'Productos';
    }
    b.Tipo = c.tipo.value;
    b.Porcentaje = b.Tipo === 'Descuento' ? Number(c.porcentaje.value) : 100;
    b.Periodo = c.limite.value || 'Mes';
    b.Usos = c.limite.value ? Number(c.usos.value) : null;
    return b;
  }

  /** Ajusta los campos de una fila según lo elegido y actualiza su resumen. */
  function sincronizarFila(fila) {
    var c = fila._c;
    var v = c.aplica.value;
    var texto = v === 'TXT';
    var todos = v === 'TODOS';
    var otra = v === 'CAT';
    fila.classList.toggle('beneficio--texto', texto);
    c.campoCategoria.hidden = !otra;
    if (otra) c.regla.setAttribute('data-categoria', ''); else c.regla.removeAttribute('data-categoria');
    c.tipo.querySelector('[value="Gratis"]').disabled = todos;
    if (todos) c.tipo.value = 'Descuento';
    var descuento = c.tipo.value === 'Descuento';
    c.porcentaje.disabled = !descuento;
    if (!descuento) c.porcentaje.value = '';
    else if (!c.porcentaje.value) c.porcentaje.value = todos ? '10' : '20';
    c.usos.disabled = !c.limite.value;
    if (!c.limite.value) c.usos.value = '';
    else if (!c.usos.value) c.usos.value = '1';
    c.etiqueta.placeholder = t(texto ? 'Ej. Pase preferente' : 'Texto del cartel (opcional), ej. Cortes ilimitados');
    c.etiqueta.required = texto;
    c.resumen.textContent = U.reglaBeneficio(leerFila(fila));
    fila.classList.remove('beneficio--error');
  }

  /** Números, botones de subir/bajar y estado vacío. */
  function renumerar() {
    var filas = membresia.beneficios.querySelectorAll('[data-beneficio]');
    filas.forEach(function (f, i) {
      f.querySelector('[data-numero]').textContent = i + 1;
      f.querySelector('[data-mover="-1"]').disabled = i === 0;
      f.querySelector('[data-mover="1"]').disabled = i === filas.length - 1;
    });
    membresia.sinBeneficios.hidden = filas.length > 0;
    membresia.beneficios.hidden = filas.length === 0;
  }

  /**
   * Agrega una fila al editor.
   * @param {Object} [b]  Beneficio guardado (o valores iniciales).
   * @returns {Element}
   */
  function agregarFila(b) {
    b = b || {};
    var fila = U.crearDesdePlantilla('plantilla-beneficio', {});
    var c = {
      etiqueta: fila.querySelector('[data-b-etiqueta]'), aplica: fila.querySelector('[data-b-aplica]'),
      categoria: fila.querySelector('[data-b-categoria]'), campoCategoria: fila.querySelector('[data-campo-categoria]'),
      tipo: fila.querySelector('[data-b-tipo]'), porcentaje: fila.querySelector('[data-b-porcentaje]'),
      limite: fila.querySelector('[data-b-limite]'), usos: fila.querySelector('[data-b-usos]'),
      resumen: fila.querySelector('[data-resumen]'), regla: fila.querySelector('.beneficio__regla')
    };
    fila._c = c;
    fila._id = b.ID_Beneficio || null;
    c.etiqueta.setAttribute('translate', 'no');
    llenarAplica(c.aplica, b);

    if (b.Aplica) {
      c.aplica.value = valorAplica(c.aplica, b);
      if (c.aplica.value === 'CAT') c.categoria.value = b.Categoria || '';
      c.etiqueta.value = b.Etiqueta || '';
      c.tipo.value = b.Tipo === 'Descuento' ? 'Descuento' : 'Gratis';
      c.porcentaje.value = b.Tipo === 'Descuento' ? Number(b.Porcentaje) : '';
      c.limite.value = b.Usos == null ? '' : (b.Periodo === 'Visita' ? 'Visita' : 'Mes');
      c.usos.value = b.Usos == null ? '' : b.Usos;
    } else {
      c.aplica.value = membresia.servicios.length ? 'S:' + membresia.servicios[0].ID_Servicio : 'TODOS';
    }

    [c.aplica, c.tipo, c.limite].forEach(function (x) { x.addEventListener('change', function () { sincronizarFila(fila); }); });
    [c.porcentaje, c.usos, c.categoria, c.etiqueta].forEach(function (x) { x.addEventListener('input', function () { sincronizarFila(fila); }); });
    fila.querySelector('[data-quitar]').addEventListener('click', function () { fila.remove(); renumerar(); });
    fila.querySelectorAll('[data-mover]').forEach(function (boton) {
      boton.addEventListener('click', function () {
        var paso = Number(boton.getAttribute('data-mover'));
        var otra = paso < 0 ? fila.previousElementSibling : fila.nextElementSibling;
        if (!otra) return;
        if (paso < 0) membresia.beneficios.insertBefore(fila, otra); else membresia.beneficios.insertBefore(otra, fila);
        renumerar();
        boton.focus();
      });
    });

    membresia.beneficios.appendChild(fila);
    sincronizarFila(fila);
    renumerar();
    return fila;
  }

  /** Dibuja el editor con los beneficios de un plan (vacío = membresía nueva). */
  function dibujarEditorBeneficios(actuales) {
    membresia.beneficios.replaceChildren();
    (actuales || []).forEach(function (b) { agregarFila(b); });
    renumerar();
  }

  /**
   * Lee y valida todas las filas.
   * @returns {Array<Object>|null}  null si hay un error (ya se avisó).
   */
  function leerBeneficios() {
    var lista = [];
    var filas = membresia.beneficios.querySelectorAll('[data-beneficio]');
    for (var i = 0; i < filas.length; i++) {
      var f = filas[i];
      var b = leerFila(f);
      var n = i + 1;
      var error = null;
      var campo = null;
      if (b.Aplica === 'Texto' && !(b.Etiqueta && b.Etiqueta.length >= 2)) { error = t('Escribe el texto del beneficio {n}.', { n: n }); campo = f._c.etiqueta; }
      else if (b.Aplica === 'Categoria' && !(b.Categoria && b.Categoria.length >= 2)) { error = t('Escribe la categoría del beneficio {n}.', { n: n }); campo = f._c.categoria; }
      else if (b.Aplica !== 'Texto' && b.Tipo === 'Descuento' && !(b.Porcentaje >= 1 && b.Porcentaje <= 100)) { error = t('El porcentaje de descuento debe estar entre 1 y 100.'); campo = f._c.porcentaje; }
      else if (b.Aplica !== 'Texto' && b.Usos !== null && !(Number.isInteger(b.Usos) && b.Usos >= 1 && b.Usos <= 999)) { error = t('Escribe cuántos usos tiene el beneficio {n}.', { n: n }); campo = f._c.usos; }
      if (error) {
        f.classList.add('beneficio--error');
        U.aviso(error, 'error');
        if (campo) campo.focus();
        return null;
      }
      delete b.NombreServicio;
      delete b.NombreProducto;
      lista.push(b);
    }
    return lista;
  }

  function limpiarMembresia() {
    membresia.editando = null;
    membresia.formulario.reset();
    dibujarEditorBeneficios([]);
    modoFormulario(membresia.formulario, false, 'Nueva membresía', 'Editar membresía');
  }

  function editarMembresia(m) {
    membresia.editando = m;
    membresia.nombre.value = m.NombrePlan;
    membresia.precio.value = m.Precio;
    if (!membresia.duracion.querySelector('option[value="' + m.DuracionMeses + '"]')) {
      var op = document.createElement('option');
      op.value = m.DuracionMeses; op.textContent = t('{n} meses', { n: m.DuracionMeses });
      membresia.duracion.appendChild(op);
    }
    membresia.duracion.value = String(m.DuracionMeses);
    membresia.descripcion.value = m.Descripcion || '';
    dibujarEditorBeneficios(m.Beneficios);
    modoFormulario(membresia.formulario, true, 'Nueva membresía', 'Editar membresía');
    membresia.formulario.scrollIntoView({ behavior: 'smooth', block: 'start' });
    membresia.nombre.focus();
  }

  async function guardarMembresia(e) {
    e.preventDefault();
    if (membresia.nombre.value.trim().length < 2) { U.aviso('Escribe el nombre de la membresía.', 'error'); membresia.nombre.focus(); return; }
    if (membresia.precio.value === '' || Number(membresia.precio.value) < 0) { U.aviso('Escribe un precio válido.', 'error'); membresia.precio.focus(); return; }
    var beneficios = leerBeneficios();
    if (!beneficios) return;
    var datos = {
      NombrePlan: membresia.nombre.value.trim(), Precio: Number(membresia.precio.value),
      DuracionMeses: Number(membresia.duracion.value), Descripcion: membresia.descripcion.value.trim(), Beneficios: beneficios
    };
    try {
      await U.conCarga(membresia.guardar, membresia.editando
        ? Api.membresias.actualizar(membresia.editando.ID_Membresia, datos) : Api.membresias.crear(datos));
      U.aviso(membresia.editando ? 'Membresía actualizada.' : 'Membresía creada.');
      limpiarMembresia();
      cargarMembresias();
    } catch (error) { U.aviso(error.message, 'error'); }
  }

  async function eliminarMembresia(m, boton) {
    if (!(await U.confirmar(t('¿Eliminar la membresía «{nombre}»? Los clientes que ya la tienen la conservan hasta su vencimiento.', { nombre: m.NombrePlan })))) return;
    try {
      await U.conCarga(boton, Api.membresias.eliminar(m.ID_Membresia));
      U.aviso('Membresía eliminada.');
      if (membresia.editando && membresia.editando.ID_Membresia === m.ID_Membresia) limpiarMembresia();
      cargarMembresias();
    } catch (error) { U.aviso(error.message, 'error'); }
  }

  // ===========================================================================
  // Descuentos y promociones
  // ===========================================================================

  var descuento = {
    formulario: $('formulario-descuento'), nombre: $('descuento-nombre'), descripcion: $('descuento-descripcion'),
    aplica: $('descuento-aplica'), filaDetalle: $('descuento-fila-detalle'), detalle: $('descuento-detalle'),
    tipo: $('descuento-tipo'), valor: $('descuento-valor'), etiquetaValor: $('descuento-etiqueta-valor'), ayudaMonto: $('descuento-ayuda-monto'),
    inicio: $('descuento-inicio'), fin: $('descuento-fin'), activo: $('descuento-activo'),
    guardar: $('descuento-guardar'), cancelar: $('descuento-cancelar'),
    total: $('descuentos-total'), vacio: $('descuentos-vacio'), lista: $('descuentos-lista'),
    registros: [], editando: null, catalogos: { servicios: [], productos: [], membresias: [] }
  };
  var ESTADO_DESCUENTO = {
    'Vigente': 'insignia--exito', 'En pausa': 'insignia--alerta', 'Programado': 'insignia--oro', 'Terminado': 'insignia--error'
  };

  /** Opciones de «Aplica a» según la sección elegida. Valor: 's:ID', 'p:ID', 'c:Categoría', 'm:ID' o '' (todos). */
  function llenarDetalleDescuento(seleccion) {
    var seccion = descuento.aplica.value;
    var c = descuento.catalogos;
    var opciones = [];
    if (seccion === 'Servicios') {
      opciones.push(['', t('Todos los servicios')]);
      c.servicios.forEach(function (s) { opciones.push(['s:' + s.ID_Servicio, s.NombreServicio]); });
    } else if (seccion === 'Productos') {
      opciones.push(['', t('Todos los productos')]);
      var vistas = {};
      c.productos.forEach(function (p) {
        var cat = (p.Categoria || '').trim();
        if (cat && !vistas[cat.toLowerCase()]) { vistas[cat.toLowerCase()] = true; opciones.push(['c:' + cat, t('Categoría') + ': ' + cat]); }
      });
      c.productos.forEach(function (p) { opciones.push(['p:' + p.ID_Producto, p.NombreProducto]); });
    } else if (seccion === 'Membresias') {
      opciones.push(['', t('Todas las membresías')]);
      c.membresias.forEach(function (m) { opciones.push(['m:' + m.ID_Membresia, m.NombrePlan]); });
    }
    descuento.detalle.replaceChildren();
    opciones.forEach(function (o) {
      var op = document.createElement('option');
      op.value = o[0]; op.textContent = o[1];
      if (o[0]) op.setAttribute('translate', 'no');
      descuento.detalle.appendChild(op);
    });
    descuento.filaDetalle.hidden = seccion === 'Todo';
    if (seleccion != null) descuento.detalle.value = seleccion;
    if (descuento.detalle.selectedIndex < 0) descuento.detalle.selectedIndex = 0;
  }

  function pintarTipoDescuento() {
    var porcentaje = descuento.tipo.value === 'Porcentaje';
    descuento.etiquetaValor.textContent = t(porcentaje ? 'Porcentaje' : 'Cantidad');
    descuento.valor.placeholder = porcentaje ? '10' : '30.00';
    descuento.valor.max = porcentaje ? '100' : '';
    descuento.ayudaMonto.hidden = porcentaje;
  }

  async function cargarDescuentos() {
    var r = await Promise.allSettled([Api.descuentos.listar(), Api.catalogos.servicios(), Api.catalogos.productos(), Api.catalogos.membresias()]);
    var valor = function (i) { return r[i].status === 'fulfilled' ? (r[i].value || []) : []; };
    if (r[0].status === 'rejected') U.aviso(r[0].reason.message, 'error');
    descuento.registros = valor(0);
    descuento.catalogos = { servicios: valor(1), productos: valor(2), membresias: valor(3) };
    if (!descuento.editando) llenarDetalleDescuento(descuento.detalle.value);
    descuento.total.textContent = t(descuento.registros.length === 1 ? '{n} descuento' : '{n} descuentos', { n: descuento.registros.length });
    U.dibujarLista({
      contenedor: descuento.lista, plantilla: 'plantilla-descuento', datos: descuento.registros, vacio: descuento.vacio,
      alCrear: function (fila, d) {
        var estado = fila.querySelector('[data-estado]');
        estado.textContent = t(d.Estado);
        estado.className = 'insignia ' + (ESTADO_DESCUENTO[d.Estado] || '');
        fila.querySelector('[data-valor]').textContent = '−' + U.valorDescuento(d);
        fila.querySelector('[data-alcance]').textContent = U.alcanceDescuento(d);
        var fechas = fila.querySelector('[data-fechas]');
        fechas.textContent = d.FechaInicio && d.FechaFin ? t('Del {a} al {b}', { a: U.formatoFecha(d.FechaInicio), b: U.formatoFecha(d.FechaFin) })
          : d.FechaInicio ? t('Desde el {a}', { a: U.formatoFecha(d.FechaInicio) })
          : d.FechaFin ? t('Hasta el {b}', { b: U.formatoFecha(d.FechaFin) }) : t('Sin fecha de término');
        var pausar = fila.querySelector('[data-accion="pausar"]');
        pausar.querySelector('.icono').textContent = d.Activo ? 'pause' : 'play_arrow';
        pausar.title = t(d.Activo ? 'Poner en pausa' : 'Reanudar');
        pausar.setAttribute('aria-label', pausar.title);
        pausar.addEventListener('click', function () { pausarDescuento(d, pausar); });
        fila.querySelector('[data-accion="editar"]').addEventListener('click', function () { editarDescuento(d); });
        fila.querySelector('[data-accion="eliminar"]').addEventListener('click', function (e) { eliminarDescuento(d, e.currentTarget); });
      }
    });
    descuento.lista.hidden = !descuento.registros.length;
  }

  /** Datos del descuento como los espera la API. */
  function cuerpoDescuento(d) {
    return {
      Nombre: d.Nombre, Descripcion: d.Descripcion || '', Aplica: d.Aplica, ID_Servicio: d.ID_Servicio || null, ID_Producto: d.ID_Producto || null,
      Categoria: d.Categoria || null, ID_Membresia: d.ID_Membresia || null, Tipo: d.Tipo, Valor: d.Valor,
      FechaInicio: d.FechaInicio || null, FechaFin: d.FechaFin || null, Activo: d.Activo
    };
  }

  function limpiarDescuento() {
    descuento.editando = null;
    descuento.formulario.reset();
    descuento.activo.checked = true;
    llenarDetalleDescuento('');
    pintarTipoDescuento();
    modoFormulario(descuento.formulario, false, 'Nuevo descuento', 'Editar descuento');
  }

  function editarDescuento(d) {
    descuento.editando = d;
    descuento.nombre.value = d.Nombre;
    descuento.descripcion.value = d.Descripcion || '';
    descuento.aplica.value = d.Aplica;
    llenarDetalleDescuento(d.ID_Servicio ? 's:' + d.ID_Servicio : d.ID_Producto ? 'p:' + d.ID_Producto
      : d.Categoria ? 'c:' + d.Categoria : d.ID_Membresia ? 'm:' + d.ID_Membresia : '');
    descuento.tipo.value = d.Tipo;
    descuento.valor.value = d.Valor;
    descuento.inicio.value = d.FechaInicio || '';
    descuento.fin.value = d.FechaFin || '';
    descuento.activo.checked = !!d.Activo;
    pintarTipoDescuento();
    modoFormulario(descuento.formulario, true, 'Nuevo descuento', 'Editar descuento');
    descuento.formulario.scrollIntoView({ behavior: 'smooth', block: 'start' });
    descuento.nombre.focus();
  }

  async function guardarDescuento(e) {
    e.preventDefault();
    var valor = Number(descuento.valor.value);
    if (descuento.nombre.value.trim().length < 2) { U.aviso('Escribe el nombre del descuento.', 'error'); descuento.nombre.focus(); return; }
    if (!(valor > 0) || (descuento.tipo.value === 'Porcentaje' && valor > 100)) {
      U.aviso(descuento.tipo.value === 'Porcentaje' ? 'El porcentaje debe estar entre 1 y 100.' : 'Escribe la cantidad a descontar.', 'error');
      descuento.valor.focus(); return;
    }
    if (descuento.inicio.value && descuento.fin.value && descuento.fin.value < descuento.inicio.value) {
      U.aviso('La fecha de término no puede ser anterior a la de inicio.', 'error'); descuento.fin.focus(); return;
    }
    var detalle = descuento.aplica.value === 'Todo' ? '' : descuento.detalle.value;
    var clave = detalle.slice(0, 2), resto = detalle.slice(2);
    var datos = {
      Nombre: descuento.nombre.value.trim(), Descripcion: descuento.descripcion.value.trim(), Aplica: descuento.aplica.value,
      ID_Servicio: clave === 's:' ? Number(resto) : null, ID_Producto: clave === 'p:' ? Number(resto) : null,
      Categoria: clave === 'c:' ? resto : null, ID_Membresia: clave === 'm:' ? Number(resto) : null,
      Tipo: descuento.tipo.value, Valor: valor,
      FechaInicio: descuento.inicio.value || null, FechaFin: descuento.fin.value || null, Activo: descuento.activo.checked
    };
    try {
      await U.conCarga(descuento.guardar, descuento.editando
        ? Api.descuentos.actualizar(descuento.editando.ID_Descuento, datos) : Api.descuentos.crear(datos));
      U.aviso(descuento.editando ? 'Descuento actualizado.' : 'Descuento creado.');
      limpiarDescuento();
      cargarDescuentos();
    } catch (error) { U.aviso(error.message, 'error'); }
  }

  async function pausarDescuento(d, boton) {
    try {
      await U.conCarga(boton, Api.descuentos.actualizar(d.ID_Descuento, Object.assign(cuerpoDescuento(d), { Activo: !d.Activo })));
      U.aviso(d.Activo ? 'Descuento en pausa.' : 'Descuento reanudado.');
      cargarDescuentos();
    } catch (error) { U.aviso(error.message, 'error'); }
  }

  async function eliminarDescuento(d, boton) {
    if (!(await U.confirmar(t('¿Eliminar el descuento «{nombre}»? Ya no se aplicará en caja.', { nombre: d.Nombre })))) return;
    try {
      await U.conCarga(boton, Api.descuentos.eliminar(d.ID_Descuento));
      U.aviso('Descuento eliminado.');
      if (descuento.editando && descuento.editando.ID_Descuento === d.ID_Descuento) limpiarDescuento();
      cargarDescuentos();
    } catch (error) { U.aviso(error.message, 'error'); }
  }

  // ===========================================================================
  // Cuentas
  // ===========================================================================

  var cuenta = {
    formulario: $('formulario-cuenta'), nombre: $('cuenta-nombre'), usuario: $('cuenta-usuario'),
    contrasena: $('cuenta-contrasena'), telefono: $('cuenta-telefono'), guardar: $('cuenta-guardar'),
    lista: $('cuentas-lista'), rol: 'Cajero',
    modal: $('modal-contrasena'), formularioClave: $('formulario-contrasena'), cuentaTexto: $('contrasena-cuenta'),
    nueva: $('contrasena-nueva'), guardarClave: $('contrasena-guardar'), enEdicion: null
  };

  async function cargarCuentas() {
    var cuentas = [];
    try { cuentas = (await Api.cuentas.listar()) || []; }
    catch (error) { U.aviso(error.message, 'error'); }
    var yo = Sesion.usuario() || {};
    U.dibujarLista({
      contenedor: cuenta.lista, plantilla: 'plantilla-cuenta',
      datos: cuentas.map(function (c) { return Object.assign({}, c, { TelefonoTexto: c.Telefono ? '· ' + U.formatoTelefono(c.Telefono) : '' }); }),
      alCrear: function (fila, c) {
        fila.querySelector('[data-campo="Nombre"].fila__titulo').setAttribute('translate', 'no');
        var insignia = fila.querySelector('.insignia');
        insignia.className = 'insignia ' + ({ 'Dueño': 'insignia--oro', Cajero: 'insignia--exito', Barbero: '' }[c.Rol] || '');
        var eliminar = fila.querySelector('[data-accion="eliminar"]');
        if (c.Rol === 'Dueño') eliminar.hidden = true;
        eliminar.addEventListener('click', function (e) { eliminarCuenta(c, e.currentTarget); });
        fila.querySelector('[data-accion="contrasena"]').addEventListener('click', function () {
          cuenta.enEdicion = c;
          cuenta.cuentaTexto.textContent = c.Nombre + ' · ' + c.Usuario + (c.Rol === 'Dueño' && String(c.ID) === String(yo.id) ? ' (' + t('tú') + ')' : '');
          cuenta.nueva.value = '';
          abrirModal(cuenta.modal);
        });
      }
    });
  }

  async function guardarCuenta(e) {
    e.preventDefault();
    var tel = cuenta.telefono.value.replace(/\D/g, '');
    if (cuenta.nombre.value.trim().length < 3) { U.aviso('Escribe el nombre completo.', 'error'); cuenta.nombre.focus(); return; }
    if (cuenta.usuario.value.trim().length < 3) { U.aviso('El usuario debe tener al menos 3 caracteres.', 'error'); cuenta.usuario.focus(); return; }
    if (cuenta.contrasena.value.length < 3) { U.aviso('La contraseña debe tener al menos 3 caracteres.', 'error'); cuenta.contrasena.focus(); return; }
    if (tel && tel.length !== 10) { U.aviso('El teléfono debe tener exactamente 10 dígitos.', 'error'); cuenta.telefono.focus(); return; }
    try {
      var r = await U.conCarga(cuenta.guardar, Api.cuentas.crear({
        Rol: cuenta.rol, Nombre: cuenta.nombre.value.trim(), Usuario: cuenta.usuario.value.trim(),
        Contrasena: cuenta.contrasena.value, Telefono: tel || undefined
      }));
      U.aviso(t('Cuenta de {rol} creada. Usuario: {usuario}', { rol: t(r.Rol).toLowerCase(), usuario: r.Usuario }));
      cuenta.formulario.reset();
      cargarCuentas();
    } catch (error) { U.aviso(error.message, 'error'); }
  }

  async function eliminarCuenta(c, boton) {
    if (!(await U.confirmar(t('¿Eliminar la cuenta de {nombre} ({rol})? Ya no podrá iniciar sesión; su historial se conserva.', { nombre: c.Nombre, rol: t(c.Rol) })))) return;
    try {
      await U.conCarga(boton, Api.cuentas.eliminar(c.Rol, c.ID));
      U.aviso('Cuenta eliminada.');
      cargarCuentas();
    } catch (error) { U.aviso(error.message, 'error'); }
  }

  async function guardarContrasena(e) {
    e.preventDefault();
    if (cuenta.nueva.value.length < 3) { U.aviso('La contraseña debe tener al menos 3 caracteres.', 'error'); return; }
    try {
      await U.conCarga(cuenta.guardarClave, Api.cuentas.cambiarContrasena(cuenta.enEdicion.Rol, cuenta.enEdicion.ID, cuenta.nueva.value));
      U.aviso('Contraseña actualizada.');
      cerrarModales();
    } catch (error) { U.aviso(error.message, 'error'); }
  }

  // ===========================================================================
  // Datos del negocio
  // ===========================================================================

  var negocio = {
    formulario: $('formulario-negocio'), guardar: $('negocio-guardar'), horario: $('negocio-horario'),
    campos: {
      NombreEstablecimiento: $('negocio-nombre'), Eslogan: $('negocio-eslogan'), Direccion: $('negocio-direccion'),
      Telefono: $('negocio-telefono'), RedesSociales: $('negocio-redes'), MensajeTicket: $('negocio-mensaje'),
      DatosFiscales: $('negocio-fiscales'), FondoCaja: $('negocio-fondo'), UbicacionMapa: $('negocio-mapa'), InfoCitas: $('negocio-citas')
    }
  };

  /** Un renglón por día: casilla «abre», hora de apertura y de cierre. */
  function dibujarHorarioNegocio() {
    if (negocio.horario.children.length) return;
    DIAS.forEach(function (d) {
      var fila = document.createElement('div');
      fila.className = 'horario-negocio__dia';
      fila.setAttribute('data-dia', d[0]);
      var etiqueta = document.createElement('label');
      var casilla = document.createElement('input'); casilla.type = 'checkbox'; casilla.setAttribute('data-abre', '');
      var nombre = document.createElement('span'); nombre.textContent = t(d[1]);
      etiqueta.append(casilla, nombre);
      var abre = document.createElement('input'); abre.type = 'time'; abre.className = 'campo numeros'; abre.setAttribute('data-desde', '');
      abre.setAttribute('aria-label', t('{dia}: abre a las', { dia: t(d[1]) }));
      var a = document.createElement('span'); a.className = 'horario-negocio__a texto-tenue'; a.textContent = t('a');
      var cierra = document.createElement('input'); cierra.type = 'time'; cierra.className = 'campo numeros'; cierra.setAttribute('data-hasta', '');
      cierra.setAttribute('aria-label', t('{dia}: cierra a las', { dia: t(d[1]) }));
      var cerrado = document.createElement('span'); cerrado.className = 'horario-negocio__cerrado'; cerrado.textContent = t('Cerrado');
      casilla.addEventListener('change', function () {
        fila.setAttribute('data-cerrado', String(!casilla.checked));
        if (casilla.checked && !abre.value) { abre.value = '09:00'; cierra.value = '20:00'; }
      });
      fila.append(etiqueta, abre, a, cierra, cerrado);
      negocio.horario.appendChild(fila);
    });
  }

  function ponerHorarioNegocio(h) {
    dibujarHorarioNegocio();
    Array.prototype.forEach.call(negocio.horario.children, function (fila) {
      var dia = h && h[fila.getAttribute('data-dia')];
      fila.querySelector('[data-abre]').checked = !!dia;
      fila.querySelector('[data-desde]').value = dia ? dia[0] : '';
      fila.querySelector('[data-hasta]').value = dia ? dia[1] : '';
      fila.setAttribute('data-cerrado', String(!dia));
    });
  }

  /** @returns {Object|null} { L: ['09:00','20:00'], D: null } · null si no se marcó ningún día. Lanza Error si falta una hora. */
  function leerHorarioNegocio() {
    var h = {}, alguno = false;
    Array.prototype.forEach.call(negocio.horario.children, function (fila) {
      var letra = fila.getAttribute('data-dia');
      if (!fila.querySelector('[data-abre]').checked) { h[letra] = null; return; }
      var desde = fila.querySelector('[data-desde]').value, hasta = fila.querySelector('[data-hasta]').value;
      var nombre = t(DIAS.filter(function (d) { return d[0] === letra; })[0][1]);
      if (!desde || !hasta) throw new Error(t('{dia}: escribe la hora de apertura y la de cierre.', { dia: nombre }));
      if (hasta <= desde) throw new Error(t('{dia}: la hora de cierre debe ser después de la de apertura.', { dia: nombre }));
      h[letra] = [desde, hasta];
      alguno = true;
    });
    return alguno ? h : null;
  }

  async function cargarNegocio() {
    dibujarHorarioNegocio();
    try {
      var datos = await Api.establecimiento.obtener();
      Object.keys(negocio.campos).forEach(function (k) { negocio.campos[k].value = datos[k] == null ? '' : datos[k]; });
      ponerHorarioNegocio(datos.HorarioAtencion);
    } catch (error) { U.aviso(error.message, 'error'); }
  }

  async function guardarNegocio(e) {
    e.preventDefault();
    var datos = {};
    Object.keys(negocio.campos).forEach(function (k) { datos[k] = negocio.campos[k].value.trim(); });
    datos.FondoCaja = Number(datos.FondoCaja) || 0;
    if (!datos.NombreEstablecimiento) { U.aviso('Escribe el nombre del negocio.', 'error'); return; }
    if (datos.UbicacionMapa && !/^https?:\/\/\S+$/i.test(datos.UbicacionMapa)) { U.aviso('El enlace del mapa debe empezar con https://', 'error'); negocio.campos.UbicacionMapa.focus(); return; }
    try { datos.HorarioAtencion = leerHorarioNegocio(); }
    catch (error) { U.aviso(error.message, 'error'); return; }
    try { await U.conCarga(negocio.guardar, Api.establecimiento.actualizar(datos)); U.aviso('Datos del negocio guardados.'); }
    catch (error) { U.aviso(error.message, 'error'); }
  }

  // ===========================================================================
  // Impresora
  // ===========================================================================

  var impresora = {
    android: $('impresora-android'), elegida: $('impresora-elegida'), buscar: $('buscar-impresoras'),
    lista: $('lista-impresoras'), logo: $('impresora-logo'), guardar: $('impresora-guardar'), prueba: $('impresora-prueba'),
    bluetooth: $('impresora-bluetooth'), conexion: $('impresora-conexion'), estado: $('impresora-estado'),
    serie: $('impresora-serie'), seriePuerto: $('serie-puerto'), serieElegir: $('serie-elegir'), velocidad: $('serie-velocidad'),
    ble: $('impresora-ble'), bleNombre: $('ble-nombre'), bleElegir: $('ble-elegir'),
    seleccion: null, nombreBle: '', iniciada: false
  };

  function tipoImpresora() {
    var marcado = document.querySelector('input[name="tipo-impresora"]:checked');
    return marcado ? marcado.value : 'sistema';
  }

  /** Resultado de una prueba, debajo de los botones. */
  function estadoImpresora(texto, tipo) {
    impresora.estado.textContent = texto || '';
    impresora.estado.className = 'ayuda' + (tipo ? ' ayuda--' + tipo : '');
  }

  function cargarImpresora() {
    var cfg = window.Impresora.configuracion();
    var disp = window.Impresora.disponibles();
    document.querySelectorAll('input[name="tipo-impresora"]').forEach(function (r) {
      r.disabled = !disp[r.value];
      r.checked = r.value === cfg.tipo;
      if (!impresora.iniciada) r.addEventListener('change', function () { estadoImpresora(''); pintarImpresora(); guardarImpresora(true); });
    });
    impresora.iniciada = true;
    impresora.seleccion = cfg.direccion ? { direccion: cfg.direccion, nombre: cfg.nombre } : null;
    impresora.logo.checked = cfg.logo !== false;
    impresora.velocidad.value = String(cfg.velocidad || 9600);
    impresora.bluetooth.hidden = !(window.EngreidosAndroid && window.EngreidosAndroid.abrirBluetooth);
    pintarImpresora();
    if (disp.serie) window.Impresora.puertoGuardado().then(function (n) { impresora.seriePuerto.textContent = n || t('Ninguno'); }).catch(function () { /* nada */ });
  }

  function pintarImpresora() {
    var tipo = tipoImpresora();
    impresora.android.hidden = tipo !== 'android';
    impresora.serie.hidden = tipo !== 'serie';
    impresora.ble.hidden = tipo !== 'ble';
    impresora.elegida.textContent = impresora.seleccion ? impresora.seleccion.nombre + ' (' + impresora.seleccion.direccion + ')' : t('Ninguna');
    impresora.bleNombre.textContent = impresora.nombreBle || t('Ninguna');
    if (!impresora.seriePuerto.textContent) impresora.seriePuerto.textContent = t('Ninguno');
  }

  function buscarImpresoras() {
    var r = window.Impresora.listarAndroid();
    impresora.lista.replaceChildren();
    if (r && r.error) {
      var mensaje = r.error === 'PERMISO' ? t('Permite el acceso a «Dispositivos cercanos» y vuelve a tocar «Buscar vinculadas».') : t(r.error);
      estadoImpresora(mensaje, 'error'); U.aviso(mensaje, 'error'); return;
    }
    if (!r.length) {
      estadoImpresora(t('No hay impresoras vinculadas. Toca «Abrir Bluetooth del teléfono», vincúlala (PIN 0000 o 1234) y vuelve a buscar.'), 'error');
      return;
    }
    estadoImpresora(t('Toca tu impresora en la lista.'));
    // Primero las que parecen impresoras por su nombre.
    var pareceImpresora = function (d) { return /print|impres|pos|58|80|mtp|rpp|thermal|bluetooth/i.test(d.nombre || '') ? 0 : 1; };
    r.slice().sort(function (a, b) { return pareceImpresora(a) - pareceImpresora(b); }).forEach(function (d) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'fila fila--seleccionable';
      b.setAttribute('translate', 'no');
      var ic = document.createElement('span'); ic.className = 'icono'; ic.setAttribute('aria-hidden', 'true'); ic.textContent = 'print';
      var tx = document.createElement('span'); tx.className = 'fila__cuerpo';
      tx.innerHTML = '<span class="fila__titulo block"></span><span class="fila__detalle block numeros"></span>';
      tx.children[0].textContent = d.nombre || '—';
      tx.children[1].textContent = d.direccion;
      b.append(ic, tx);
      b.addEventListener('click', function () {
        impresora.seleccion = d; pintarImpresora(); guardarImpresora(true);
        impresora.lista.replaceChildren();
        probarConexionImpresora();
      });
      impresora.lista.appendChild(b);
    });
  }

  function guardarImpresora(silencioso) {
    var tipo = tipoImpresora();
    var anterior = window.Impresora.configuracion();
    window.Impresora.guardar({
      tipo: tipo,
      direccion: tipo === 'android' && impresora.seleccion ? impresora.seleccion.direccion : undefined,
      nombre: tipo === 'android' && impresora.seleccion ? impresora.seleccion.nombre : undefined,
      velocidad: Number(impresora.velocidad.value) || 9600,
      logo: impresora.logo.checked
    });
    // Otra velocidad: el puerto se vuelve a abrir en la siguiente impresión.
    if (Number(anterior.velocidad || 9600) !== (Number(impresora.velocidad.value) || 9600)) window.Impresora.cerrarPuerto();
    if (silencioso !== true) U.aviso('Impresora guardada en este equipo.');
  }

  /** Comprueba que la impresora responde (sin imprimir). */
  async function probarConexionImpresora() {
    guardarImpresora(true);
    estadoImpresora(t('Conectando con la impresora…'));
    // Deja que se pinte «Conectando…» antes de la llamada (en Android bloquea unos segundos).
    await new Promise(function (r) { setTimeout(r, 60); });
    try {
      var texto = await U.conCarga(impresora.conexion, window.Impresora.probarConexion());
      estadoImpresora(texto, 'exito');
    } catch (error) { estadoImpresora(error.message || String(error), 'error'); }
  }

  async function pruebaImpresora() {
    guardarImpresora(true);
    estadoImpresora(tipoImpresora() === 'sistema' ? '' : t('Enviando el ticket de prueba…'));
    await new Promise(function (r) { setTimeout(r, 60); });
    try {
      await U.conCarga(impresora.prueba, Promise.resolve(window.Impresora.prueba()));
      if (tipoImpresora() !== 'sistema') { estadoImpresora(t('Ticket de prueba enviado.'), 'exito'); U.aviso('Ticket de prueba enviado.'); }
    } catch (error) { estadoImpresora(error.message || String(error), 'error'); U.aviso(error.message || String(error), 'error'); }
  }

  async function elegirPuertoSerie() {
    try {
      impresora.seriePuerto.textContent = await window.Impresora.elegirPuerto();
      guardarImpresora(true);
      estadoImpresora(t('Puerto elegido. Imprime la prueba.'), 'exito');
    } catch (error) { estadoImpresora(error.message || String(error), 'error'); }
  }

  async function elegirImpresoraBle() {
    try {
      impresora.nombreBle = await U.conCarga(impresora.bleElegir, window.Impresora.elegirBle());
      pintarImpresora();
      estadoImpresora(t('Impresora conectada: {nombre}', { nombre: impresora.nombreBle }), 'exito');
    } catch (error) { estadoImpresora(error.message || String(error), 'error'); }
  }

  function abrirBluetoothTelefono() {
    if (!window.Impresora.abrirBluetooth()) U.aviso('Abre los ajustes de Bluetooth del teléfono y vincula la impresora.', 'error');
    else estadoImpresora(t('Vincula la impresora y regresa a la app para tocar «Buscar vinculadas».'));
  }

  // ===========================================================================
  // WhatsApp
  // ===========================================================================

  var whatsapp = {
    formulario: $('formulario-whatsapp'), activo: $('whatsapp-activo'), phoneId: $('whatsapp-phone-id'),
    token: $('whatsapp-token'), tokenAyuda: $('whatsapp-token-ayuda'), plantilla: $('whatsapp-plantilla'),
    idioma: $('whatsapp-idioma'), lada: $('whatsapp-lada'), guardar: $('whatsapp-guardar'),
    telefonoPrueba: $('whatsapp-prueba-telefono'), probar: $('whatsapp-probar'), resultado: $('whatsapp-resultado'),
    conexion: $('whatsapp-conexion'), conexionResultado: $('whatsapp-conexion-resultado')
  };
  var bot = {
    formulario: $('formulario-bot'), activo: $('bot-activo'), bienvenida: $('bot-bienvenida'),
    urlPublica: $('bot-url-publica'), webhook: $('bot-webhook'), verificacion: $('bot-verificacion'),
    secreto: $('bot-secreto'), secretoAyuda: $('bot-secreto-ayuda'), guardar: $('bot-guardar'),
    mensaje: $('bot-mensaje'), simular: $('bot-simular'), chat: $('bot-chat'),
    chats: $('bot-chats'), chatsVacio: $('bot-chats-vacio'), actualizar: $('bot-actualizar'),
    ruta: '/api/whatsapp/webhook', local: ''
  };
  var CLAVE_URL_PUBLICA = 'engreidos.urlPublica';

  /** Datos de la conexión tal como se guardan (los usa también el formulario del bot). */
  function datosWhatsapp() {
    return {
      WhatsAppActivo: whatsapp.activo.checked, WhatsAppPhoneId: whatsapp.phoneId.value.trim(),
      WhatsAppToken: whatsapp.token.value.trim() || undefined, WhatsAppPlantillaCita: whatsapp.plantilla.value.trim(),
      WhatsAppIdiomaPlantilla: whatsapp.idioma.value.trim() || 'es_MX', LadaPais: whatsapp.lada.value.replace(/\D/g, '') || '52'
    };
  }

  /** URL que se pega en Meta: dirección pública + ruta del webhook. */
  function pintarWebhook() {
    var base = bot.urlPublica.value.trim().replace(/\/+$/, '');
    if (base && !/^https?:\/\//i.test(base)) base = 'https://' + base;
    bot.webhook.value = base ? base + bot.ruta : bot.local;
  }

  function pintarWhatsapp(c) {
    whatsapp.activo.checked = !!c.WhatsAppActivo;
    whatsapp.phoneId.value = c.WhatsAppPhoneId || '';
    whatsapp.plantilla.value = c.WhatsAppPlantillaCita || '';
    whatsapp.idioma.value = c.WhatsAppIdiomaPlantilla || 'es_MX';
    whatsapp.lada.value = c.LadaPais || '52';
    whatsapp.token.value = '';
    whatsapp.token.placeholder = c.TokenGuardado ? '••••••••••••' : '';
    whatsapp.tokenAyuda.textContent = t(c.TokenGuardado ? 'Hay un token guardado. Escribe uno nuevo solo si quieres reemplazarlo.' : 'Pega aquí el token permanente de tu app de Meta.');
    bot.activo.checked = !!c.BotActivo;
    bot.bienvenida.value = c.BotBienvenida || '';
    bot.verificacion.value = c.VerifyToken || '';
    bot.secreto.value = '';
    bot.secreto.placeholder = c.AppSecretGuardado ? '••••••••••••' : '';
    bot.secretoAyuda.textContent = t(c.AppSecretGuardado
      ? 'Hay una clave guardada: solo se aceptan mensajes firmados por Meta.'
      : 'Está en Meta → tu app → Configuración → Básica. Con ella el sistema comprueba que los mensajes vienen de Meta.');
    bot.ruta = c.RutaWebhook || bot.ruta;
    bot.local = c.WebhookLocal || '';
    pintarWebhook();
  }

  async function cargarWhatsapp() {
    try { bot.urlPublica.value = window.localStorage.getItem(CLAVE_URL_PUBLICA) || ''; } catch (e) { /* sin almacenamiento */ }
    try { pintarWhatsapp(await Api.whatsapp.obtener()); }
    catch (error) { U.aviso(error.message, 'error'); }
    cargarChats();
  }

  async function guardarWhatsapp(e) {
    e.preventDefault();
    try {
      pintarWhatsapp(await U.conCarga(whatsapp.guardar, Api.whatsapp.guardar(datosWhatsapp())));
      U.aviso('Configuración de WhatsApp guardada.');
      return true;
    } catch (error) { U.aviso(error.message, 'error'); return false; }
  }

  /** Comprueba el identificador y el token sin enviar mensajes. */
  async function probarConexionWhatsapp() {
    whatsapp.conexionResultado.className = 'ayuda';
    whatsapp.conexionResultado.textContent = '';
    try {
      // Se guarda primero para probar exactamente lo que está escrito.
      await Api.whatsapp.guardar(datosWhatsapp()).then(pintarWhatsapp);
      var r = await U.conCarga(whatsapp.conexion, Api.whatsapp.conexion());
      if (r.Conectado) {
        whatsapp.conexionResultado.className = 'ayuda ayuda--exito';
        whatsapp.conexionResultado.textContent = t('Conectado con el número {numero} ({nombre}).', { numero: r.Numero || '—', nombre: r.Nombre || '—' });
      } else {
        whatsapp.conexionResultado.className = 'ayuda ayuda--error';
        whatsapp.conexionResultado.textContent = t(r.Error || 'No se pudo conectar.');
      }
    } catch (error) { U.aviso(error.message, 'error'); }
  }

  async function probarWhatsapp() {
    var tel = whatsapp.telefonoPrueba.value.replace(/\D/g, '');
    if (tel.length !== 10) { U.aviso('El teléfono debe tener exactamente 10 dígitos.', 'error'); return; }
    whatsapp.resultado.className = 'ayuda';
    whatsapp.resultado.textContent = '';
    try {
      var r = await U.conCarga(whatsapp.probar, Api.whatsapp.probar(tel));
      if (r.Enviado) {
        whatsapp.resultado.className = 'ayuda ayuda--exito';
        whatsapp.resultado.textContent = t(r.Plantilla
          ? 'Mensaje enviado con la plantilla «hello_world» (ese número no ha escrito en las últimas 24 h).'
          : 'Mensaje enviado. Revisa WhatsApp en ese número.');
      } else {
        whatsapp.resultado.className = 'ayuda ayuda--error';
        whatsapp.resultado.textContent = r.Configurado
          ? t('No se pudo enviar: {e}', { e: t(r.Error || '—') })
          : t('La API no está configurada o está desactivada. Se abrirá WhatsApp con el mensaje.');
        if (!r.Configurado && r.Enlace) U.abrirExterno(r.Enlace);
      }
    } catch (error) { U.aviso(error.message, 'error'); }
  }

  // ---- Bot -------------------------------------------------------------------

  async function guardarBot(e) {
    e.preventDefault();
    var verificacion = bot.verificacion.value.trim();
    if (verificacion && !/^[\w.-]{6,80}$/.test(verificacion)) { U.aviso('El token de verificación solo lleva letras, números, guiones y puntos (mínimo 6).', 'error'); bot.verificacion.focus(); return; }
    try { window.localStorage.setItem(CLAVE_URL_PUBLICA, bot.urlPublica.value.trim()); } catch (err) { /* sin almacenamiento */ }
    try {
      pintarWhatsapp(await U.conCarga(bot.guardar, Api.whatsapp.guardar(Object.assign(datosWhatsapp(), {
        BotActivo: bot.activo.checked, BotBienvenida: bot.bienvenida.value.trim(),
        VerifyToken: verificacion || undefined, WhatsAppAppSecret: bot.secreto.value.trim() || undefined
      }))));
      U.aviso(bot.activo.checked ? 'Bot guardado y encendido.' : 'Bot guardado (apagado).');
    } catch (error) { U.aviso(error.message, 'error'); }
  }

  /** Globo de conversación. El texto de WhatsApp usa *negritas*. */
  function globo(contenedor, texto, deCliente, pie, pieError) {
    var g = document.createElement('div');
    g.className = 'chat-bot__globo chat-bot__globo--' + (deCliente ? 'cliente' : 'bot');
    g.setAttribute('translate', 'no');
    String(texto || '').split(/(\*[^*\n]+\*)/).forEach(function (parte) {
      if (/^\*[^*\n]+\*$/.test(parte)) { var b = document.createElement('strong'); b.textContent = parte.slice(1, -1); g.appendChild(b); }
      else g.appendChild(document.createTextNode(parte));
    });
    if (pie) {
      var p = document.createElement('span');
      p.className = 'chat-bot__pie' + (pieError ? ' chat-bot__pie--error' : '');
      p.textContent = pie;
      g.appendChild(p);
    }
    contenedor.appendChild(g);
    return g;
  }

  async function simularBot(texto) {
    var mensaje = (texto != null ? texto : bot.mensaje.value).trim();
    if (!mensaje) { bot.mensaje.focus(); return; }
    bot.chat.hidden = false;
    globo(bot.chat, mensaje, true);
    bot.mensaje.value = '';
    try {
      var r = await U.conCarga(bot.simular, Api.whatsapp.simular(mensaje));
      globo(bot.chat, r.Respuesta, false);
    } catch (error) { globo(bot.chat, error.message, false, t('Error'), true); }
    bot.chat.scrollTop = bot.chat.scrollHeight;
  }

  /** Mensajes reales recibidos y lo que contestó el bot. */
  async function cargarChats() {
    var lista = [];
    try { lista = (await Api.whatsapp.chats()) || []; } catch (error) { lista = []; }
    bot.chats.replaceChildren();
    lista.slice().reverse().forEach(function (c) {
      var entrante = !!Number(c.Entrante);
      var pie = U.formatoFecha(c.Fecha) + ' ' + U.formatoHora(c.Fecha) + ' · ' +
        (entrante ? (c.Nombre || '') + ' +' + c.Telefono : (c.Estado === 'Enviado' ? t('Enviado') : t('No se envió: {e}', { e: t(c.Estado || '—') })));
      globo(bot.chats, c.Texto, entrante, pie, !entrante && c.Estado !== 'Enviado');
    });
    bot.chats.hidden = !lista.length;
    bot.chatsVacio.hidden = !!lista.length;
    bot.chats.scrollTop = bot.chats.scrollHeight;
  }

  async function copiarCampo(id) {
    var campo = $(id);
    if (!campo.value) return;
    try { await navigator.clipboard.writeText(campo.value); }
    catch (e) { campo.select(); try { document.execCommand('copy'); } catch (e2) { /* se copia a mano */ } }
    U.aviso('Copiado.');
  }

  // ===========================================================================
  // Idioma
  // ===========================================================================

  function cargarIdiomas() {
    var contenedor = $('lista-idiomas');
    contenedor.replaceChildren();
    Object.keys(window.Idioma.IDIOMAS).forEach(function (codigo) {
      var etiqueta = document.createElement('label');
      etiqueta.className = 'opcion-radio';
      etiqueta.setAttribute('translate', 'no');
      var radio = document.createElement('input');
      radio.type = 'radio'; radio.name = 'idioma'; radio.value = codigo;
      radio.checked = codigo === window.Idioma.actual;
      radio.addEventListener('change', function () { window.Idioma.cambiar(codigo); });
      var texto = document.createElement('strong');
      texto.className = 'text-white';
      texto.textContent = window.Idioma.IDIOMAS[codigo].nombre + (codigo === 'es' ? ' (' + t('predeterminado') + ')' : '');
      etiqueta.append(radio, texto);
      contenedor.appendChild(etiqueta);
    });
  }

  // ===========================================================================
  // Servidor
  // ===========================================================================

  var servidor = {
    formulario: $('formulario-servidor'), actual: $('servidor-actual'), estado: $('servidor-estado'),
    direccion: $('servidor-direccion'), guardar: $('servidor-guardar'), automatico: $('servidor-automatico')
  };

  async function cargarServidor() {
    servidor.actual.textContent = CFG.SERVIDOR || t('Sin configurar');
    var enServidor = /^https?:$/.test(window.location.protocol);
    servidor.automatico.hidden = !enServidor || CFG.SERVIDOR === window.location.origin;
    servidor.estado.textContent = t('Comprobando…');
    servidor.estado.className = 'text-xs mt-1 texto-tenue';
    try {
      var r = await U.probarServidor(CFG.SERVIDOR);
      servidor.estado.textContent = t('En línea') + (r.version ? ' · v' + r.version : '');
      servidor.estado.className = 'text-xs mt-1 texto-exito';
    } catch (e) {
      servidor.estado.textContent = t('Sin conexión');
      servidor.estado.className = 'text-xs mt-1 texto-error';
    }
  }

  /** Guarda una nueva dirección (si responde) y cierra la sesión. */
  async function guardarServidor(e) {
    e.preventDefault();
    var url = U.normalizarServidor(servidor.direccion.value);
    if (!url) { U.aviso('Escribe la dirección del servidor, por ejemplo 192.168.1.70:3000.', 'error'); return; }
    try {
      await U.conCarga(servidor.guardar, U.probarServidor(url));
      cambiarServidor(url);
    } catch (error) { U.aviso(error.message, 'error'); }
  }

  function cambiarServidor(url) {
    window.guardarServidor(url);
    Sesion.borrar();
    U.aviso('Servidor guardado. Inicia sesión de nuevo.');
    setTimeout(function () { window.location.replace(CFG.PAGINA_LOGIN); }, 600);
  }

  // ===========================================================================
  // Arranque
  // ===========================================================================

  var CARGAR = {
    servicios: cargarServicios, productos: cargarProductos, membresias: cargarMembresias, descuentos: cargarDescuentos, cuentas: cargarCuentas,
    negocio: cargarNegocio, impresora: cargarImpresora, whatsapp: cargarWhatsapp, idioma: cargarIdiomas, servidor: cargarServidor
  };

  $('rol-ajustes').textContent = t(rol);
  aplicarRoles(document);
  dibujarCasillasDias(servicio.dias);

  window.addEventListener('hashchange', function () { abrirSeccion(window.location.hash.slice(1)); });
  $('volver-menu').addEventListener('click', volverAlMenu);
  var alCambiarAncho = function () { if (pantallaGrande.matches && contenedor.getAttribute('data-vista') === 'menu') abrirSeccion(''); };
  if (pantallaGrande.addEventListener) pantallaGrande.addEventListener('change', alCambiarAncho);
  else if (pantallaGrande.addListener) pantallaGrande.addListener(alCambiarAncho);

  // Formularios
  servicio.formulario.addEventListener('submit', guardarServicio);
  servicio.cancelar.addEventListener('click', limpiarServicio);
  producto.formulario.addEventListener('submit', guardarProducto);
  producto.cancelar.addEventListener('click', limpiarProducto);
  inventario.formulario.addEventListener('submit', confirmarInventario);
  membresia.formulario.addEventListener('submit', guardarMembresia);
  membresia.cancelar.addEventListener('click', limpiarMembresia);
  membresia.agregar.addEventListener('click', function () {
    var fila = agregarFila();
    fila.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    fila._c.aplica.focus();
  });
  membresia.agregarTexto.addEventListener('click', function () {
    var fila = agregarFila({ Aplica: 'Texto' });
    fila.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    fila._c.etiqueta.focus();
  });
  cuenta.formulario.addEventListener('submit', guardarCuenta);
  cuenta.formularioClave.addEventListener('submit', guardarContrasena);
  document.querySelectorAll('[data-rol]').forEach(function (b) {
    b.addEventListener('click', function () {
      cuenta.rol = b.getAttribute('data-rol');
      document.querySelectorAll('[data-rol]').forEach(function (o) { o.setAttribute('aria-pressed', String(o === b)); });
    });
  });
  negocio.formulario.addEventListener('submit', guardarNegocio);
  impresora.buscar.addEventListener('click', buscarImpresoras);
  impresora.guardar.addEventListener('click', guardarImpresora);
  impresora.prueba.addEventListener('click', pruebaImpresora);
  impresora.conexion.addEventListener('click', probarConexionImpresora);
  impresora.bluetooth.addEventListener('click', abrirBluetoothTelefono);
  impresora.serieElegir.addEventListener('click', elegirPuertoSerie);
  impresora.bleElegir.addEventListener('click', elegirImpresoraBle);
  impresora.velocidad.addEventListener('change', function () { guardarImpresora(true); });
  // Al regresar de los ajustes de Bluetooth se vuelve a buscar sola.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && !impresora.android.hidden && !impresora.seleccion && cargadas.impresora) buscarImpresoras();
  });
  whatsapp.formulario.addEventListener('submit', guardarWhatsapp);
  whatsapp.probar.addEventListener('click', probarWhatsapp);
  whatsapp.conexion.addEventListener('click', probarConexionWhatsapp);
  bot.formulario.addEventListener('submit', guardarBot);
  bot.urlPublica.addEventListener('input', pintarWebhook);
  bot.simular.addEventListener('click', function () { simularBot(); });
  bot.mensaje.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); simularBot(); } });
  document.querySelectorAll('[data-ejemplo]').forEach(function (b) { b.addEventListener('click', function () { simularBot(b.getAttribute('data-ejemplo')); }); });
  document.querySelectorAll('[data-copiar]').forEach(function (b) { b.addEventListener('click', function () { copiarCampo(b.getAttribute('data-copiar')); }); });
  bot.actualizar.addEventListener('click', cargarChats);
  descuento.formulario.addEventListener('submit', guardarDescuento);
  descuento.cancelar.addEventListener('click', limpiarDescuento);
  descuento.aplica.addEventListener('change', function () { llenarDetalleDescuento(''); });
  descuento.tipo.addEventListener('change', pintarTipoDescuento);
  pintarTipoDescuento();
  servidor.formulario.addEventListener('submit', guardarServidor);
  servidor.automatico.addEventListener('click', function () { cambiarServidor(null); });

  // Ventanas emergentes
  document.querySelectorAll('[data-cerrar-modal]').forEach(function (b) { b.addEventListener('click', cerrarModales); });
  document.querySelectorAll('.modal').forEach(function (m) {
    m.addEventListener('click', function (e) { if (e.target === m) cerrarModales(); });
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') cerrarModales(); });

  abrirSeccion(window.location.hash.slice(1));
})();
