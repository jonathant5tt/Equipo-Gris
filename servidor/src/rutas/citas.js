/**
 * @file rutas/citas.js
 * @description Agenda: disponibilidad, alta de citas, cambios de estado y
 * confirmación automática por WhatsApp.
 *
 *   GET   /api/citas?fecha=&barbero=                     C D     Citas del día
 *   GET   /api/citas/mias?fecha=                         B       Agenda del barbero con sesión
 *   GET   /api/citas/proxima                             B       Cita en atención o la siguiente de hoy
 *   GET   /api/citas/disponibilidad?barbero=&fecha=&servicio=   Bloques del día
 *   GET   /api/citas/dias?barbero=&desde=&dias=7&servicio=      Estado de cada día (Libre/Ocupado/NoDisponible)
 *   POST  /api/citas                                     C D B   { ID_Cliente, ID_Barbero, ID_Servicio, FechaHora }
 *   PATCH /api/citas/:id/estado                          C D B   { Estado }
 *   POST  /api/citas/:id/enviar                          C D B   Reenvía la confirmación por WhatsApp
 *
 * Transiciones (diagrama de estados 3.2):
 *   Agendada → EnEspera | EnAtencion | Cancelada | NoAsistio
 *   EnEspera → EnAtencion | Cancelada | NoAsistio
 *   EnAtencion → Atendida
 */
'use strict';

const express = require('../lib/web');
const db = require('../db');
const v = require('../servicios/validar');
const f = require('../servicios/fechas');
const agenda = require('../servicios/disponibilidad');
const whatsapp = require('../servicios/whatsapp');
const mensajes = require('../servicios/mensajes');
const { ROLES, requiereSesion, permitir } = require('../middleware/autenticacion');
const { ErrorApi, envolver } = require('../middleware/errores');

const router = express.Router();
router.use(requiereSesion);

const CAMPOS = `c.ID_Cita, c.FechaHora, c.DuracionMin, c.Estado, c.Origen, c.ID_Cliente, c.ID_Barbero, c.ID_Servicio,
  c.ID_Venta, c.Notificada, cl.Nombre AS NombreCliente, cl.Lada, cl.Telefono AS TelefonoCliente,
  cl.FotoCorteReferencia, b.Nombre AS NombreBarbero, s.NombreServicio, s.Precio`;
const DESDE = `FROM CITA c
  JOIN CLIENTE cl ON cl.ID_Cliente = c.ID_Cliente
  JOIN BARBERO b ON b.ID_Barbero = c.ID_Barbero
  JOIN SERVICIO s ON s.ID_Servicio = c.ID_Servicio`;

const TRANSICIONES = {
  Agendada: ['EnEspera', 'EnAtencion', 'Cancelada', 'NoAsistio'],
  EnEspera: ['EnAtencion', 'Cancelada', 'NoAsistio'],
  EnAtencion: ['Atendida']
};

const obtenerCita = (id) => db.uno(`SELECT ${CAMPOS} ${DESDE} WHERE c.ID_Cita = ?`, [id]);

async function obtenerServicio(id, obligatorio = true) {
  if (!id) {
    if (obligatorio) throw new ErrorApi(400, 'Elige el servicio solicitado.');
    return null;
  }
  const s = await db.uno('SELECT ID_Servicio, NombreServicio, Precio, DuracionMin, DiasDisponibles FROM SERVICIO WHERE ID_Servicio = ? AND Activo = 1', [id]);
  if (!s) throw new ErrorApi(404, 'El servicio no existe.');
  return s;
}

/** Envía la confirmación de la cita por WhatsApp (o devuelve el enlace). */
async function notificar(cita) {
  const negocio = await db.uno('SELECT NombreEstablecimiento, Direccion FROM ESTABLECIMIENTO WHERE ID_Local = 1');
  const { texto, parametros } = mensajes.confirmacionCita(cita, negocio);
  const cfg = await whatsapp.configuracion();
  const r = await whatsapp.enviar({
    telefono: cita.TelefonoCliente, lada: cita.Lada, texto, tipo: 'Cita', ids: { ID_Cita: cita.ID_Cita },
    plantilla: cfg && cfg.WhatsAppPlantillaCita ? { nombre: cfg.WhatsAppPlantillaCita, parametros } : null
  });
  if (r.Enviado) await db.consultar('UPDATE CITA SET Notificada = 1 WHERE ID_Cita = ?', [cita.ID_Cita]);
  return r;
}

// ---- Consultas --------------------------------------------------------------

router.get('/', permitir(ROLES.DUENO, ROLES.CAJERO), envolver(async (req, res) => {
  const fecha = v.fecha(req.query.fecha || f.hoy(), 'La fecha');
  const parametros = [fecha];
  let filtro = '';
  if (req.query.barbero) { filtro = ' AND c.ID_Barbero = ?'; parametros.push(req.query.barbero); }
  res.json(await db.consultar(`SELECT ${CAMPOS} ${DESDE} WHERE DATE(c.FechaHora) = ?${filtro} ORDER BY c.FechaHora`, parametros));
}));

router.get('/mias', permitir(ROLES.BARBERO), envolver(async (req, res) => {
  const fecha = v.fecha(req.query.fecha || f.hoy(), 'La fecha');
  res.json(await db.consultar(
    `SELECT ${CAMPOS} ${DESDE} WHERE c.ID_Barbero = ? AND DATE(c.FechaHora) = ? ORDER BY c.FechaHora`, [req.usuario.id, fecha]));
}));

router.get('/proxima', permitir(ROLES.BARBERO), envolver(async (req, res) => {
  const enAtencion = await db.uno(
    `SELECT ${CAMPOS} ${DESDE} WHERE c.ID_Barbero = ? AND c.Estado = 'EnAtencion' ORDER BY c.FechaHora LIMIT 1`, [req.usuario.id]);
  res.json(enAtencion || await db.uno(
    `SELECT ${CAMPOS} ${DESDE}
      WHERE c.ID_Barbero = ? AND c.Estado IN ('Agendada','EnEspera') AND DATE(c.FechaHora) = CURDATE()
      ORDER BY c.FechaHora LIMIT 1`, [req.usuario.id]));
}));

router.get('/disponibilidad', envolver(async (req, res) => {
  const barbero = await agenda.obtenerBarbero(db, v.entero(req.query.barbero, 'El barbero', { min: 1 }));
  const servicio = await obtenerServicio(req.query.servicio, false);
  res.json(await agenda.diaDeAgenda(db, barbero, v.fecha(req.query.fecha, 'La fecha'), servicio));
}));

router.get('/dias', envolver(async (req, res) => {
  const barbero = await agenda.obtenerBarbero(db, v.entero(req.query.barbero, 'El barbero', { min: 1 }));
  const servicio = await obtenerServicio(req.query.servicio, false);
  const desde = v.fecha(req.query.desde || f.hoy(), 'La fecha inicial');
  const dias = v.entero(req.query.dias || 7, 'Los días', { min: 1, max: 31 });
  const resultado = [];
  for (let i = 0; i < dias; i += 1) {
    const dia = await agenda.diaDeAgenda(db, barbero, f.sumarDias(desde, i), servicio);
    delete dia.Bloques;
    resultado.push(dia);
  }
  res.json(resultado);
}));

// ---- Alta -------------------------------------------------------------------

router.post('/', envolver(async (req, res) => {
  const b = req.body || {};
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(String(b.FechaHora || ''));
  if (!m) throw new ErrorApi(400, 'Elige la fecha y la hora de la cita.');
  const [, fecha, hora] = m;
  const idCliente = v.entero(b.ID_Cliente, 'El cliente', { min: 1 });
  const idBarbero = req.usuario.rol === ROLES.BARBERO && !b.ID_Barbero ? req.usuario.id : v.entero(b.ID_Barbero, 'El barbero', { min: 1 });
  const servicio = await obtenerServicio(b.ID_Servicio);
  const cliente = await db.uno('SELECT ID_Cliente FROM CLIENTE WHERE ID_Cliente = ?', [idCliente]);
  if (!cliente) throw new ErrorApi(404, 'El cliente no existe.');

  const idCita = await db.transaccion(async (tx) => {
    // Bloquea al barbero para que dos cajas no tomen el mismo horario a la vez.
    await tx.uno('SELECT ID_Barbero FROM BARBERO WHERE ID_Barbero = ? FOR UPDATE', [idBarbero]);
    const barbero = await agenda.obtenerBarbero(tx, idBarbero);
    await agenda.confirmarHueco(tx, barbero, fecha, hora, servicio);
    const r = await tx.consultar(
      `INSERT INTO CITA (FechaHora, DuracionMin, Estado, Origen, ID_Cliente, ID_Barbero, ID_Servicio)
       VALUES (?, ?, 'Agendada', ?, ?, ?, ?)`,
      [`${fecha} ${hora}:00`, servicio.DuracionMin, req.usuario.rol === ROLES.BARBERO ? 'App' : 'Caja',
        idCliente, idBarbero, servicio.ID_Servicio]);
    if (!(req.usuario.rol === ROLES.BARBERO && req.usuario.id === idBarbero)) {
      await tx.consultar('INSERT INTO AVISO (ID_Barbero, Tipo, Mensaje) VALUES (?, ?, ?)', [idBarbero, 'Nueva cita',
        `Nueva cita el ${f.fechaCorta(fecha)} a las ${f.hora12(hora)}: ${servicio.NombreServicio}.`]);
    }
    return r.insertId;
  });

  const cita = await obtenerCita(idCita);
  const envio = await notificar(cita);
  res.status(201).json({ ...cita, Notificada: envio.Enviado ? 1 : 0, WhatsApp: envio });
}));

// ---- Estado -----------------------------------------------------------------

router.patch('/:id/estado', envolver(async (req, res) => {
  const nuevo = v.opcion(req.body && req.body.Estado, 'El estado', ['EnEspera', 'EnAtencion', 'Atendida', 'Cancelada', 'NoAsistio']);
  const cita = await obtenerCita(req.params.id);
  if (!cita) throw new ErrorApi(404, 'La cita no existe.');
  if (req.usuario.rol === ROLES.BARBERO && cita.ID_Barbero !== req.usuario.id) {
    throw new ErrorApi(403, 'Solo puedes cambiar tus propias citas.');
  }
  if (!(TRANSICIONES[cita.Estado] || []).includes(nuevo)) {
    throw new ErrorApi(409, `La cita está «${cita.Estado}» y no puede pasar a «${nuevo}».`);
  }

  await db.transaccion(async (tx) => {
    const r = await tx.consultar('UPDATE CITA SET Estado = ? WHERE ID_Cita = ? AND Estado = ?', [nuevo, cita.ID_Cita, cita.Estado]);
    if (!r.affectedRows) throw new ErrorApi(409, 'La cita cambió mientras tanto. Actualiza la pantalla.');
    if (nuevo === 'NoAsistio') {
      await tx.consultar('UPDATE CLIENTE SET FaltasConsecutivas = FaltasConsecutivas + 1 WHERE ID_Cliente = ?', [cita.ID_Cliente]);
    }
    if (nuevo === 'Atendida' || nuevo === 'EnAtencion') {
      await tx.consultar('UPDATE CLIENTE SET FaltasConsecutivas = 0 WHERE ID_Cliente = ?', [cita.ID_Cliente]);
    }
    if (nuevo === 'Cancelada' && req.usuario.rol !== ROLES.BARBERO) {
      const [fecha, hora] = cita.FechaHora.split(' ');
      await tx.consultar('INSERT INTO AVISO (ID_Barbero, Tipo, Mensaje) VALUES (?, ?, ?)', [cita.ID_Barbero, 'Cita cancelada',
        `${cita.NombreCliente} canceló la cita del ${f.fechaCorta(fecha)} a las ${f.hora12(hora)}.`]);
    }
  });
  res.json(await obtenerCita(cita.ID_Cita));
}));

router.post('/:id/enviar', envolver(async (req, res) => {
  const cita = await obtenerCita(req.params.id);
  if (!cita) throw new ErrorApi(404, 'La cita no existe.');
  res.json(await notificar(cita));
}));

module.exports = router;
