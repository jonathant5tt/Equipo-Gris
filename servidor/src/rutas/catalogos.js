/**
 * @file rutas/catalogos.js
 * @description Catálogos: servicios, productos (con inventario) y membresías.
 *
 * Servicios
 *   GET    /api/servicios                 C D B   Activos
 *   POST   /api/servicios                 D       { NombreServicio, Precio, DuracionMin, DiasDisponibles?, Descripcion? }
 *   PUT    /api/servicios/:id             D
 *   DELETE /api/servicios/:id             D       Baja lógica
 * Productos
 *   GET    /api/productos                 C D B
 *   POST   /api/productos                 D       { NombreProducto, Categoria?, Precio, Stock, Descripcion? }
 *   PUT    /api/productos/:id             D       { NombreProducto, Categoria?, Precio, Descripcion? }
 *   DELETE /api/productos/:id             D       Baja lógica
 *   POST   /api/productos/:id/entrada     C D     { Cantidad, Motivo? }          Agregar inventario
 *   POST   /api/productos/:id/baja        C D     { Cantidad, Motivo, Contrasena } Dar de baja existencias
 *   GET    /api/productos/:id/movimientos C D     Bitácora de inventario
 * Membresías
 *   GET    /api/membresias                C D B   Con sus beneficios
 *   POST   /api/membresias                D       { NombrePlan, Precio, DuracionMeses, Descripcion?, Beneficios[] }
 *   PUT    /api/membresias/:id            D       (conserva los usos de los beneficios que no cambian)
 *   DELETE /api/membresias/:id            D       Baja lógica
 *
 * Beneficio: {
 *   ID_Beneficio?,                          (al editar, para conservar sus usos del mes)
 *   Aplica: 'Servicio'|'Producto'|'Categoria'|'Productos'|'Texto',
 *   ID_Servicio?, ID_Producto?, Categoria?,  (según Aplica)
 *   Tipo: 'Gratis'|'Descuento', Porcentaje,  ('Productos' solo admite Descuento)
 *   Usos: N|null (null = ilimitado), Periodo: 'Visita'|'Mes',
 *   Etiqueta?                               (texto que se muestra; obligatorio en 'Texto')
 * }
 * Ejemplos (plan «Supremo»):
 *   { Aplica:'Servicio',  ID_Servicio:1, Tipo:'Gratis', Usos:1, Periodo:'Visita', Etiqueta:'Cortes ilimitados' }
 *   { Aplica:'Categoria', Categoria:'Bebida', Tipo:'Gratis', Usos:2, Periodo:'Visita', Etiqueta:'2 bebidas' }
 *   { Aplica:'Productos', Tipo:'Descuento', Porcentaje:20, Etiqueta:'20 % en productos' }
 *   { Aplica:'Servicio',  ID_Servicio:1, Tipo:'Gratis', Usos:1, Periodo:'Mes', Etiqueta:'Corte para amigo' }
 *   { Aplica:'Texto', Etiqueta:'Acceso preferente limitado' }
 */
'use strict';

const express = require('../lib/web');
const db = require('../db');
const v = require('../servicios/validar');
const contrasenas = require('../seguridad/contrasenas');
const { ROLES, TABLA_ROL, requiereSesion, permitir, firma } = require('../middleware/autenticacion');
const { ErrorApi, envolver } = require('../middleware/errores');

const router = express.Router();
router.use(requiereSesion);
const soloDueno = permitir(ROLES.DUENO);
const caja = permitir(ROLES.DUENO, ROLES.CAJERO);

// =============================================================================
// Servicios
// =============================================================================

function datosServicio(b) {
  return [
    v.texto(b.NombreServicio, 'El nombre del servicio', { min: 2, max: 100, obligatorio: true }),
    v.textoLargo(b.Descripcion, 'La descripción', 255),
    v.importe(b.Precio, 'El precio'),
    v.entero(b.DuracionMin == null || b.DuracionMin === '' ? 30 : b.DuracionMin, 'La duración', { min: 10, max: 480 }),
    v.dias(b.DiasDisponibles, 'Días disponibles')
  ];
}

router.get('/servicios', envolver(async (req, res) => {
  res.json(await db.consultar(
    `SELECT ID_Servicio, NombreServicio, Descripcion, Precio, DuracionMin, DiasDisponibles
       FROM SERVICIO WHERE Activo = 1 ORDER BY NombreServicio`));
}));

/**
 * Evita dos registros activos con el mismo nombre (ej. dos «Corte clásico»),
 * que confunden al elegir beneficios o al cobrar.
 */
async function nombreLibre(tabla, campo, nombre, idCampo, id, mensaje) {
  const otro = await db.uno(
    `SELECT ${idCampo} AS id FROM ${tabla} WHERE Activo = 1 AND LOWER(TRIM(${campo})) = LOWER(TRIM(?))${id ? ` AND ${idCampo} <> ?` : ''} LIMIT 1`,
    id ? [nombre, id] : [nombre]);
  if (otro) throw new ErrorApi(409, mensaje);
}

router.post('/servicios', soloDueno, envolver(async (req, res) => {
  const datos = datosServicio(req.body || {});
  await nombreLibre('SERVICIO', 'NombreServicio', datos[0], 'ID_Servicio', null, 'Ya existe un servicio con ese nombre.');
  const r = await db.consultar(
    'INSERT INTO SERVICIO (NombreServicio, Descripcion, Precio, DuracionMin, DiasDisponibles) VALUES (?, ?, ?, ?, ?)', datos);
  res.status(201).json(await db.uno('SELECT * FROM SERVICIO WHERE ID_Servicio = ?', [r.insertId]));
}));

router.put('/servicios/:id', soloDueno, envolver(async (req, res) => {
  const datos = datosServicio(req.body || {});
  await nombreLibre('SERVICIO', 'NombreServicio', datos[0], 'ID_Servicio', req.params.id, 'Ya existe un servicio con ese nombre.');
  const r = await db.consultar(
    `UPDATE SERVICIO SET NombreServicio = ?, Descripcion = ?, Precio = ?, DuracionMin = ?, DiasDisponibles = ?
      WHERE ID_Servicio = ? AND Activo = 1`, [...datos, req.params.id]);
  if (!r.affectedRows) throw new ErrorApi(404, 'El servicio no existe.');
  res.json(await db.uno('SELECT * FROM SERVICIO WHERE ID_Servicio = ?', [req.params.id]));
}));

router.delete('/servicios/:id', soloDueno, envolver(async (req, res) => {
  const r = await db.consultar('UPDATE SERVICIO SET Activo = 0 WHERE ID_Servicio = ? AND Activo = 1', [req.params.id]);
  if (!r.affectedRows) throw new ErrorApi(404, 'El servicio no existe.');
  // Ya no se ofrece como beneficio de ninguna membresía.
  await db.consultar('DELETE FROM MEMBRESIA_BENEFICIO WHERE ID_Servicio = ?', [req.params.id]);
  res.status(204).end();
}));

// =============================================================================
// Productos e inventario
// =============================================================================

/** Categoría opcional de un producto (ej. «Bebida»). */
const categoria = (valor) => v.texto(valor, 'La categoría', { min: 2, max: 40 });

router.get('/productos', envolver(async (req, res) => {
  res.json(await db.consultar(
    `SELECT ID_Producto, NombreProducto, Categoria, Precio, Descripcion, FotoProducto, Stock
       FROM PRODUCTO WHERE Activo = 1 ORDER BY NombreProducto`));
}));

router.post('/productos', soloDueno, envolver(async (req, res) => {
  const b = req.body || {};
  const nombre = v.texto(b.NombreProducto, 'El nombre del producto', { min: 2, max: 100, obligatorio: true });
  const precio = v.importe(b.Precio, 'El precio');
  const stock = v.entero(b.Stock == null || b.Stock === '' ? 0 : b.Stock, 'La cantidad', { min: 0, max: 100000 });
  await nombreLibre('PRODUCTO', 'NombreProducto', nombre, 'ID_Producto', null, 'Ya existe un producto con ese nombre.');
  const id = await db.transaccion(async (tx) => {
    const r = await tx.consultar('INSERT INTO PRODUCTO (NombreProducto, Categoria, Precio, Descripcion, Stock) VALUES (?, ?, ?, ?, ?)',
      [nombre, categoria(b.Categoria), precio, v.textoLargo(b.Descripcion, 'La descripción', 255), stock]);
    if (stock > 0) {
      await tx.consultar(
        `INSERT INTO MOVIMIENTO_INVENTARIO (ID_Producto, Tipo, Cantidad, StockFinal, Motivo, RealizadoPor)
         VALUES (?, 'Alta', ?, ?, 'Inventario inicial', ?)`, [r.insertId, stock, stock, firma(req.usuario)]);
    }
    return r.insertId;
  });
  res.status(201).json(await db.uno('SELECT * FROM PRODUCTO WHERE ID_Producto = ?', [id]));
}));

router.put('/productos/:id', soloDueno, envolver(async (req, res) => {
  const b = req.body || {};
  const nombre = v.texto(b.NombreProducto, 'El nombre del producto', { min: 2, max: 100, obligatorio: true });
  await nombreLibre('PRODUCTO', 'NombreProducto', nombre, 'ID_Producto', req.params.id, 'Ya existe un producto con ese nombre.');
  const r = await db.consultar(
    'UPDATE PRODUCTO SET NombreProducto = ?, Categoria = ?, Precio = ?, Descripcion = ? WHERE ID_Producto = ? AND Activo = 1',
    [nombre, categoria(b.Categoria),
      v.importe(b.Precio, 'El precio'), v.textoLargo(b.Descripcion, 'La descripción', 255), req.params.id]);
  if (!r.affectedRows) throw new ErrorApi(404, 'El producto no existe.');
  res.json(await db.uno('SELECT * FROM PRODUCTO WHERE ID_Producto = ?', [req.params.id]));
}));

router.delete('/productos/:id', soloDueno, envolver(async (req, res) => {
  const r = await db.consultar('UPDATE PRODUCTO SET Activo = 0 WHERE ID_Producto = ? AND Activo = 1', [req.params.id]);
  if (!r.affectedRows) throw new ErrorApi(404, 'El producto no existe.');
  // Ya no se ofrece como beneficio de ninguna membresía.
  await db.consultar('DELETE FROM MEMBRESIA_BENEFICIO WHERE ID_Producto = ?', [req.params.id]);
  res.status(204).end();
}));

/**
 * Suma o resta existencias y lo registra en la bitácora.
 * @param {'Entrada'|'Baja'} tipo
 */
async function moverInventario(req, tipo, cantidad, motivo) {
  return db.transaccion(async (tx) => {
    const p = await tx.uno('SELECT ID_Producto, NombreProducto, Stock FROM PRODUCTO WHERE ID_Producto = ? AND Activo = 1 FOR UPDATE', [req.params.id]);
    if (!p) throw new ErrorApi(404, 'El producto no existe.');
    const final = tipo === 'Entrada' ? p.Stock + cantidad : p.Stock - cantidad;
    if (final < 0) throw new ErrorApi(409, `Solo hay ${p.Stock} pieza(s) de «${p.NombreProducto}».`);
    await tx.consultar('UPDATE PRODUCTO SET Stock = ? WHERE ID_Producto = ?', [final, p.ID_Producto]);
    await tx.consultar(
      `INSERT INTO MOVIMIENTO_INVENTARIO (ID_Producto, Tipo, Cantidad, StockFinal, Motivo, RealizadoPor)
       VALUES (?, ?, ?, ?, ?, ?)`, [p.ID_Producto, tipo, cantidad, final, motivo, firma(req.usuario)]);
    return tx.uno('SELECT * FROM PRODUCTO WHERE ID_Producto = ?', [p.ID_Producto]);
  });
}

router.post('/productos/:id/entrada', caja, envolver(async (req, res) => {
  const b = req.body || {};
  res.json(await moverInventario(req, 'Entrada',
    v.entero(b.Cantidad, 'La cantidad', { min: 1, max: 100000 }), v.texto(b.Motivo, 'El motivo') || 'Entrada de inventario'));
}));

router.post('/productos/:id/baja', caja, envolver(async (req, res) => {
  const b = req.body || {};
  const cantidad = v.entero(b.Cantidad, 'La cantidad', { min: 1, max: 100000 });
  const motivo = v.texto(b.Motivo, 'El motivo', { min: 3, obligatorio: true });
  // Autorización: contraseña de la cuenta con sesión (Dueño o Cajero).
  const { tabla, id } = TABLA_ROL[req.usuario.rol];
  const cuenta = await db.uno(`SELECT Contrasena FROM ${tabla} WHERE ${id} = ?`, [req.usuario.id]);
  if (!cuenta || !(await contrasenas.verificar(String(b.Contrasena || ''), cuenta.Contrasena))) {
    throw new ErrorApi(403, 'Contraseña incorrecta. No se dio de baja el inventario.');
  }
  res.json(await moverInventario(req, 'Baja', cantidad, motivo));
}));

router.get('/productos/:id/movimientos', caja, envolver(async (req, res) => {
  res.json(await db.consultar(
    `SELECT ID_Movimiento, Tipo, Cantidad, StockFinal, Motivo, RealizadoPor, ID_Venta, Fecha
       FROM MOVIMIENTO_INVENTARIO WHERE ID_Producto = ? ORDER BY Fecha DESC, ID_Movimiento DESC LIMIT 100`, [req.params.id]));
}));

// =============================================================================
// Membresías
// =============================================================================

const APLICA = ['Servicio', 'Producto', 'Categoria', 'Productos', 'Texto'];
const MAX_BENEFICIOS = 30;

/** Membresías activas con su lista de beneficios (en el orden del plan). */
async function listarMembresias(id) {
  const planes = await db.consultar(
    `SELECT ID_Membresia, NombrePlan, Descripcion, Precio, DuracionMeses
       FROM MEMBRESIA WHERE Activo = 1 ${id ? 'AND ID_Membresia = ?' : ''} ORDER BY Precio`, id ? [id] : []);
  if (!planes.length) return planes;
  const beneficios = await db.consultar(
    `SELECT b.ID_Beneficio, b.ID_Membresia, b.Aplica, b.ID_Servicio, s.NombreServicio, b.ID_Producto, p.NombreProducto,
            b.Categoria, b.Tipo, b.Porcentaje, b.Usos, b.Periodo, b.Etiqueta, b.Orden
       FROM MEMBRESIA_BENEFICIO b
       LEFT JOIN SERVICIO s ON s.ID_Servicio = b.ID_Servicio
       LEFT JOIN PRODUCTO p ON p.ID_Producto = b.ID_Producto
      WHERE b.ID_Membresia IN (?)
        AND (b.ID_Servicio IS NULL OR s.Activo = 1) AND (b.ID_Producto IS NULL OR p.Activo = 1)
      ORDER BY b.Orden, b.ID_Beneficio`, [planes.map((p) => p.ID_Membresia)]);
  return planes.map((p) => {
    const lista = beneficios.filter((b) => b.ID_Membresia === p.ID_Membresia)
      .map((b) => ({ ...b, UsosPorMes: b.Periodo === 'Mes' ? b.Usos : null }));
    const productos = lista.find((b) => b.Aplica === 'Productos');
    // DescuentoProductos se conserva por compatibilidad con versiones anteriores.
    return { ...p, DescuentoProductos: productos ? Number(productos.Porcentaje) : 0, Beneficios: lista };
  });
}

/**
 * Valida un beneficio. Acepta también el formato anterior
 * { ID_Servicio, Tipo, Porcentaje, UsosPorMes }.
 */
function datosBeneficio(x, i) {
  const n = `Beneficio ${i + 1}`;
  const aplica = x.Aplica == null || x.Aplica === '' ? 'Servicio' : v.opcion(x.Aplica, `${n}: a qué aplica`, APLICA);
  const etiqueta = v.texto(x.Etiqueta, `${n}: el texto`, { max: 80, obligatorio: aplica === 'Texto' });
  const b = {
    ID_Beneficio: x.ID_Beneficio ? v.entero(x.ID_Beneficio, `${n}: el identificador`, { min: 1 }) : null,
    Aplica: aplica, ID_Servicio: null, ID_Producto: null, Categoria: null,
    Tipo: 'Gratis', Porcentaje: 100, Usos: null, Periodo: 'Mes', Etiqueta: etiqueta
  };
  if (aplica === 'Texto') return b;

  if (aplica === 'Servicio') b.ID_Servicio = v.entero(x.ID_Servicio, `${n}: el servicio`, { min: 1 });
  if (aplica === 'Producto') b.ID_Producto = v.entero(x.ID_Producto, `${n}: el producto`, { min: 1 });
  if (aplica === 'Categoria') b.Categoria = v.texto(x.Categoria, `${n}: la categoría`, { min: 2, max: 40, obligatorio: true });

  b.Tipo = x.Tipo == null || x.Tipo === '' ? (aplica === 'Productos' ? 'Descuento' : 'Gratis') : v.opcion(x.Tipo, `${n}: el tipo`, ['Gratis', 'Descuento']);
  if (aplica === 'Productos' && b.Tipo === 'Gratis') throw new ErrorApi(400, `${n}: en «todos los productos» solo se permite un descuento en %.`);
  b.Porcentaje = b.Tipo === 'Descuento' ? v.importe(x.Porcentaje, `${n}: el porcentaje`, { min: 1, max: 100 }) : 100;

  const usos = x.Usos !== undefined ? x.Usos : x.UsosPorMes;
  b.Usos = v.entero(usos, `${n}: el número de usos`, { min: 1, max: 999, obligatorio: false });
  b.Periodo = x.Periodo == null || x.Periodo === '' ? 'Mes' : v.opcion(x.Periodo, `${n}: el periodo`, ['Visita', 'Mes']);
  return b;
}

function datosMembresia(b) {
  const beneficios = (Array.isArray(b.Beneficios) ? b.Beneficios : []).map(datosBeneficio);
  // Compatibilidad: «DescuentoProductos» de versiones anteriores.
  const descuento = Number(b.DescuentoProductos) || 0;
  if (descuento > 0 && !beneficios.some((x) => x.Aplica === 'Productos')) {
    beneficios.push(datosBeneficio({ Aplica: 'Productos', Tipo: 'Descuento', Porcentaje: descuento }, beneficios.length));
  }
  if (beneficios.length > MAX_BENEFICIOS) throw new ErrorApi(400, `Una membresía admite como máximo ${MAX_BENEFICIOS} beneficios.`);
  return {
    campos: [
      v.texto(b.NombrePlan, 'El nombre de la membresía', { min: 2, max: 100, obligatorio: true }),
      v.textoLargo(b.Descripcion, 'La descripción', 255),
      v.importe(b.Precio, 'El precio'),
      v.entero(b.DuracionMeses == null || b.DuracionMeses === '' ? 1 : b.DuracionMeses, 'La duración', { min: 1, max: 24 })
    ],
    beneficios
  };
}

/**
 * Guarda los beneficios en el orden recibido. Los que traen ID_Beneficio se
 * actualizan en su lugar (así no se reinician sus usos del mes), los nuevos
 * se insertan y los que ya no vienen se eliminan.
 */
async function guardarBeneficios(tx, idMembresia, beneficios) {
  const actuales = new Set((await tx.consultar('SELECT ID_Beneficio FROM MEMBRESIA_BENEFICIO WHERE ID_Membresia = ?', [idMembresia]))
    .map((x) => x.ID_Beneficio));
  const conservar = new Set();
  for (const [orden, x] of beneficios.entries()) {
    if (x.Aplica === 'Servicio' && !(await tx.uno('SELECT 1 AS ok FROM SERVICIO WHERE ID_Servicio = ? AND Activo = 1', [x.ID_Servicio]))) {
      throw new ErrorApi(400, `Beneficio ${orden + 1}: el servicio ya no existe.`);
    }
    if (x.Aplica === 'Producto' && !(await tx.uno('SELECT 1 AS ok FROM PRODUCTO WHERE ID_Producto = ? AND Activo = 1', [x.ID_Producto]))) {
      throw new ErrorApi(400, `Beneficio ${orden + 1}: el producto ya no existe.`);
    }
    const valores = [x.Aplica, x.ID_Servicio, x.ID_Producto, x.Categoria, x.Tipo, x.Porcentaje, x.Usos, x.Periodo, x.Etiqueta, orden];
    if (x.ID_Beneficio && actuales.has(x.ID_Beneficio) && !conservar.has(x.ID_Beneficio)) {
      await tx.consultar(
        `UPDATE MEMBRESIA_BENEFICIO SET Aplica = ?, ID_Servicio = ?, ID_Producto = ?, Categoria = ?, Tipo = ?, Porcentaje = ?,
                Usos = ?, Periodo = ?, Etiqueta = ?, Orden = ? WHERE ID_Beneficio = ?`, [...valores, x.ID_Beneficio]);
      conservar.add(x.ID_Beneficio);
    } else {
      const r = await tx.consultar(
        `INSERT INTO MEMBRESIA_BENEFICIO (Aplica, ID_Servicio, ID_Producto, Categoria, Tipo, Porcentaje, Usos, Periodo, Etiqueta, Orden, ID_Membresia)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [...valores, idMembresia]);
      conservar.add(r.insertId);
    }
  }
  const quitar = [...actuales].filter((id) => !conservar.has(id));
  if (quitar.length) await tx.consultar('DELETE FROM MEMBRESIA_BENEFICIO WHERE ID_Beneficio IN (?)', [quitar]);
}

router.get('/membresias', envolver(async (req, res) => res.json(await listarMembresias())));

router.post('/membresias', soloDueno, envolver(async (req, res) => {
  const { campos, beneficios } = datosMembresia(req.body || {});
  await nombreLibre('MEMBRESIA', 'NombrePlan', campos[0], 'ID_Membresia', null, 'Ya existe una membresía con ese nombre. Usa «Editar» para cambiar sus beneficios.');
  const id = await db.transaccion(async (tx) => {
    const r = await tx.consultar(
      'INSERT INTO MEMBRESIA (NombrePlan, Descripcion, Precio, DuracionMeses) VALUES (?, ?, ?, ?)', campos);
    await guardarBeneficios(tx, r.insertId, beneficios);
    return r.insertId;
  });
  res.status(201).json((await listarMembresias(id))[0]);
}));

router.put('/membresias/:id', soloDueno, envolver(async (req, res) => {
  const { campos, beneficios } = datosMembresia(req.body || {});
  await nombreLibre('MEMBRESIA', 'NombrePlan', campos[0], 'ID_Membresia', req.params.id, 'Ya existe una membresía con ese nombre. Usa «Editar» para cambiar sus beneficios.');
  await db.transaccion(async (tx) => {
    const r = await tx.consultar(
      `UPDATE MEMBRESIA SET NombrePlan = ?, Descripcion = ?, Precio = ?, DuracionMeses = ?
        WHERE ID_Membresia = ? AND Activo = 1`, [...campos, req.params.id]);
    if (!r.affectedRows) throw new ErrorApi(404, 'La membresía no existe.');
    await guardarBeneficios(tx, req.params.id, beneficios);
  });
  res.json((await listarMembresias(req.params.id))[0]);
}));

router.delete('/membresias/:id', soloDueno, envolver(async (req, res) => {
  // Los clientes que ya la tienen la conservan hasta su vencimiento.
  const r = await db.consultar('UPDATE MEMBRESIA SET Activo = 0 WHERE ID_Membresia = ? AND Activo = 1', [req.params.id]);
  if (!r.affectedRows) throw new ErrorApi(404, 'La membresía no existe.');
  res.status(204).end();
}));

module.exports = router;
