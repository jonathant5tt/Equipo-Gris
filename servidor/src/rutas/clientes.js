/**
 * @file rutas/clientes.js
 * @description Clientes, su historial, fotos y servicios pendientes de pago.
 *
 *   GET    /api/clientes?buscar=&filtro=&limite=   C D B
 *          filtro: recientes | primeros | membresia   (buscar: nombre o teléfono)
 *   GET    /api/clientes/:id                       C D B   Ficha completa con estadísticas
 *   POST   /api/clientes                           C D B   { Nombre, Lada, Telefono, Descripcion?, Observaciones?, foto? }
 *   PUT    /api/clientes/:id                       C D     Datos de contacto y estilo
 *   GET    /api/clientes/:id/servicios             C D B   Historial de servicios cobrados
 *   GET    /api/clientes/:id/pendientes            C D     Citas atendidas sin cobrar
 *   GET    /api/clientes/:id/membresia             C D B   Membresía que se aplica hoy y sus beneficios (o null)
 *   GET    /api/clientes/:id/fotos                 C D B
 *   POST   /api/clientes/:id/fotos                 C D B   { foto: dataURL, Titulo?, Notas?, Referencia? }
 *   DELETE /api/clientes/:id/fotos/:idFoto         C D B
 *   PUT    /api/clientes/:id/foto-referencia       C D B   { ID_Foto }
 *   DELETE /api/clientes/:id/foto-referencia       C D B   Elimina la foto principal
 *
 * La membresía nunca se activa aquí: solo al cobrarla en caja (rutas/ventas.js).
 */
'use strict';

const express = require('../lib/web');
const db = require('../db');
const v = require('../servicios/validar');
const f = require('../servicios/fechas');
const fotos = require('../servicios/fotos');
const precios = require('../servicios/precios');
const { ROLES, requiereSesion, permitir, firma } = require('../middleware/autenticacion');
const { ErrorApi, envolver } = require('../middleware/errores');

const router = express.Router();
router.use(requiereSesion);
const caja = permitir(ROLES.DUENO, ROLES.CAJERO);

/** Columnas comunes; MembresiaActiva considera la fecha de vencimiento. */
const CAMPOS = `c.ID_Cliente, c.Nombre, c.Lada, c.Telefono, c.FotoCorteReferencia, c.Descripcion, c.Observaciones,
  c.FechaRegistro, c.ID_Membresia, m.NombrePlan, c.FechaInicio, c.FechaVencimiento, c.FaltasConsecutivas,
  (c.EstadoMembresia = 'Activa' AND c.FechaVencimiento >= CURDATE()) AS MembresiaActiva,
  IF(c.EstadoMembresia = 'Activa' AND c.FechaVencimiento >= CURDATE(), 'Activa', 'Inactiva') AS EstadoMembresia`;
const DESDE = 'FROM CLIENTE c LEFT JOIN MEMBRESIA m ON m.ID_Membresia = c.ID_Membresia';

/** Convierte 0/1 de MySQL a booleano. */
const normalizar = (c) => c && { ...c, MembresiaActiva: !!Number(c.MembresiaActiva) };

async function existe(id) {
  const c = await db.uno('SELECT ID_Cliente, Nombre FROM CLIENTE WHERE ID_Cliente = ?', [id]);
  if (!c) throw new ErrorApi(404, 'El cliente no existe.');
  return c;
}

router.get('/', envolver(async (req, res) => {
  const texto = String(req.query.buscar || '').trim();
  const filtro = String(req.query.filtro || '');
  const limite = v.entero(req.query.limite || 20, 'El límite', { min: 1, max: 200 });
  const condiciones = [];
  const parametros = [];

  if (texto) {
    const digitos = texto.replace(/\D/g, '');
    condiciones.push(digitos.length >= 3 ? '(c.Nombre LIKE ? OR c.Telefono LIKE ?)' : 'c.Nombre LIKE ?');
    parametros.push(`%${texto}%`);
    if (digitos.length >= 3) parametros.push(`%${digitos}%`);
  }
  if (filtro === 'membresia') condiciones.push("c.EstadoMembresia = 'Activa' AND c.FechaVencimiento >= CURDATE()");

  let orden = 'c.Nombre';
  if (filtro === 'recientes') orden = 'c.FechaRegistro DESC, c.ID_Cliente DESC';
  else if (filtro === 'primeros') orden = 'c.FechaRegistro ASC, c.ID_Cliente ASC';
  else if (texto) { orden = '(c.Nombre LIKE ?) DESC, c.Nombre'; }

  const sql = `SELECT ${CAMPOS} ${DESDE}
    ${condiciones.length ? 'WHERE ' + condiciones.join(' AND ') : ''}
    ORDER BY ${orden} LIMIT ?`;
  if (orden.startsWith('(c.Nombre LIKE ?)')) parametros.push(`${texto}%`);
  parametros.push(limite);
  res.json((await db.consultar(sql, parametros)).map(normalizar));
}));

router.get('/:id', envolver(async (req, res) => {
  const cliente = normalizar(await db.uno(`SELECT ${CAMPOS} ${DESDE} WHERE c.ID_Cliente = ?`, [req.params.id]));
  if (!cliente) throw new ErrorApi(404, 'El cliente no existe.');
  const citas = await db.uno(
    `SELECT SUM(Estado = 'Atendida') AS Asistencias, SUM(Estado = 'NoAsistio') AS Faltas,
            SUM(Estado = 'Cancelada') AS Canceladas, COUNT(*) AS CitasTotales
       FROM CITA WHERE ID_Cliente = ?`, [req.params.id]);
  const visita = await db.uno('SELECT MAX(FechaHoraCobro) AS UltimaVisita, COUNT(*) AS Visitas FROM VENTA WHERE ID_Cliente = ?', [req.params.id]);
  const proxima = await db.uno(
    `SELECT c.ID_Cita, c.FechaHora, s.NombreServicio, b.Nombre AS NombreBarbero
       FROM CITA c JOIN SERVICIO s ON s.ID_Servicio = c.ID_Servicio JOIN BARBERO b ON b.ID_Barbero = c.ID_Barbero
      WHERE c.ID_Cliente = ? AND c.Estado IN ('Agendada','EnEspera') AND c.FechaHora >= NOW()
      ORDER BY c.FechaHora LIMIT 1`, [req.params.id]);
  const asistencias = Number(citas.Asistencias || 0);
  const faltas = Number(citas.Faltas || 0);
  res.json({
    ...cliente,
    Asistencias: asistencias,
    Faltas: faltas,
    Canceladas: Number(citas.Canceladas || 0),
    CitasTotales: Number(citas.CitasTotales || 0),
    Puntualidad: asistencias + faltas ? Math.round((asistencias / (asistencias + faltas)) * 100) : null,
    UltimaVisita: visita.UltimaVisita,
    Visitas: Number(visita.Visitas || 0),
    ProximaCita: proxima
  });
}));

router.post('/', envolver(async (req, res) => {
  const b = req.body || {};
  const nombre = v.texto(b.Nombre, 'El nombre completo', { min: 3, max: 100, obligatorio: true });
  const telefono = v.telefono(b.Telefono);
  const lada = /^\+\d{1,4}$/.test(String(b.Lada || '')) ? b.Lada : '+52';
  if (await db.uno('SELECT 1 FROM CLIENTE WHERE Telefono = ?', [telefono])) {
    throw new ErrorApi(409, 'Ya existe un cliente con ese teléfono.');
  }
  // Todo cliente nuevo inicia sin membresía.
  const r = await db.consultar(
    `INSERT INTO CLIENTE (Nombre, Lada, Telefono, Descripcion, Observaciones, EstadoMembresia)
     VALUES (?, ?, ?, ?, ?, 'Inactiva')`,
    [nombre, lada, telefono, v.textoLargo(b.Descripcion, 'La descripción', 255), v.textoLargo(b.Observaciones, 'Las observaciones', 500)]);

  if (b.foto) {
    try {
      const url = await fotos.guardarFotoCliente(r.insertId, b.foto);
      await db.consultar('INSERT INTO FOTO_CLIENTE (ID_Cliente, Url, Titulo, SubidaPor) VALUES (?, ?, ?, ?)',
        [r.insertId, url, 'Corte de referencia', firma(req.usuario)]);
      await db.consultar('UPDATE CLIENTE SET FotoCorteReferencia = ? WHERE ID_Cliente = ?', [url, r.insertId]);
    } catch (error) {
      // El cliente se guarda aunque la foto falle; se avisa en la respuesta.
      return res.status(201).json({ ...normalizar(await db.uno(`SELECT ${CAMPOS} ${DESDE} WHERE c.ID_Cliente = ?`, [r.insertId])), AvisoFoto: error.message });
    }
  }
  res.status(201).json(normalizar(await db.uno(`SELECT ${CAMPOS} ${DESDE} WHERE c.ID_Cliente = ?`, [r.insertId])));
}));

router.put('/:id', caja, envolver(async (req, res) => {
  const b = req.body || {};
  await existe(req.params.id);
  const telefono = v.telefono(b.Telefono);
  if (await db.uno('SELECT 1 FROM CLIENTE WHERE Telefono = ? AND ID_Cliente <> ?', [telefono, req.params.id])) {
    throw new ErrorApi(409, 'Ya existe otro cliente con ese teléfono.');
  }
  await db.consultar(
    'UPDATE CLIENTE SET Nombre = ?, Lada = ?, Telefono = ?, Descripcion = ?, Observaciones = ? WHERE ID_Cliente = ?',
    [v.texto(b.Nombre, 'El nombre completo', { min: 3, max: 100, obligatorio: true }),
      /^\+\d{1,4}$/.test(String(b.Lada || '')) ? b.Lada : '+52', telefono,
      v.textoLargo(b.Descripcion, 'La descripción', 255), v.textoLargo(b.Observaciones, 'Las observaciones', 500), req.params.id]);
  res.json(normalizar(await db.uno(`SELECT ${CAMPOS} ${DESDE} WHERE c.ID_Cliente = ?`, [req.params.id])));
}));

router.get('/:id/servicios', envolver(async (req, res) => {
  await existe(req.params.id);
  res.json(await db.consultar(
    `SELECT v.ID_Venta, v.NumeroFactura, v.FechaHoraCobro, d.NombreItem, d.TipoItem, d.PrecioUnitario, d.Cantidad,
            d.Descuento, d.Importe, d.Beneficio, b.Nombre AS NombreBarbero
       FROM DETALLE_VENTA d
       JOIN VENTA v ON v.ID_Venta = d.ID_Venta
       LEFT JOIN BARBERO b ON b.ID_Barbero = d.ID_Barbero
      WHERE v.ID_Cliente = ?
      ORDER BY v.FechaHoraCobro DESC, d.ID_Detalle LIMIT 100`, [req.params.id]));
}));

router.get('/:id/membresia', envolver(async (req, res) => {
  res.json(await precios.membresiaDelCliente(db, v.entero(req.params.id, 'El cliente', { min: 1 })));
}));

router.get('/:id/pendientes', caja, envolver(async (req, res) => {
  await existe(req.params.id);
  res.json(await db.consultar(
    `SELECT c.ID_Cita, c.FechaHora, c.ID_Servicio, s.NombreServicio, s.Precio, c.ID_Barbero, b.Nombre AS NombreBarbero
       FROM CITA c JOIN SERVICIO s ON s.ID_Servicio = c.ID_Servicio JOIN BARBERO b ON b.ID_Barbero = c.ID_Barbero
      WHERE c.ID_Cliente = ? AND c.Estado = 'Atendida' AND c.ID_Venta IS NULL
      ORDER BY c.FechaHora`, [req.params.id]));
}));

router.get('/:id/fotos', envolver(async (req, res) => {
  await existe(req.params.id);
  res.json(await db.consultar(
    'SELECT ID_Foto, Url, Titulo, Notas, SubidaPor, Fecha FROM FOTO_CLIENTE WHERE ID_Cliente = ? ORDER BY Fecha DESC, ID_Foto DESC',
    [req.params.id]));
}));

router.post('/:id/fotos', envolver(async (req, res) => {
  const b = req.body || {};
  await existe(req.params.id);
  const url = await fotos.guardarFotoCliente(req.params.id, b.foto);
  const r = await db.consultar('INSERT INTO FOTO_CLIENTE (ID_Cliente, Url, Titulo, Notas, SubidaPor) VALUES (?, ?, ?, ?, ?)',
    [req.params.id, url, v.texto(b.Titulo, 'El título', { max: 100 }) || `Corte del ${f.fechaCorta(f.hoy())}`,
      v.texto(b.Notas, 'Las notas'), firma(req.usuario)]);
  // La primera foto del cliente (o si se pide) queda como referencia.
  await db.consultar(
    `UPDATE CLIENTE SET FotoCorteReferencia = ? WHERE ID_Cliente = ? AND (FotoCorteReferencia IS NULL OR ? = 1)`,
    [url, req.params.id, b.Referencia ? 1 : 0]);
  res.status(201).json(await db.uno('SELECT * FROM FOTO_CLIENTE WHERE ID_Foto = ?', [r.insertId]));
}));

router.delete('/:id/fotos/:idFoto', envolver(async (req, res) => {
  const foto = await db.uno('SELECT ID_Foto, Url FROM FOTO_CLIENTE WHERE ID_Foto = ? AND ID_Cliente = ?', [req.params.idFoto, req.params.id]);
  if (!foto) throw new ErrorApi(404, 'La foto no existe.');
  await db.consultar('DELETE FROM FOTO_CLIENTE WHERE ID_Foto = ?', [foto.ID_Foto]);
  await db.consultar('UPDATE CLIENTE SET FotoCorteReferencia = NULL WHERE ID_Cliente = ? AND FotoCorteReferencia = ?', [req.params.id, foto.Url]);
  await fotos.borrarArchivo(foto.Url);
  res.status(204).end();
}));

router.put('/:id/foto-referencia', envolver(async (req, res) => {
  const foto = await db.uno('SELECT Url FROM FOTO_CLIENTE WHERE ID_Foto = ? AND ID_Cliente = ?',
    [req.body && req.body.ID_Foto, req.params.id]);
  if (!foto) throw new ErrorApi(404, 'La foto no existe.');
  await db.consultar('UPDATE CLIENTE SET FotoCorteReferencia = ? WHERE ID_Cliente = ?', [foto.Url, req.params.id]);
  res.json(normalizar(await db.uno(`SELECT ${CAMPOS} ${DESDE} WHERE c.ID_Cliente = ?`, [req.params.id])));
}));

/** Elimina la foto principal (de referencia) del cliente y su archivo. */
router.delete('/:id/foto-referencia', envolver(async (req, res) => {
  const cliente = await db.uno('SELECT FotoCorteReferencia FROM CLIENTE WHERE ID_Cliente = ?', [req.params.id]);
  if (!cliente) throw new ErrorApi(404, 'El cliente no existe.');
  const url = cliente.FotoCorteReferencia;
  if (!url) throw new ErrorApi(404, 'El cliente no tiene foto de referencia.');
  await db.consultar('DELETE FROM FOTO_CLIENTE WHERE ID_Cliente = ? AND Url = ?', [req.params.id, url]);
  await db.consultar('UPDATE CLIENTE SET FotoCorteReferencia = NULL WHERE ID_Cliente = ?', [req.params.id]);
  await fotos.borrarArchivo(url);
  res.status(204).end();
}));

module.exports = router;
