/**
 * @file pruebas/apoyo/bd-memoria.js
 * @description Doble de prueba de «src/db.js»: una base de datos en memoria
 * que responde a las consultas SQL que usa el flujo principal (Happy Path):
 * sesión, clientes, agenda, cobro en caja y cierre de caja.
 *
 * Ofrece la misma interfaz que db.js: consultar(), uno() y transaccion().
 * Las transacciones se deshacen si el trabajo lanza un error (igual que
 * MySQL con ROLLBACK). Una consulta que no está simulada lanza un error para
 * que la prueba falle de forma visible en lugar de devolver datos falsos.
 */
'use strict';

const f = require('../../src/servicios/fechas');

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
const copia = (x) => JSON.parse(JSON.stringify(x));

/** Catálogo base de la barbería que usan todas las pruebas. */
function catalogoBase() {
  return {
    ADMINISTRADOR: [],
    CAJERO: [],
    BARBERO: [
      { ID_Barbero: 1, Nombre: 'Luis Barbero', Usuario: 'luis', Contrasena: '', Activo: 1,
        HoraEntrada: '10:00:00', HoraSalida: '20:00:00', ComidaInicio: '14:00:00', ComidaFin: '15:00:00', DiasTrabajo: 'L,M,X,J,V,S' }
    ],
    SERVICIO: [
      { ID_Servicio: 1, NombreServicio: 'Corte', Precio: 150, DuracionMin: 30, DiasDisponibles: null, Activo: 1 },
      { ID_Servicio: 2, NombreServicio: 'Barba', Precio: 100, DuracionMin: 30, DiasDisponibles: null, Activo: 1 },
      { ID_Servicio: 3, NombreServicio: 'Ritual Facial', Precio: 250, DuracionMin: 60, DiasDisponibles: 'S', Activo: 1 }
    ],
    PRODUCTO: [
      { ID_Producto: 10, NombreProducto: 'Agua natural', Categoria: 'Bebida', Precio: 25, Stock: 5, Activo: 1 },
      { ID_Producto: 11, NombreProducto: 'Cera mate', Categoria: 'Cuidado', Precio: 120, Stock: 2, Activo: 1 },
      { ID_Producto: 12, NombreProducto: 'Gel', Categoria: 'Cuidado', Precio: 14.5, Stock: 10, Activo: 1 }
    ],
    MEMBRESIA: [
      { ID_Membresia: 3, NombrePlan: 'Premier', Precio: 600, DuracionMeses: 1, Activo: 1 }
    ],
    MEMBRESIA_BENEFICIO: [
      { ID_Beneficio: 1, ID_Membresia: 3, Aplica: 'Servicio', ID_Servicio: 1, ID_Producto: null, Categoria: null,
        Tipo: 'Gratis', Porcentaje: 0, Usos: 1, Periodo: 'Visita', Etiqueta: 'Cortes ilimitados', Orden: 1 },
      { ID_Beneficio: 2, ID_Membresia: 3, Aplica: 'Categoria', ID_Servicio: null, ID_Producto: null, Categoria: 'Bebida',
        Tipo: 'Gratis', Porcentaje: 0, Usos: 1, Periodo: 'Visita', Etiqueta: '1 bebida por visita', Orden: 2 },
      { ID_Beneficio: 3, ID_Membresia: 3, Aplica: 'Productos', ID_Servicio: null, ID_Producto: null, Categoria: null,
        Tipo: 'Descuento', Porcentaje: 20, Usos: null, Periodo: null, Etiqueta: '20 % en productos', Orden: 3 },
      { ID_Beneficio: 4, ID_Membresia: 3, Aplica: 'Servicio', ID_Servicio: 2, ID_Producto: null, Categoria: null,
        Tipo: 'Gratis', Porcentaje: 0, Usos: 2, Periodo: 'Mes', Etiqueta: 'Barba 2 veces al mes', Orden: 4 },
      { ID_Beneficio: 5, ID_Membresia: 3, Aplica: 'Texto', ID_Servicio: null, ID_Producto: null, Categoria: null,
        Tipo: 'Gratis', Porcentaje: 0, Usos: null, Periodo: null, Etiqueta: 'Pase preferente', Orden: 5 }
    ],
    CLIENTE: [
      { ID_Cliente: 7, Nombre: 'Carlos Premier', Lada: '+52', Telefono: '2281110007', EstadoMembresia: 'Activa', ID_Membresia: 3,
        FechaInicio: '2026-10-05', FechaVencimiento: '2026-12-05', FechaRegistro: '2026-10-05 10:00:00',
        FotoCorteReferencia: null, Descripcion: null, Observaciones: null, FaltasConsecutivas: 0 },
      { ID_Cliente: 8, Nombre: 'Diego Nuevo', Lada: '+52', Telefono: '2281110008', EstadoMembresia: 'Inactiva', ID_Membresia: null,
        FechaInicio: null, FechaVencimiento: null, FechaRegistro: '2026-11-01 10:00:00',
        FotoCorteReferencia: null, Descripcion: null, Observaciones: null, FaltasConsecutivas: 0 }
    ],
    DESCUENTO: [],
    CITA: [],
    VENTA: [],
    DETALLE_VENTA: [],
    MOVIMIENTO_INVENTARIO: [],
    REEMBOLSO: [],
    CIERRE_CAJA: [],
    AVISO: [],
    ESTABLECIMIENTO: [{
      ID_Local: 1, NombreEstablecimiento: 'Engreídos Barbershop', Eslogan: null, Direccion: 'Xalapa, Ver.', Telefono: null,
      DatosFiscales: null, MensajeTicket: null, RedesSociales: null, FondoCaja: 500,
      EstadoServicio: 'Activo', MensajeMantenimiento: null, WhatsAppActivo: 0, WhatsAppPhoneId: null, WhatsAppToken: null,
      WhatsAppPlantillaCita: null, WhatsAppIdiomaPlantilla: null, LadaPais: '52', BotActivo: 0, BotBienvenida: null,
      WhatsAppVerifyToken: null, WhatsAppAppSecret: null
    }]
  };
}

const LLAVE = { ADMINISTRADOR: 'ID_Admin', CAJERO: 'ID_Cajero', BARBERO: 'ID_Barbero' };

/**
 * @param {(t: Object) => void} [preparar]  Ajusta las tablas antes de la prueba.
 */
function crearBdMemoria(preparar) {
  let t = catalogoBase();
  if (preparar) preparar(t);

  const registro = [];
  const siguiente = (tabla, campo) => t[tabla].reduce((m, x) => Math.max(m, x[campo]), 0) + 1;
  const insertar = (tabla, campo, fila) => {
    const id = siguiente(tabla, campo);
    t[tabla].push({ [campo]: id, ...fila });
    return { insertId: id, affectedRows: 1 };
  };
  const actualizar = (filas, cambio) => { filas.forEach(cambio); return { affectedRows: filas.length }; };
  const porId = (tabla, campo, id) => t[tabla].find((x) => x[campo] === Number(id)) || null;
  const ahoraTexto = () => { const a = f.ahora(); return `${a.fecha} ${a.hora}`; };
  const membresiaActiva = (c) => (c.EstadoMembresia === 'Activa' && c.FechaVencimiento && c.FechaVencimiento >= f.hoy() ? 1 : 0);

  const clienteCompleto = (c) => {
    const m = porId('MEMBRESIA', 'ID_Membresia', c.ID_Membresia);
    const activa = membresiaActiva(c);
    return { ...c, NombrePlan: m ? m.NombrePlan : null, MembresiaActiva: activa, EstadoMembresia: activa ? 'Activa' : 'Inactiva' };
  };
  const citaCompleta = (c) => {
    const cl = porId('CLIENTE', 'ID_Cliente', c.ID_Cliente);
    const b = porId('BARBERO', 'ID_Barbero', c.ID_Barbero);
    const s = porId('SERVICIO', 'ID_Servicio', c.ID_Servicio);
    return { ...c, NombreCliente: cl.Nombre, Lada: cl.Lada, TelefonoCliente: cl.Telefono, FotoCorteReferencia: cl.FotoCorteReferencia,
      NombreBarbero: b.Nombre, NombreServicio: s.NombreServicio, Precio: s.Precio };
  };
  const ventasFiltradas = (sql, p) => (/ID_Corte IS NULL/.test(sql)
    ? t.VENTA.filter((v) => v.ID_Corte == null) : t.VENTA.filter((v) => v.ID_Corte === Number(p[0])));
  const reembolsosFiltrados = (sql, p) => (/ID_Corte IS NULL/.test(sql)
    ? t.REEMBOLSO.filter((r) => r.ID_Corte == null) : t.REEMBOLSO.filter((r) => r.ID_Corte === Number(p[0])));

  /** [expresión, (parámetros, coincidencia, sql) => resultado] — de la más específica a la más general. */
  const reglas = [
    // ---- Cuentas y sesión ----------------------------------------------------
    [/^SELECT COUNT\(\*\) AS n FROM ADMINISTRADOR WHERE Activo = 1$/, () => [{ n: t.ADMINISTRADOR.filter((x) => x.Activo).length }]],
    [/^SELECT 1 FROM (ADMINISTRADOR|CAJERO|BARBERO) WHERE Usuario = \?$/, (p, m) => t[m[1]].filter((x) => x.Usuario === p[0]).map(() => ({ 1: 1 }))],
    [/^INSERT INTO ADMINISTRADOR \(Nombre, Usuario, Contrasena\)/, (p) => insertar('ADMINISTRADOR', 'ID_Admin', { Nombre: p[0], Usuario: p[1], Contrasena: p[2], Activo: 1 })],
    [/^SELECT (ID_\w+) AS id, Nombre, Usuario, Contrasena FROM (\w+) WHERE Usuario = \? AND Activo = 1$/,
      (p, m) => t[m[2]].filter((x) => x.Usuario === p[0] && x.Activo).map((x) => ({ id: x[m[1]], Nombre: x.Nombre, Usuario: x.Usuario, Contrasena: x.Contrasena }))],
    [/^SELECT Nombre FROM (ADMINISTRADOR|CAJERO|BARBERO) WHERE (ID_\w+) = \? AND Activo = 1$/,
      (p, m) => t[m[1]].filter((x) => x[LLAVE[m[1]]] === Number(p[0]) && x.Activo).map((x) => ({ Nombre: x.Nombre }))],
    [/^SELECT .* FROM ESTABLECIMIENTO WHERE ID_Local = 1$/, () => [t.ESTABLECIMIENTO[0]]],

    // ---- Clientes ------------------------------------------------------------
    [/^SELECT 1 FROM CLIENTE WHERE Telefono = \?$/, (p) => t.CLIENTE.filter((c) => c.Telefono === p[0]).map(() => ({ 1: 1 }))],
    [/^INSERT INTO CLIENTE \(Nombre, Lada, Telefono, Descripcion, Observaciones, EstadoMembresia\)/,
      (p) => insertar('CLIENTE', 'ID_Cliente', { Nombre: p[0], Lada: p[1], Telefono: p[2], Descripcion: p[3], Observaciones: p[4],
        EstadoMembresia: 'Inactiva', ID_Membresia: null, FechaInicio: null, FechaVencimiento: null, FechaRegistro: ahoraTexto(),
        FotoCorteReferencia: null, FaltasConsecutivas: 0 })],
    [/^SELECT c\.ID_Cliente, c\.Nombre, c\.Lada, c\.Telefono, c\.FotoCorteReferencia, .* WHERE c\.ID_Cliente = \?$/,
      (p) => t.CLIENTE.filter((c) => c.ID_Cliente === Number(p[0])).map(clienteCompleto)],
    [/^SELECT c\.ID_Cliente, c\.Nombre, c\.Lada, c\.Telefono, c\.EstadoMembresia, .* WHERE c\.ID_Cliente = \?( FOR UPDATE)?$/,
      (p) => t.CLIENTE.filter((c) => c.ID_Cliente === Number(p[0])).map((c) => {
        const m = porId('MEMBRESIA', 'ID_Membresia', c.ID_Membresia);
        return { ...c, NombrePlan: m ? m.NombrePlan : null, PlanActivo: m ? m.Activo : null };
      })],
    [/^SELECT ID_Cliente FROM CLIENTE WHERE ID_Cliente = \?$/, (p) => t.CLIENTE.filter((c) => c.ID_Cliente === Number(p[0]))],
    [/^UPDATE CLIENTE SET FaltasConsecutivas = 0 WHERE ID_Cliente = \?$/,
      (p) => actualizar(t.CLIENTE.filter((c) => c.ID_Cliente === Number(p[0])), (c) => { c.FaltasConsecutivas = 0; })],
    [/^UPDATE CLIENTE SET FaltasConsecutivas = FaltasConsecutivas \+ 1 WHERE ID_Cliente = \?$/,
      (p) => actualizar(t.CLIENTE.filter((c) => c.ID_Cliente === Number(p[0])), (c) => { c.FaltasConsecutivas += 1; })],
    [/^UPDATE CLIENTE SET EstadoMembresia = 'Activa', ID_Membresia = \?, FechaInicio = \?, FechaVencimiento = \? WHERE ID_Cliente = \?$/,
      (p) => actualizar(t.CLIENTE.filter((c) => c.ID_Cliente === Number(p[3])), (c) => {
        Object.assign(c, { EstadoMembresia: 'Activa', ID_Membresia: p[0], FechaInicio: p[1], FechaVencimiento: p[2] });
      })],

    // ---- Catálogo ------------------------------------------------------------
    [/^SELECT ID_Servicio, NombreServicio, Precio, DuracionMin, DiasDisponibles FROM SERVICIO WHERE ID_Servicio = \? AND Activo = 1$/,
      (p) => t.SERVICIO.filter((s) => s.ID_Servicio === Number(p[0]) && s.Activo)],
    [/^SELECT ID_Servicio, NombreServicio, Precio FROM SERVICIO WHERE ID_Servicio = \?( AND Activo = 1)?$/,
      (p, m) => t.SERVICIO.filter((s) => s.ID_Servicio === Number(p[0]) && (!m[1] || s.Activo))],
    [/^SELECT ID_Barbero FROM BARBERO WHERE ID_Barbero = \? FOR UPDATE$/, (p) => t.BARBERO.filter((b) => b.ID_Barbero === Number(p[0]))],
    [/^SELECT ID_Barbero, Nombre FROM BARBERO WHERE ID_Barbero = \?( AND Activo = 1)?$/,
      (p, m) => t.BARBERO.filter((b) => b.ID_Barbero === Number(p[0]) && (!m[1] || b.Activo))],
    [/^SELECT ID_Barbero, Nombre, HoraEntrada, HoraSalida, ComidaInicio, ComidaFin, DiasTrabajo FROM BARBERO WHERE ID_Barbero = \? AND Activo = 1$/,
      (p) => t.BARBERO.filter((b) => b.ID_Barbero === Number(p[0]) && b.Activo)],
    [/^SELECT ID_Producto, NombreProducto, Categoria, Precio, Stock FROM PRODUCTO WHERE ID_Producto = \? AND Activo = 1( FOR UPDATE)?$/,
      (p) => t.PRODUCTO.filter((x) => x.ID_Producto === Number(p[0]) && x.Activo)],
    [/^UPDATE PRODUCTO SET Stock = Stock - \? WHERE ID_Producto = \? AND Stock >= \?$/,
      (p) => actualizar(t.PRODUCTO.filter((x) => x.ID_Producto === Number(p[1]) && x.Stock >= p[2]), (x) => { x.Stock -= p[0]; })],
    [/^SELECT Stock FROM PRODUCTO WHERE ID_Producto = \?$/, (p) => t.PRODUCTO.filter((x) => x.ID_Producto === Number(p[0])).map((x) => ({ Stock: x.Stock }))],
    [/^INSERT INTO MOVIMIENTO_INVENTARIO/, (p) => insertar('MOVIMIENTO_INVENTARIO', 'ID_Movimiento',
      { ID_Producto: p[0], Tipo: 'Venta', Cantidad: p[1], StockFinal: p[2], Motivo: p[3], RealizadoPor: p[4], ID_Venta: p[5] })],

    // ---- Membresías, beneficios y promociones --------------------------------
    [/^SELECT ID_Membresia, NombrePlan, Precio, DuracionMeses FROM MEMBRESIA WHERE ID_Membresia = \? AND Activo = 1$/,
      (p) => t.MEMBRESIA.filter((m) => m.ID_Membresia === Number(p[0]) && m.Activo)],
    [/^SELECT ID_Membresia, NombrePlan FROM MEMBRESIA WHERE Activo = 1 AND LOWER\(TRIM\(NombrePlan\)\) = LOWER\(TRIM\(\?\)\)/,
      (p) => t.MEMBRESIA.filter((m) => m.Activo && m.NombrePlan.trim().toLowerCase() === String(p[0]).trim().toLowerCase())
        .sort((a, b) => b.ID_Membresia - a.ID_Membresia).slice(0, 1).map((m) => ({ ID_Membresia: m.ID_Membresia, NombrePlan: m.NombrePlan }))],
    [/^SELECT ID_Beneficio, Aplica, .* FROM MEMBRESIA_BENEFICIO WHERE ID_Membresia = \? AND Aplica <> 'Texto'$/,
      (p) => t.MEMBRESIA_BENEFICIO.filter((b) => b.ID_Membresia === Number(p[0]) && b.Aplica !== 'Texto').map(copia)],
    [/^SELECT b\.ID_Beneficio, b\.Aplica, .* FROM MEMBRESIA_BENEFICIO b .* WHERE b\.ID_Membresia = \? ORDER BY/,
      (p) => t.MEMBRESIA_BENEFICIO.filter((b) => b.ID_Membresia === Number(p[0])).sort((a, b) => a.Orden - b.Orden).map((b) => ({
        ...b,
        NombreServicio: (porId('SERVICIO', 'ID_Servicio', b.ID_Servicio) || {}).NombreServicio || null,
        NombreProducto: (porId('PRODUCTO', 'ID_Producto', b.ID_Producto) || {}).NombreProducto || null
      }))],
    [/^SELECT d\.ID_Beneficio, d\.ID_Servicio, SUM\(d\.Cantidad\) AS Usos/, (p) => {
      const [hoy, idCliente, desde] = p;
      const grupos = new Map();
      for (const d of t.DETALLE_VENTA) {
        const v = porId('VENTA', 'ID_Venta', d.ID_Venta);
        const dia = v.FechaHoraCobro.slice(0, 10);
        if (v.ID_Cliente !== idCliente || !d.UsaBeneficio || dia < desde) continue;
        const k = `${d.ID_Beneficio}|${d.ID_Servicio}`;
        const g = grupos.get(k) || { ID_Beneficio: d.ID_Beneficio, ID_Servicio: d.ID_Servicio, Usos: 0, Hoy: 0 };
        g.Usos += d.Cantidad;
        if (dia === hoy) g.Hoy += d.Cantidad;
        grupos.set(k, g);
      }
      return [...grupos.values()];
    }],
    [/^SELECT d\.ID_Descuento, d\.Nombre, .* FROM DESCUENTO d/, (p) => t.DESCUENTO
      .filter((d) => !d.Eliminado && d.Activo && (!d.FechaInicio || d.FechaInicio <= p[0]) && (!d.FechaFin || d.FechaFin >= p[1]))
      .map((d) => ({ ...d, NombreServicio: null, NombreProducto: null, NombrePlan: null }))],

    // ---- Citas ---------------------------------------------------------------
    [/^SELECT c\.ID_Cita, TIME\(c\.FechaHora\) AS Hora, c\.DuracionMin, c\.Estado, c\.Origen,/, (p) => {
      const activos = ['Agendada', 'EnEspera', 'EnAtencion', 'Atendida'];
      return t.CITA.filter((c) => c.ID_Barbero === Number(p[0]) && c.FechaHora.slice(0, 10) === p[1] &&
        activos.includes(c.Estado) && c.ID_Cita !== Number(p[2]))
        .sort((a, b) => a.FechaHora.localeCompare(b.FechaHora))
        .map((c) => ({ ...citaCompleta(c), Hora: c.FechaHora.slice(11, 19) }));
    }],
    [/^SELECT ID_Cita, ID_Servicio, ID_Barbero, Estado, ID_Venta, ID_Cliente FROM CITA WHERE ID_Cita = \?( FOR UPDATE)?$/,
      (p) => t.CITA.filter((c) => c.ID_Cita === Number(p[0]))],
    [/^INSERT INTO CITA \(FechaHora, DuracionMin, Estado, Origen, ID_Cliente, ID_Barbero, ID_Servicio\)/,
      (p) => insertar('CITA', 'ID_Cita', { FechaHora: p[0], DuracionMin: p[1], Estado: 'Agendada', Origen: p[2],
        ID_Cliente: p[3], ID_Barbero: p[4], ID_Servicio: p[5], ID_Venta: null, Notificada: 0 })],
    [/^INSERT INTO AVISO/, (p) => insertar('AVISO', 'ID_Aviso', { ID_Barbero: p[0], Tipo: p[1], Mensaje: p[2] })],
    [/^SELECT c\.ID_Cita, c\.FechaHora, c\.DuracionMin, .* WHERE c\.ID_Cita = \?$/,
      (p) => t.CITA.filter((c) => c.ID_Cita === Number(p[0])).map(citaCompleta)],
    [/^UPDATE CITA SET Estado = \? WHERE ID_Cita = \? AND Estado = \?$/,
      (p) => actualizar(t.CITA.filter((c) => c.ID_Cita === Number(p[1]) && c.Estado === p[2]), (c) => { c.Estado = p[0]; })],
    [/^UPDATE CITA SET ID_Venta = \? WHERE ID_Cita = \? AND ID_Venta IS NULL$/,
      (p) => actualizar(t.CITA.filter((c) => c.ID_Cita === Number(p[1]) && c.ID_Venta == null), (c) => { c.ID_Venta = p[0]; })],
    [/^UPDATE CITA SET Notificada = 1 WHERE ID_Cita = \?$/,
      (p) => actualizar(t.CITA.filter((c) => c.ID_Cita === Number(p[0])), (c) => { c.Notificada = 1; })],

    // ---- Ventas ----------------------------------------------------------------
    [/^INSERT INTO VENTA \(Subtotal, Descuento, ImporteTotal, MetodoPago, MontoRecibido, Cambio,/,
      (p) => insertar('VENTA', 'ID_Venta', { Subtotal: p[0], Descuento: p[1], ImporteTotal: p[2], MetodoPago: p[3], MontoRecibido: p[4],
        Cambio: p[5], ID_Cliente: p[6], ID_Cajero: p[7], ID_Admin: p[8], CobradoPor: p[9], FechaHoraCobro: ahoraTexto(),
        NumeroFactura: null, ID_Corte: null })],
    [/^UPDATE VENTA SET NumeroFactura = CONCAT/, (p) => actualizar(t.VENTA.filter((v) => v.ID_Venta === Number(p[0])), (v) => {
      v.NumeroFactura = `T-${v.FechaHoraCobro.slice(0, 4)}-${String(v.ID_Venta).padStart(6, '0')}`;
    })],
    [/^INSERT INTO DETALLE_VENTA \(ID_Venta, TipoItem, NombreItem, PrecioUnitario, Cantidad, Descuento, Importe,/, (p) => {
      const campos = ['ID_Venta', 'TipoItem', 'NombreItem', 'PrecioUnitario', 'Cantidad', 'Descuento', 'Importe', 'Beneficio', 'UsaBeneficio',
        'ID_Beneficio', 'ID_Descuento', 'ID_Servicio', 'ID_Producto', 'ID_Membresia', 'ID_Barbero', 'ID_Cita', 'VenceMembresia'];
      return insertar('DETALLE_VENTA', 'ID_Detalle', Object.fromEntries(campos.map((c, i) => [c, p[i]])));
    }],
    [/^SELECT v\.\*, c\.Nombre AS NombreCliente/, (p) => t.VENTA.filter((v) => v.ID_Venta === Number(p[0])).map((v) => {
      const c = porId('CLIENTE', 'ID_Cliente', v.ID_Cliente);
      const m = c && porId('MEMBRESIA', 'ID_Membresia', c.ID_Membresia);
      return { ...v, NombreCliente: c ? c.Nombre : null, Lada: c ? c.Lada : null, TelefonoCliente: c ? c.Telefono : null,
        ClienteConMembresia: c ? membresiaActiva(c) : 0, PlanCliente: m ? m.NombrePlan : null, VenceMembresiaCliente: c ? c.FechaVencimiento : null };
    })],
    [/^SELECT d\.\*, b\.Nombre AS NombreBarbero FROM DETALLE_VENTA d/, (p) => t.DETALLE_VENTA.filter((d) => d.ID_Venta === Number(p[0]))
      .map((d) => ({ ...d, NombreBarbero: (porId('BARBERO', 'ID_Barbero', d.ID_Barbero) || {}).Nombre || null }))],
    [/^SELECT ID_Reembolso, Fecha, Monto, MetodoDevolucion, Motivo FROM REEMBOLSO WHERE ID_Venta = \?/,
      (p) => t.REEMBOLSO.filter((r) => r.ID_Venta === Number(p[0]))],

    // ---- Cierre de caja --------------------------------------------------------
    [/^SELECT v\.ID_Venta, v\.NumeroFactura, v\.FechaHoraCobro, v\.Subtotal, .* FROM VENTA v .* WHERE v\.ID_Corte/,
      (p, m, sql) => ventasFiltradas(sql, p).map((v) => ({ ID_Venta: v.ID_Venta, NumeroFactura: v.NumeroFactura, FechaHoraCobro: v.FechaHoraCobro,
        Subtotal: v.Subtotal, ImporteTotal: v.ImporteTotal, Descuento: v.Descuento, MetodoPago: v.MetodoPago, CobradoPor: v.CobradoPor,
        NombreCliente: (porId('CLIENTE', 'ID_Cliente', v.ID_Cliente) || { Nombre: 'Cliente 0' }).Nombre }))],
    [/^SELECT d\.ID_Venta, d\.TipoItem, d\.NombreItem, d\.Cantidad, d\.Importe, d\.Descuento, b\.Nombre AS NombreBarbero FROM DETALLE_VENTA d .* WHERE d\.ID_Venta IN \(\?\)/,
      (p) => t.DETALLE_VENTA.filter((d) => p[0].includes(d.ID_Venta)).map((d) => ({ ID_Venta: d.ID_Venta, TipoItem: d.TipoItem,
        NombreItem: d.NombreItem, Cantidad: d.Cantidad, Importe: d.Importe, Descuento: d.Descuento,
        NombreBarbero: (porId('BARBERO', 'ID_Barbero', d.ID_Barbero) || {}).Nombre || null }))],
    [/^SELECT r\.ID_Reembolso, .* FROM REEMBOLSO r .* WHERE r\.ID_Corte/, (p, m, sql) => reembolsosFiltrados(sql, p).map(copia)],
    [/^INSERT INTO CIERRE_CAJA \(/, (p) => {
      const campos = ['NumeroVentas', 'TotalIngresos', 'TotalEfectivo', 'TotalTarjeta', 'TotalTransferencia', 'FondoInicial', 'EfectivoContado',
        'Diferencia', 'ID_Cajero', 'ID_Admin', 'RealizadoPor', 'Desde', 'VentasBrutas', 'TotalDescuentos', 'NumeroReembolsos',
        'TotalReembolsos', 'ReembolsosEfectivo', 'Arqueo', 'Observaciones'];
      return insertar('CIERRE_CAJA', 'ID_Corte', { ...Object.fromEntries(campos.map((c, i) => [c, p[i]])), FechaCorte: ahoraTexto() });
    }],
    [/^UPDATE VENTA SET ID_Corte = \? WHERE ID_Venta IN \(\?\)$/,
      (p) => actualizar(t.VENTA.filter((v) => p[1].includes(v.ID_Venta)), (v) => { v.ID_Corte = p[0]; })],
    [/^UPDATE REEMBOLSO SET ID_Corte = \? WHERE ID_Reembolso IN \(\?\)$/,
      (p) => actualizar(t.REEMBOLSO.filter((r) => p[1].includes(r.ID_Reembolso)), (r) => { r.ID_Corte = p[0]; })],
    [/^SELECT \* FROM CIERRE_CAJA WHERE ID_Corte = \?$/, (p) => t.CIERRE_CAJA.filter((c) => c.ID_Corte === Number(p[0]))]
  ];

  async function ejecutar(sql, parametros = []) {
    const texto = norm(sql);
    registro.push({ sql: texto, parametros });
    for (const [expresion, responder] of reglas) {
      const m = expresion.exec(texto);
      if (m) return copia(responder(parametros, m, texto));
    }
    throw new Error(`Consulta no simulada en bd-memoria: ${texto.slice(0, 160)}`);
  }

  const bd = {
    /** Tablas (para revisar el estado al final de una prueba). */
    get tablas() { return t; },
    /** Consultas ejecutadas, en orden. */
    registro,
    consultar: ejecutar,
    async uno(sql, parametros) {
      const r = await ejecutar(sql, parametros);
      return Array.isArray(r) ? (r[0] || null) : r;
    },
    /** Igual que db.transaccion: si el trabajo falla, se restauran las tablas (ROLLBACK). */
    async transaccion(trabajo) {
      const respaldo = copia(t);
      try {
        return await trabajo(bd);
      } catch (error) {
        t = respaldo;
        throw error;
      }
    }
  };
  return bd;
}

module.exports = { crearBdMemoria, catalogoBase };
