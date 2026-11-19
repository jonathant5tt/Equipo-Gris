/**
 * @file rutas/establecimiento.js
 * @description Datos del negocio, estado del servicio y configuración de WhatsApp.
 *
 *   GET  /api/establecimiento/estado      (pública)  { EstadoServicio, MensajeMantenimiento }
 *   GET  /api/establecimiento             C D B      Datos del negocio (sin token de WhatsApp)
 *   PUT  /api/establecimiento             D          Actualiza datos del negocio
 *   PUT  /api/establecimiento/estado      D          Suspende o reanuda el servicio
 *   GET  /api/ajustes/whatsapp            D          Configuración (el token no se devuelve)
 *   PUT  /api/ajustes/whatsapp            D
 *   POST /api/ajustes/whatsapp/prueba     D          { Telefono } envía un mensaje de prueba
 *   POST /api/ajustes/whatsapp/conexion   D          Comprueba el número y el token sin enviar nada
 *   POST /api/ajustes/whatsapp/bot/simular D         { Mensaje } → lo que contestaría el bot
 *   GET  /api/ajustes/whatsapp/chats      D          Últimos mensajes recibidos y respuestas del bot
 *
 * El horario se guarda como JSON: { "L": ["09:00","20:00"], …, "D": null } (null = cerrado).
 */
'use strict';

const express = require('../lib/web');
const db = require('../db');
const v = require('../servicios/validar');
const crypto = require('crypto');
const whatsapp = require('../servicios/whatsapp');
const bot = require('../servicios/bot');
const { ErrorApi } = require('../middleware/errores');
const { requiereSesion, permitir, ROLES } = require('../middleware/autenticacion');
const { reiniciarCache } = require('../middleware/suspension');
const { envolver } = require('../middleware/errores');

const estado = express.Router();     // montado en /api/establecimiento (incluye ruta pública)
const ajustes = express.Router();    // montado en /api/ajustes

const CAMPOS_NEGOCIO = `NombreEstablecimiento, Eslogan, Direccion, Telefono, DatosFiscales,
  MensajeTicket, RedesSociales, LadaPais, FondoCaja, EstadoServicio, MensajeMantenimiento,
  HorarioAtencion, UbicacionMapa, InfoCitas`;

/** Datos del negocio con el horario ya convertido a objeto. */
async function negocio() {
  const n = await db.uno(`SELECT ${CAMPOS_NEGOCIO} FROM ESTABLECIMIENTO WHERE ID_Local = 1`);
  n.HorarioAtencion = bot.leerHorario(n.HorarioAtencion);
  return n;
}

/** Valida el horario por día; devuelve el JSON a guardar o null si no se capturó. */
function validarHorario(h) {
  if (h == null || h === '') return null;
  if (typeof h === 'string') { try { h = JSON.parse(h); } catch (e) { throw new ErrorApi(400, 'El horario no es válido.'); } }
  if (typeof h !== 'object') throw new ErrorApi(400, 'El horario no es válido.');
  const limpio = {};
  let alguno = false;
  for (const [letra, nombre] of bot.DIAS) {
    const d = h[letra];
    if (!d) { limpio[letra] = null; continue; }
    if (!Array.isArray(d) || d.length !== 2) throw new ErrorApi(400, `El horario del ${nombre} no es válido.`);
    const abre = v.hora(d[0], `La hora de apertura del ${nombre}`).slice(0, 5);
    const cierra = v.hora(d[1], `La hora de cierre del ${nombre}`).slice(0, 5);
    if (cierra <= abre) throw new ErrorApi(400, `El ${nombre} la hora de cierre debe ser después de la de apertura.`);
    limpio[letra] = [abre, cierra];
    alguno = true;
  }
  return alguno ? JSON.stringify(limpio) : null;
}

/** El enlace del mapa debe ser una dirección web. */
function enlaceMapa(valor) {
  const t = v.texto(valor, 'El enlace del mapa', { max: 255 });
  if (t && !/^https?:\/\/\S+$/i.test(t)) throw new ErrorApi(400, 'El enlace del mapa debe empezar con https://');
  return t;
}

estado.get('/estado', envolver(async (req, res) => {
  res.json(await db.uno('SELECT EstadoServicio, MensajeMantenimiento FROM ESTABLECIMIENTO WHERE ID_Local = 1'));
}));

estado.get('/', requiereSesion, envolver(async (req, res) => {
  res.json(await negocio());
}));

estado.put('/', requiereSesion, permitir(ROLES.DUENO), envolver(async (req, res) => {
  const b = req.body || {};
  await db.consultar(
    `UPDATE ESTABLECIMIENTO SET NombreEstablecimiento = ?, Eslogan = ?, Direccion = ?, Telefono = ?,
            DatosFiscales = ?, MensajeTicket = ?, RedesSociales = ?, FondoCaja = ?,
            HorarioAtencion = ?, UbicacionMapa = ?, InfoCitas = ? WHERE ID_Local = 1`,
    [v.texto(b.NombreEstablecimiento, 'El nombre del negocio', { obligatorio: true, max: 100 }),
      v.texto(b.Eslogan, 'El eslogan', { max: 120 }), v.texto(b.Direccion, 'La dirección'),
      v.texto(b.Telefono, 'El teléfono', { max: 15 }), v.texto(b.DatosFiscales, 'Los datos fiscales'),
      v.texto(b.MensajeTicket, 'El mensaje del ticket'), v.texto(b.RedesSociales, 'Las redes sociales', { max: 120 }),
      v.importe(b.FondoCaja == null ? 0 : b.FondoCaja, 'El fondo de caja'),
      validarHorario(b.HorarioAtencion), enlaceMapa(b.UbicacionMapa), v.texto(b.InfoCitas, 'La información de citas', { max: 300 })]);
  res.json(await negocio());
}));

estado.put('/estado', requiereSesion, permitir(ROLES.DUENO), envolver(async (req, res) => {
  const b = req.body || {};
  await db.consultar('UPDATE ESTABLECIMIENTO SET EstadoServicio = ?, MensajeMantenimiento = ? WHERE ID_Local = 1',
    [v.opcion(b.EstadoServicio, 'El estado', ['Activo', 'Suspendido']), v.texto(b.MensajeMantenimiento, 'El mensaje')]);
  reiniciarCache();
  res.json(await db.uno('SELECT EstadoServicio, MensajeMantenimiento FROM ESTABLECIMIENTO WHERE ID_Local = 1'));
}));

// ---- WhatsApp ---------------------------------------------------------------

ajustes.use(requiereSesion, permitir(ROLES.DUENO));

/** Configuración visible (el token y la clave secreta solo se indican como «guardados»). */
async function whatsappPublico(req) {
  let c = await whatsapp.configuracion();
  if (!c.WhatsAppVerifyToken) {       // se genera una sola vez
    await db.consultar('UPDATE ESTABLECIMIENTO SET WhatsAppVerifyToken = ? WHERE ID_Local = 1', [crypto.randomBytes(12).toString('hex')]);
    c = await whatsapp.configuracion();
  }
  const servidor = req && req.headers.host ? `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}` : '';
  return {
    WhatsAppActivo: !!c.WhatsAppActivo, WhatsAppPhoneId: c.WhatsAppPhoneId,
    TokenGuardado: !!c.WhatsAppToken, WhatsAppPlantillaCita: c.WhatsAppPlantillaCita,
    WhatsAppIdiomaPlantilla: c.WhatsAppIdiomaPlantilla, LadaPais: c.LadaPais,
    BotActivo: !!c.BotActivo, BotBienvenida: c.BotBienvenida, VerifyToken: c.WhatsAppVerifyToken,
    AppSecretGuardado: !!c.WhatsAppAppSecret, RutaWebhook: '/api/whatsapp/webhook',
    WebhookLocal: servidor + '/api/whatsapp/webhook'
  };
}

ajustes.get('/whatsapp', envolver(async (req, res) => res.json(await whatsappPublico(req))));

ajustes.put('/whatsapp', envolver(async (req, res) => {
  const b = req.body || {};
  const token = v.texto(b.WhatsAppToken, 'El token', { max: 600 });
  const secreto = v.texto(b.WhatsAppAppSecret, 'La clave secreta de la app', { max: 80 });
  const verificacion = v.texto(b.VerifyToken, 'El token de verificación', { max: 80 });
  if (verificacion && !/^[\w.-]{6,80}$/.test(verificacion)) throw new ErrorApi(400, 'El token de verificación solo lleva letras, números, guiones y puntos (mínimo 6).');
  const campos = ['WhatsAppActivo = ?', 'WhatsAppPhoneId = ?', 'WhatsAppPlantillaCita = ?', 'WhatsAppIdiomaPlantilla = ?', 'LadaPais = ?'];
  const valores = [b.WhatsAppActivo ? 1 : 0, v.texto(b.WhatsAppPhoneId, 'El identificador del número', { max: 40 }),
    v.texto(b.WhatsAppPlantillaCita, 'La plantilla', { max: 100 }),
    v.texto(b.WhatsAppIdiomaPlantilla, 'El idioma de la plantilla', { max: 10 }) || 'es_MX',
    String(b.LadaPais || '52').replace(/\D/g, '').slice(0, 4) || '52'];
  if (b.BotActivo !== undefined) { campos.push('BotActivo = ?'); valores.push(b.BotActivo ? 1 : 0); }
  if (b.BotBienvenida !== undefined) { campos.push('BotBienvenida = ?'); valores.push(v.texto(b.BotBienvenida, 'El saludo del bot', { max: 500 })); }
  if (token) { campos.push('WhatsAppToken = ?'); valores.push(token.replace(/\s+/g, '')); }
  if (secreto) { campos.push('WhatsAppAppSecret = ?'); valores.push(secreto); }
  if (b.QuitarAppSecret) campos.push('WhatsAppAppSecret = NULL');
  if (verificacion) { campos.push('WhatsAppVerifyToken = ?'); valores.push(verificacion); }
  await db.consultar(`UPDATE ESTABLECIMIENTO SET ${campos.join(', ')} WHERE ID_Local = 1`, valores);
  res.json(await whatsappPublico(req));
}));

ajustes.post('/whatsapp/prueba', envolver(async (req, res) => {
  const telefono = v.telefono(req.body && req.body.Telefono);
  res.json(await whatsapp.enviarPrueba(telefono,
    '✅ Prueba de conexión: Engreídos Barbershop ya puede enviar mensajes por WhatsApp.'));
}));

ajustes.post('/whatsapp/conexion', envolver(async (req, res) => res.json(await whatsapp.probarConexion())));

ajustes.post('/whatsapp/bot/simular', envolver(async (req, res) => {
  const mensaje = v.texto(req.body && req.body.Mensaje, 'El mensaje', { max: 500 });
  res.json(await bot.responder(mensaje || ''));
}));

ajustes.get('/whatsapp/chats', envolver(async (req, res) => {
  res.json(await db.consultar(
    `SELECT ID_Chat, DATE_FORMAT(Fecha, '%Y-%m-%d %H:%i:%s') AS Fecha, Telefono, Nombre, Entrante, Texto, Tema, Estado
       FROM WHATSAPP_CHAT ORDER BY ID_Chat DESC LIMIT 60`));
}));

module.exports = { estado, ajustes };
