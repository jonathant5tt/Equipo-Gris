/**
 * @file servicios/precios.js
 * @description Cálculo de una venta: precios del catálogo, beneficios de
 * membresía, existencias y nuevo vencimiento. Es la ÚNICA fuente de verdad de
 * los importes: la caja muestra lo que devuelve POST /ventas/calcular y al
 * cobrar se vuelve a calcular dentro de la transacción.
 *
 * Reglas de membresía:
 *  - Aplica la membresía vigente del cliente o la que se compra en esa misma
 *    venta (los beneficios se usan de inmediato).
 *  - Cada plan tiene una lista de beneficios (MEMBRESIA_BENEFICIO) sobre un
 *    servicio, un producto, una categoría de productos (ej. «Bebida») o todos
 *    los productos: «Gratis» o «Descuento %», ilimitados o con N usos por
 *    visita (por día) o por mes. El periodo mensual empieza el día del mes en
 *    que vence la membresía (vence 05/12 → periodo del 05/11 al 04/12).
 *  - Un mismo servicio puede tener varios beneficios (ej. «Cortes
 *    ilimitados» 1 por visita y «Corte para amigo» 1 por mes). Para cada
 *    pieza se usa el beneficio que más descuenta; a igual descuento, primero
 *    el ilimitado, luego el de la visita y al final el del mes, para no gastar
 *    los usos mensuales sin necesidad.
 *  - Si un renglón de productos usa beneficios distintos (ej. 3 bebidas: 2
 *    gratis y 1 con 20 %), se divide en varios renglones. Cada renglón
 *    indica en «Indice» el concepto del pedido del que viene.
 *  - Vencimiento al pagar una membresía:
 *      · vigente (vence hoy o después) → se suma al vencimiento actual
 *        (vence 05/12/2026, paga el 03/12 → 05/01/2027);
 *      · sin membresía o vencida → hoy + duración (paga 10/11 → 10/12).
 *  - Sin IVA: el total es subtotal − descuentos.
 */
'use strict';

const f = require('./fechas');
const { ErrorApi } = require('../middleware/errores');

const redondear = (n) => Math.round(n * 100) / 100;
const TIPOS = ['Servicio', 'Producto', 'Membresía'];

/** Texto para comparar categorías: sin acentos, espacios ni mayúsculas. */
const normalizar = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

/** ¿El beneficio aplica al renglón? */
function aplicaA(b, l) {
  if (l.TipoItem === 'Servicio') return b.Aplica === 'Servicio' && b.ID_Servicio === l.ID_Servicio;
  if (l.TipoItem !== 'Producto') return false;
  if (b.Aplica === 'Producto') return b.ID_Producto === l.ID_Producto;
  if (b.Aplica === 'Categoria') return !!l.Categoria && normalizar(b.Categoria) === normalizar(l.Categoria);
  return b.Aplica === 'Productos';
}

const ESCASEZ = (b) => (b.Usos == null ? 0 : b.Periodo === 'Visita' ? 1 : 2);
const ESPECIFICO = { Servicio: 0, Producto: 0, Categoria: 1, Productos: 2 };
const VALOR = (b) => (b.Tipo === 'Gratis' ? 100 : Number(b.Porcentaje));

/** Orden de uso: más descuento, ilimitado → por visita → por mes, más específico, orden del plan. */
function compararBeneficios(a, b) {
  return (VALOR(b) - VALOR(a)) || (ESCASEZ(a) - ESCASEZ(b)) ||
    (ESPECIFICO[a.Aplica] - ESPECIFICO[b.Aplica]) || (a.Orden - b.Orden) || (a.ID_Beneficio - b.ID_Beneficio);
}

/** «Premier · Corte para amigo: gratis (uso 1 de 1 del mes)». */
function textoUso(plan, b, hasta) {
  const nombre = b.Etiqueta ? `${plan} · ${b.Etiqueta}` : plan;
  const que = b.Tipo === 'Gratis' ? 'gratis' : `${Number(b.Porcentaje)} % de descuento`;
  if (b.Usos == null) return `${nombre}: ${que}`;
  return `${nombre}: ${que}` + (b.Periodo === 'Visita' ? ` (${hasta} de ${b.Usos} por visita)` : ` (uso ${hasta} de ${b.Usos} del mes)`);
}

/** «Premier: límite mensual alcanzado (2 de 2)». */
function textoLimite(plan, b) {
  const nombre = b.Etiqueta ? `${plan} · ${b.Etiqueta}` : plan;
  return `${nombre}: ${b.Periodo === 'Visita' ? 'límite por visita alcanzado' : 'límite mensual alcanzado'} (${b.Usos} de ${b.Usos})`;
}

/** ¿La membresía del cliente está vigente hoy? */
function membresiaVigente(cliente, hoy) {
  return !!(cliente && cliente.EstadoMembresia === 'Activa' && cliente.FechaVencimiento && cliente.FechaVencimiento >= hoy);
}

/**
 * Inicio del periodo mensual en curso de una membresía.
 * @param {string} vence  'AAAA-MM-DD'
 * @param {string} hoy
 */
function inicioPeriodo(vence, hoy) {
  let inicio = vence;
  while (inicio > hoy) inicio = f.sumarMeses(inicio, -1);
  return inicio;
}

/**
 * Calcula la venta.
 * @param {{consultar: Function, uno: Function}} db  Pool o transacción.
 * @param {{ID_Cliente?: number|null, Detalle: Array<Object>}} pedido
 * @param {{bloquear?: boolean}} [opciones]  bloquear = SELECT … FOR UPDATE (al cobrar).
 * @returns {Promise<Object>} { Lineas, Subtotal, Descuento, Total, Membresia, Cliente }
 */
/** Descuentos (promociones) activos y vigentes hoy. */
async function descuentosVigentes(db, hoy) {
  const filas = await db.consultar(
    `SELECT d.ID_Descuento, d.Nombre, d.Descripcion, d.Aplica, d.ID_Servicio, d.ID_Producto, d.Categoria, d.ID_Membresia,
            d.Tipo, d.Valor, d.FechaInicio, d.FechaFin, s.NombreServicio, p.NombreProducto, m.NombrePlan
       FROM DESCUENTO d
       LEFT JOIN SERVICIO s ON s.ID_Servicio = d.ID_Servicio
       LEFT JOIN PRODUCTO p ON p.ID_Producto = d.ID_Producto
       LEFT JOIN MEMBRESIA m ON m.ID_Membresia = d.ID_Membresia
      WHERE d.Eliminado = 0 AND d.Activo = 1
        AND (d.FechaInicio IS NULL OR d.FechaInicio <= ?) AND (d.FechaFin IS NULL OR d.FechaFin >= ?)
        AND (d.ID_Servicio IS NULL OR s.Activo = 1) AND (d.ID_Producto IS NULL OR p.Activo = 1)
        AND (d.ID_Membresia IS NULL OR m.Activo = 1)
      ORDER BY d.ID_Descuento`, [hoy, hoy]);
  return filas.map((d) => ({ ...d, Valor: Number(d.Valor) }));
}

/** ¿El descuento aplica al renglón? */
function descuentoAplica(d, l) {
  if (d.Aplica === 'Todo') return true;
  if (d.Aplica === 'Servicios') return l.TipoItem === 'Servicio' && (d.ID_Servicio == null || d.ID_Servicio === l.ID_Servicio);
  if (d.Aplica === 'Membresias') return l.TipoItem === 'Membresía' && (d.ID_Membresia == null || d.ID_Membresia === l.ID_Membresia);
  if (d.Aplica !== 'Productos' || l.TipoItem !== 'Producto') return false;
  if (d.ID_Producto != null) return d.ID_Producto === l.ID_Producto;
  if (d.Categoria) return !!l.Categoria && normalizar(d.Categoria) === normalizar(l.Categoria);
  return true;
}

/**
 * Mejor descuento para un renglón.
 * @returns {{d: Object, porPieza: number}|null}  porPieza = pesos que descuenta a cada pieza
 */
function mejorDescuento(descuentos, l) {
  let mejor = null;
  for (const d of descuentos) {
    if (!descuentoAplica(d, l)) continue;
    const porPieza = d.Tipo === 'Porcentaje' ? l.PrecioUnitario * Math.min(d.Valor, 100) / 100 : Math.min(d.Valor, l.PrecioUnitario);
    if (porPieza > 0 && (!mejor || porPieza > mejor.porPieza)) mejor = { d, porPieza };
  }
  return mejor;
}

/**
 * Plan cuyos beneficios recibe un cliente con membresía vigente. Si su plan se
 * eliminó y después se creó otro con el mismo nombre (ej. «Esencial»), se usa
 * el plan activo.
 * @param {Object} cliente  { ID_Membresia, NombrePlan, PlanActivo }
 * @returns {Promise<{ID_Membresia: number, NombrePlan: string}>}
 */
async function planDelCliente(db, cliente) {
  if (!Number(cliente.PlanActivo) && cliente.NombrePlan) {
    const igual = await db.uno(
      `SELECT ID_Membresia, NombrePlan FROM MEMBRESIA
        WHERE Activo = 1 AND LOWER(TRIM(NombrePlan)) = LOWER(TRIM(?)) ORDER BY ID_Membresia DESC LIMIT 1`, [cliente.NombrePlan]);
    if (igual) return igual;
  }
  return { ID_Membresia: cliente.ID_Membresia, NombrePlan: cliente.NombrePlan };
}

/** Beneficios de un plan, en su orden, con nombres de servicio y producto. */
async function beneficiosDelPlan(db, idMembresia) {
  const filas = await db.consultar(
    `SELECT b.ID_Beneficio, b.Aplica, b.ID_Servicio, s.NombreServicio, b.ID_Producto, p.NombreProducto,
            b.Categoria, b.Tipo, b.Porcentaje, b.Usos, b.Periodo, b.Etiqueta
       FROM MEMBRESIA_BENEFICIO b
       LEFT JOIN SERVICIO s ON s.ID_Servicio = b.ID_Servicio
       LEFT JOIN PRODUCTO p ON p.ID_Producto = b.ID_Producto
      WHERE b.ID_Membresia = ? ORDER BY b.Orden, b.ID_Beneficio`, [idMembresia]);
  return filas.map((b) => ({ ...b, Porcentaje: Number(b.Porcentaje) }));
}

/**
 * Membresía que se aplica hoy a un cliente, con sus beneficios (o null).
 * @param {number} idCliente
 */
async function membresiaDelCliente(db, idCliente) {
  const cliente = await db.uno(
    `SELECT c.EstadoMembresia, c.ID_Membresia, c.FechaVencimiento, m.NombrePlan, m.Activo AS PlanActivo
       FROM CLIENTE c LEFT JOIN MEMBRESIA m ON m.ID_Membresia = c.ID_Membresia WHERE c.ID_Cliente = ?`, [idCliente]);
  if (!cliente) throw new ErrorApi(404, 'El cliente no existe.');
  if (!membresiaVigente(cliente, f.hoy())) return null;
  const plan = await planDelCliente(db, cliente);
  return { ...plan, VenceActual: cliente.FechaVencimiento, Beneficios: await beneficiosDelPlan(db, plan.ID_Membresia) };
}

async function calcularVenta(db, pedido, opciones = {}) {
  const bloqueo = opciones.bloquear ? ' FOR UPDATE' : '';
  const hoy = f.hoy();
  const detalle = Array.isArray(pedido.Detalle) ? pedido.Detalle : [];
  if (!detalle.length) throw new ErrorApi(400, 'Agrega al menos un concepto.');
  if (detalle.length > 50) throw new ErrorApi(400, 'Demasiados conceptos en una sola venta.');

  // ---- Cliente --------------------------------------------------------------
  let cliente = null;
  if (pedido.ID_Cliente) {
    cliente = await db.uno(
      `SELECT c.ID_Cliente, c.Nombre, c.Lada, c.Telefono, c.EstadoMembresia, c.ID_Membresia,
              c.FechaInicio, c.FechaVencimiento, m.NombrePlan, m.Activo AS PlanActivo
         FROM CLIENTE c LEFT JOIN MEMBRESIA m ON m.ID_Membresia = c.ID_Membresia
        WHERE c.ID_Cliente = ?${bloqueo}`, [pedido.ID_Cliente]);
    if (!cliente) throw new ErrorApi(404, 'El cliente no existe.');
  }
  const vigente = membresiaVigente(cliente, hoy);

  // ---- Renglones: validar contra el catálogo --------------------------------
  const lineas = [];
  let compraMembresia = null;
  const citasUsadas = new Set();

  for (const [i, item] of detalle.entries()) {
    const tipo = item.TipoItem;
    if (!TIPOS.includes(tipo)) throw new ErrorApi(400, `Concepto ${i + 1}: tipo no válido.`);
    const cantidad = tipo === 'Producto' ? Number(item.Cantidad || 1) : 1;
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 999) throw new ErrorApi(400, `Concepto ${i + 1}: cantidad no válida.`);

    if (tipo === 'Servicio') {
      let idServicio = Number(item.ID_Servicio);
      let idBarbero = Number(item.ID_Barbero);
      let idCita = item.ID_Cita ? Number(item.ID_Cita) : null;
      if (idCita) {
        if (!cliente) throw new ErrorApi(400, 'Las citas pendientes solo se cobran con el cliente seleccionado.');
        if (citasUsadas.has(idCita)) throw new ErrorApi(400, 'La misma cita aparece dos veces.');
        const cita = await db.uno(
          `SELECT ID_Cita, ID_Servicio, ID_Barbero, Estado, ID_Venta, ID_Cliente FROM CITA WHERE ID_Cita = ?${bloqueo}`, [idCita]);
        if (!cita || cita.ID_Cliente !== cliente.ID_Cliente) throw new ErrorApi(400, 'La cita no corresponde a este cliente.');
        if (cita.ID_Venta) throw new ErrorApi(409, 'Esa cita ya fue cobrada.');
        if (cita.Estado !== 'Atendida') throw new ErrorApi(409, 'Solo se cobran citas atendidas.');
        citasUsadas.add(idCita);
        idServicio = cita.ID_Servicio;
        idBarbero = cita.ID_Barbero;
      }
      // Una cita pendiente se cobra aunque el servicio o el barbero se hayan dado de baja después.
      const soloActivos = idCita ? '' : ' AND Activo = 1';
      const servicio = await db.uno(`SELECT ID_Servicio, NombreServicio, Precio FROM SERVICIO WHERE ID_Servicio = ?${soloActivos}`, [idServicio]);
      if (!servicio) throw new ErrorApi(400, `Concepto ${i + 1}: el servicio no existe.`);
      const barbero = await db.uno(`SELECT ID_Barbero, Nombre FROM BARBERO WHERE ID_Barbero = ?${soloActivos}`, [idBarbero]);
      if (!barbero) throw new ErrorApi(400, `Concepto ${i + 1}: elige el barbero que realizó el servicio.`);
      lineas.push({
        Indice: i, TipoItem: tipo, ID_Servicio: servicio.ID_Servicio, NombreItem: servicio.NombreServicio,
        PrecioUnitario: Number(servicio.Precio), Cantidad: 1, ID_Barbero: barbero.ID_Barbero,
        NombreBarbero: barbero.Nombre, ID_Cita: idCita, Pendiente: !!idCita
      });
    } else if (tipo === 'Producto') {
      const producto = await db.uno(
        `SELECT ID_Producto, NombreProducto, Categoria, Precio, Stock FROM PRODUCTO WHERE ID_Producto = ? AND Activo = 1${bloqueo}`, [item.ID_Producto]);
      if (!producto) throw new ErrorApi(400, `Concepto ${i + 1}: el producto no existe.`);
      lineas.push({
        Indice: i, TipoItem: tipo, ID_Producto: producto.ID_Producto, NombreItem: producto.NombreProducto, Categoria: producto.Categoria,
        PrecioUnitario: Number(producto.Precio), Cantidad: cantidad, Stock: producto.Stock
      });
    } else {
      if (!cliente) throw new ErrorApi(400, 'Para vender una membresía selecciona o registra al cliente (no puede ser Cliente 0).');
      if (compraMembresia) throw new ErrorApi(400, 'Solo se puede vender una membresía por venta.');
      const plan = await db.uno(
        'SELECT ID_Membresia, NombrePlan, Precio, DuracionMeses FROM MEMBRESIA WHERE ID_Membresia = ? AND Activo = 1', [item.ID_Membresia]);
      if (!plan) throw new ErrorApi(400, 'La membresía no existe o ya no está disponible.');
      const base = vigente ? cliente.FechaVencimiento : hoy;
      compraMembresia = {
        ...plan,
        VenceNueva: f.sumarMeses(base, Number(plan.DuracionMeses)),
        InicioNuevo: vigente && cliente.FechaInicio ? cliente.FechaInicio : hoy,
        Renovacion: vigente
      };
      lineas.push({
        Indice: i, TipoItem: tipo, ID_Membresia: plan.ID_Membresia, NombreItem: `Membresía ${plan.NombrePlan}`,
        PrecioUnitario: Number(plan.Precio), Cantidad: 1, VenceMembresia: compraMembresia.VenceNueva
      });
    }
  }

  // ---- Existencias (sumando renglones del mismo producto) -------------------
  const porProducto = new Map();
  for (const l of lineas.filter((x) => x.TipoItem === 'Producto')) {
    const acumulado = (porProducto.get(l.ID_Producto) || 0) + l.Cantidad;
    porProducto.set(l.ID_Producto, acumulado);
    if (acumulado > l.Stock) {
      throw new ErrorApi(409, `Sin existencias suficientes de «${l.NombreItem}» (quedan ${l.Stock}).`);
    }
  }

  // ---- Membresía que aplica -------------------------------------------------
  let planAplicado = null;
  let periodo = null;
  if (compraMembresia) {
    planAplicado = compraMembresia;
    periodo = vigente ? inicioPeriodo(cliente.FechaVencimiento, hoy) : hoy;
  } else if (vigente) {
    planAplicado = await planDelCliente(db, cliente);
    periodo = inicioPeriodo(cliente.FechaVencimiento, hoy);
  }

  // Beneficios del plan y usos ya hechos (en el periodo mensual y hoy).
  let beneficios = [];
  const usosMes = new Map();
  const usosHoy = new Map();
  if (planAplicado) {
    beneficios = (await db.consultar(
      `SELECT ID_Beneficio, Aplica, ID_Servicio, ID_Producto, Categoria, Tipo, Porcentaje, Usos, Periodo, Etiqueta, Orden
         FROM MEMBRESIA_BENEFICIO
        WHERE ID_Membresia = ? AND Aplica <> 'Texto'`, [planAplicado.ID_Membresia]))
      .map((b) => ({ ...b, Porcentaje: Number(b.Porcentaje), Usos: b.Usos == null ? null : Number(b.Usos), Orden: Number(b.Orden) }));
    if (cliente && periodo) {
      const uso = await db.consultar(
        `SELECT d.ID_Beneficio, d.ID_Servicio, SUM(d.Cantidad) AS Usos,
                SUM(CASE WHEN DATE(v.FechaHoraCobro) = ? THEN d.Cantidad ELSE 0 END) AS Hoy
           FROM DETALLE_VENTA d JOIN VENTA v ON v.ID_Venta = d.ID_Venta
          WHERE v.ID_Cliente = ? AND d.UsaBeneficio = 1 AND DATE(v.FechaHoraCobro) >= ?
          GROUP BY d.ID_Beneficio, d.ID_Servicio`, [hoy, cliente.ID_Cliente, periodo < hoy ? periodo : hoy]);
      for (const u of uso) {
        let id = u.ID_Beneficio;
        // Ventas anteriores a la v3.2 (sin ID_Beneficio): cuentan para el beneficio mensual de ese servicio.
        if (id == null && u.ID_Servicio != null) {
          const b = beneficios.filter((x) => x.Aplica === 'Servicio' && x.ID_Servicio === u.ID_Servicio && x.Periodo === 'Mes').sort(compararBeneficios)[0];
          id = b ? b.ID_Beneficio : null;
        }
        if (id == null) continue;
        usosMes.set(id, (usosMes.get(id) || 0) + Number(u.Usos));
        usosHoy.set(id, (usosHoy.get(id) || 0) + Number(u.Hoy));
      }
    }
  }
  const usados = (b) => (b.Periodo === 'Visita' ? usosHoy : usosMes).get(b.ID_Beneficio) || 0;
  const sumar = (b, n) => {
    usosMes.set(b.ID_Beneficio, (usosMes.get(b.ID_Beneficio) || 0) + n);
    usosHoy.set(b.ID_Beneficio, (usosHoy.get(b.ID_Beneficio) || 0) + n);
  };

  // ---- Precios y descuentos -------------------------------------------------
  // Promociones activas y vigentes (Ajustes → Descuentos). Por pieza se usa el
  // mayor descuento entre la promoción y el beneficio de la membresía.
  const promociones = await descuentosVigentes(db, hoy);
  const resultado = [];
  for (const l of lineas) {
    delete l.Stock;
    const promo = mejorDescuento(promociones, l);
    const valorPromo = promo && l.PrecioUnitario > 0 ? promo.porPieza / l.PrecioUnitario * 100 : 0;
    const candidatos = planAplicado
      ? beneficios.filter((b) => aplicaA(b, l) && VALOR(b) > valorPromo).sort(compararBeneficios) : [];
    let restantes = l.Cantidad;
    let agotado = null;
    const partes = [];
    for (const b of candidatos) {
      if (!restantes) break;
      const ya = usados(b);
      const libres = b.Usos == null ? Infinity : b.Usos - ya;
      // Si no alcanza, se informa el último beneficio que se intentó (ej. «Corte para amigo»).
      if (libres <= 0) { agotado = b; continue; }
      const n = Math.min(restantes, libres);
      sumar(b, n);
      partes.push({ b, n, hasta: ya + n });
      restantes -= n;
      if (b.Usos != null && ya + n >= b.Usos && restantes) agotado = b;
    }
    if (restantes) partes.push({ b: null, n: restantes });

    for (const p of partes) {
      const r = { ...l, Cantidad: p.n, Descuento: 0, Beneficio: null, UsaBeneficio: false, ID_Beneficio: null, ID_Descuento: null };
      const bruto = redondear(r.PrecioUnitario * r.Cantidad);
      if (p.b) {
        r.Descuento = p.b.Tipo === 'Gratis' ? bruto : redondear(bruto * p.b.Porcentaje / 100);
        r.UsaBeneficio = true;
        r.ID_Beneficio = p.b.ID_Beneficio;
        r.Beneficio = textoUso(planAplicado.NombrePlan, p.b, p.hasta).slice(0, 255);
      } else if (promo) {
        r.Descuento = Math.min(bruto, redondear(promo.porPieza * r.Cantidad));
        r.ID_Descuento = promo.d.ID_Descuento;
        r.Beneficio = (`Descuento «${promo.d.Nombre}»` + (promo.d.Tipo === 'Porcentaje' ? `: ${Number(promo.d.Valor)} %` : '')).slice(0, 255);
      } else if (agotado) {
        r.Beneficio = textoLimite(planAplicado.NombrePlan, agotado).slice(0, 255);
      }
      r.Importe = redondear(bruto - r.Descuento);
      resultado.push(r);
    }
  }
  lineas.length = 0;
  lineas.push(...resultado);

  // Lista completa de beneficios del plan (para mostrarla en caja).
  const listaBeneficios = planAplicado ? await beneficiosDelPlan(db, planAplicado.ID_Membresia) : [];

  const subtotal = redondear(lineas.reduce((s, l) => s + l.PrecioUnitario * l.Cantidad, 0));
  const descuento = redondear(lineas.reduce((s, l) => s + l.Descuento, 0));

  return {
    Cliente: cliente,
    Lineas: lineas,
    Subtotal: subtotal,
    Descuento: descuento,
    Total: redondear(subtotal - descuento),
    Membresia: planAplicado ? {
      ID_Membresia: planAplicado.ID_Membresia,
      NombrePlan: planAplicado.NombrePlan,
      Origen: compraMembresia ? 'EnEstaVenta' : 'Vigente',
      VenceActual: vigente ? cliente.FechaVencimiento : null,
      VenceNueva: compraMembresia ? compraMembresia.VenceNueva : null,
      InicioNuevo: compraMembresia ? compraMembresia.InicioNuevo : null,
      Renovacion: compraMembresia ? compraMembresia.Renovacion : false,
      Beneficios: listaBeneficios
    } : null
  };
}

module.exports = { calcularVenta, membresiaVigente, membresiaDelCliente, descuentosVigentes, inicioPeriodo, redondear };
