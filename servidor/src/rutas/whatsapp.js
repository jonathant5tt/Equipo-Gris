/**
 * @file rutas/whatsapp.js
 * @description Webhook de WhatsApp Cloud (Meta): aquí llegan los mensajes que
 * los clientes escriben al número de la barbería y desde aquí responde el bot.
 *
 *   GET  /api/whatsapp/webhook   Verificación de Meta (hub.verify_token → hub.challenge)
 *   POST /api/whatsapp/webhook   Mensajes entrantes
 *
 * Son rutas públicas (Meta no inicia sesión). Se protegen con:
 *   - el «token de verificación» que solo conocen Meta y este sistema, y
 *   - la firma X-Hub-Signature-256 (si se guardó la «clave secreta de la app»).
 *
 * Meta necesita una dirección https pública; ver docs/WHATSAPP.md.
 */
'use strict';

const crypto = require('crypto');
const express = require('../lib/web');
const db = require('../db');
const whatsapp = require('../servicios/whatsapp');
const bot = require('../servicios/bot');
const { envolver } = require('../middleware/errores');

const router = express.Router();

/** Comparación en tiempo constante. */
function iguales(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Mensajes ya atendidos (Meta reintenta la entrega si tardamos en contestar). */
const atendidos = new Map();
function yaAtendido(id) {
  const ahora = Date.now();
  if (atendidos.size > 500) for (const [k, t] of atendidos) if (ahora - t > 3600e3) atendidos.delete(k);
  if (atendidos.has(id)) return true;
  atendidos.set(id, ahora);
  return false;
}

/** Guarda un renglón de la conversación (nunca detiene la respuesta). */
function anotar(telefono, nombre, entrante, texto, tema, estado) {
  return db.consultar(
    'INSERT INTO WHATSAPP_CHAT (Telefono, Nombre, Entrante, Texto, Tema, Estado) VALUES (?, ?, ?, ?, ?, ?)',
    [String(telefono).slice(0, 20), nombre ? String(nombre).slice(0, 100) : null, entrante ? 1 : 0,
      String(texto || '').slice(0, 1500), tema ? String(tema).slice(0, 30) : null, estado ? String(estado).slice(0, 200) : null]
  ).catch((e) => console.error('[bot] No se pudo guardar la conversación:', e.message));
}

/** Texto que escribió el cliente, según el tipo de mensaje. */
function textoDe(m) {
  if (m.type === 'text') return (m.text && m.text.body) || '';
  if (m.type === 'button') return (m.button && m.button.text) || '';
  if (m.type === 'interactive') {
    const i = m.interactive || {};
    return (i.button_reply && i.button_reply.title) || (i.list_reply && i.list_reply.title) || '';
  }
  return null;   // audio, imagen, ubicación, sticker…
}

/** Atiende un mensaje entrante. */
async function atender(cfg, mensaje, nombre) {
  if (!mensaje || !mensaje.from || !mensaje.id || yaAtendido(mensaje.id)) return;
  const texto = textoDe(mensaje);
  await anotar(mensaje.from, nombre, true, texto == null ? `[${mensaje.type}]` : texto, null, null);
  if (!cfg.BotActivo) return;

  let r;
  if (texto == null) {
    r = { Tema: 'otro', Respuesta: 'Por ahora solo puedo leer mensajes de texto. 🙂 Escribe *menú* para ver en qué te puedo ayudar.' };
  } else {
    r = await bot.responder(texto);
  }
  let estado = 'Enviado';
  try {
    whatsapp.marcarLeido(cfg, mensaje.id);
    await whatsapp.responderTexto(cfg, mensaje.from, r.Respuesta);
  } catch (e) {
    estado = e.message;
    console.warn('[bot] No se pudo responder:', e.message);
  }
  await anotar(mensaje.from, nombre, false, r.Respuesta, r.Tema, estado);
}

// ---- Verificación (Meta la hace una vez, al guardar la dirección del webhook) ----
router.get('/webhook', envolver(async (req, res) => {
  const cfg = await whatsapp.configuracion();
  const q = req.query || {};
  if (q['hub.mode'] === 'subscribe' && cfg && cfg.WhatsAppVerifyToken && iguales(q['hub.verify_token'], cfg.WhatsAppVerifyToken)) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end(String(q['hub.challenge'] || ''));
  }
  res.status(403).json({ error: 'Token de verificación incorrecto.' });
}));

// ---- Mensajes ---------------------------------------------------------------
router.post('/webhook', envolver(async (req, res) => {
  const cfg = await whatsapp.configuracion();
  if (cfg && cfg.WhatsAppAppSecret) {
    const firma = 'sha256=' + crypto.createHmac('sha256', cfg.WhatsAppAppSecret).update(req.rawBody || '').digest('hex');
    if (!iguales(firma, req.headers['x-hub-signature-256'])) return res.status(401).json({ error: 'Firma incorrecta.' });
  }
  // Meta espera la respuesta en pocos segundos: se contesta ya y se atiende después.
  res.status(200).json({ recibido: true });

  const b = req.body || {};
  if (b.object !== 'whatsapp_business_account' || !cfg) return;
  for (const entrada of b.entry || []) {
    for (const cambio of entrada.changes || []) {
      const valor = cambio.value || {};
      // Solo los mensajes dirigidos a nuestro número.
      if (cfg.WhatsAppPhoneId && valor.metadata && valor.metadata.phone_number_id &&
          String(valor.metadata.phone_number_id) !== String(cfg.WhatsAppPhoneId)) continue;
      const nombres = Object.fromEntries((valor.contacts || []).map((c) => [c.wa_id, c.profile && c.profile.name]));
      for (const mensaje of valor.messages || []) {
        try { await atender(cfg, mensaje, nombres[mensaje.from]); }
        catch (e) { console.error('[bot] Error al atender un mensaje:', e.message); }
      }
    }
  }
}));

module.exports = router;
module.exports.anotar = anotar;
