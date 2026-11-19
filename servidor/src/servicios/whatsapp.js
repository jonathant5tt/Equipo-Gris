/**
 * @file servicios/whatsapp.js
 * @description Envío de mensajes con la API de WhatsApp Cloud (Meta).
 *
 * Configuración (Ajustes → WhatsApp, tabla ESTABLECIMIENTO):
 *   WhatsAppActivo, WhatsAppPhoneId (identificador del número), WhatsAppToken
 *   (token de acceso), WhatsAppPlantillaCita e idioma de la plantilla.
 *
 * Importante (reglas de Meta): un negocio solo puede enviar texto libre a un
 * cliente que le escribió en las últimas 24 h. Para avisar citas a cualquier
 * cliente se necesita una PLANTILLA aprobada en WhatsApp Manager con 6
 * variables en este orden: {{1}} cliente, {{2}} fecha, {{3}} hora,
 * {{4}} servicio, {{5}} duración, {{6}} barbero.
 *
 * Si la API no está configurada o falla, se devuelve un enlace wa.me con el
 * mensaje listo para que el usuario lo envíe desde su WhatsApp.
 */
'use strict';

const config = require('../config');
const db = require('../db');

/** Configuración de WhatsApp guardada (incluye el token: uso interno). */
async function configuracion() {
  return db.uno(
    `SELECT WhatsAppActivo, WhatsAppPhoneId, WhatsAppToken, WhatsAppPlantillaCita,
            WhatsAppIdiomaPlantilla, LadaPais, BotActivo, BotBienvenida, WhatsAppVerifyToken, WhatsAppAppSecret
       FROM ESTABLECIMIENTO WHERE ID_Local = 1`);
}

/**
 * Número en formato internacional sin «+» (ej. 522281234567).
 * @param {string} telefono  10 dígitos
 * @param {string} [lada]    '+52'
 */
function numeroInternacional(telefono, lada) {
  const digitos = String(telefono || '').replace(/\D/g, '');
  if (!digitos) return null;
  if (digitos.length > 10) return digitos;
  return String(lada || '+52').replace(/\D/g, '') + digitos;
}

/** Enlace para abrir WhatsApp con el mensaje escrito. */
const enlace = (numero, texto) => `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;

/** Explicación en español de los errores más comunes de Meta. */
const AYUDA_ERROR = {
  190: 'El token de acceso no es válido o ya venció. Genera uno nuevo en Meta (de preferencia un token permanente de usuario del sistema) y guárdalo otra vez.',
  100: 'El identificador del número (Phone number ID) no es correcto o el token no tiene permiso sobre ese número. Copia el «Identificador de número de teléfono», no el número telefónico.',
  10: 'El token no tiene el permiso whatsapp_business_messaging. Vuelve a generarlo marcando ese permiso.',
  200: 'El token no tiene permisos suficientes para este número.',
  4: 'Meta está limitando los envíos por ahora. Espera unos minutos.',
  80007: 'Meta está limitando los envíos por ahora. Espera unos minutos.',
  130429: 'Se alcanzó el límite de mensajes por segundo. Intenta de nuevo en un momento.',
  131026: 'Ese número no puede recibir el mensaje: no tiene WhatsApp o no ha aceptado los términos más recientes.',
  131030: 'La cuenta está en modo de prueba y ese teléfono no está en la lista de destinatarios permitidos. Agrégalo en Meta → WhatsApp → Configuración de la API → «Para».',
  131047: 'Pasaron más de 24 horas desde el último mensaje del cliente. Solo se le puede escribir con una plantilla aprobada.',
  131031: 'Meta bloqueó la cuenta de WhatsApp Business. Revisa el estado en WhatsApp Manager.',
  131042: 'Hay un problema con el método de pago de la cuenta de WhatsApp Business.',
  132000: 'El número de variables no coincide con la plantilla aprobada.',
  132001: 'La plantilla no existe con ese nombre e idioma, o todavía no está aprobada.',
  133010: 'El número todavía no está registrado en la API de WhatsApp Cloud. Regístralo en WhatsApp Manager.'
};

/** Convierte la respuesta de error de Meta en un mensaje entendible. */
function errorDeMeta(datos, estado) {
  const e = (datos && datos.error) || {};
  const ayuda = AYUDA_ERROR[e.code] || AYUDA_ERROR[e.error_subcode];
  const original = e.error_user_msg || (e.error_data && e.error_data.details) || e.message || `HTTP ${estado}`;
  const error = new Error(ayuda ? `${ayuda} (Meta ${e.code}: ${original})` : original);
  error.codigoMeta = e.code || null;
  return error;
}

/** Petición a la API Graph de Meta. */
async function graph(cfg, ruta, opciones = {}) {
  let respuesta;
  try {
    respuesta = await fetch(`${config.WHATSAPP_API_URL}/${config.WHATSAPP_API_VERSION}/${ruta}`, {
      method: opciones.cuerpo ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${cfg.WhatsAppToken}`, 'Content-Type': 'application/json' },
      body: opciones.cuerpo ? JSON.stringify(opciones.cuerpo) : undefined,
      signal: AbortSignal.timeout(15000)
    });
  } catch (e) {
    throw new Error('No se pudo conectar con los servidores de WhatsApp. Revisa que la computadora del servidor tenga internet.');
  }
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) throw errorDeMeta(datos, respuesta.status);
  return datos;
}

/** Envía un mensaje (texto o plantilla). */
const llamarApi = (cfg, cuerpo) =>
  graph(cfg, `${encodeURIComponent(cfg.WhatsAppPhoneId)}/messages`, { cuerpo: { messaging_product: 'whatsapp', ...cuerpo } });

/**
 * Comprueba el identificador del número y el token sin enviar ningún mensaje.
 * @returns {Promise<{Conectado: boolean, Numero?: string, Nombre?: string, Calidad?: string, Error?: string}>}
 */
async function probarConexion() {
  const cfg = await configuracion();
  if (!cfg || !cfg.WhatsAppPhoneId || !cfg.WhatsAppToken) {
    return { Conectado: false, Error: 'Falta guardar el identificador del número y el token de acceso.' };
  }
  try {
    const d = await graph(cfg, `${encodeURIComponent(cfg.WhatsAppPhoneId)}?fields=display_phone_number,verified_name,quality_rating`);
    return { Conectado: true, Numero: d.display_phone_number || null, Nombre: d.verified_name || null, Calidad: d.quality_rating || null };
  } catch (e) {
    return { Conectado: false, Error: e.message };
  }
}

/**
 * Respuesta del bot: texto libre al número que acaba de escribir (ya viene en
 * formato internacional). Lanza error si Meta lo rechaza.
 */
async function responderTexto(cfg, numero, texto) {
  return llamarApi(cfg, { to: numero, type: 'text', text: { body: String(texto).slice(0, 4000), preview_url: true } });
}

/** Marca como leído el mensaje del cliente (palomitas azules). No es indispensable. */
function marcarLeido(cfg, idMensaje) {
  return llamarApi(cfg, { status: 'read', message_id: idMensaje }).catch(() => null);
}

/** Guarda el resultado del envío (bitácora). */
function registrar(telefono, tipo, estado, detalle, ids = {}) {
  return db.consultar(
    'INSERT INTO MENSAJE_WHATSAPP (Telefono, Tipo, Estado, Detalle, ID_Cita, ID_Venta) VALUES (?, ?, ?, ?, ?, ?)',
    [telefono, tipo, estado, String(detalle || '').slice(0, 500), ids.ID_Cita || null, ids.ID_Venta || null]
  ).catch((e) => console.error('[whatsapp] No se pudo registrar el envío:', e.message));
}

/**
 * Envía un mensaje. Nunca lanza error: devuelve el resultado.
 * @param {Object} opciones
 * @param {string} opciones.telefono   10 dígitos del cliente
 * @param {string} [opciones.lada]
 * @param {string} opciones.texto      Mensaje completo (texto libre / enlace)
 * @param {'Cita'|'Ticket'|'Prueba'} opciones.tipo
 * @param {{nombre: string, parametros: string[]}} [opciones.plantilla]
 * @param {Object} [opciones.ids]      { ID_Cita, ID_Venta } para la bitácora
 * @returns {Promise<{Enviado: boolean, Enlace: string|null, Texto: string, Error?: string, Configurado: boolean}>}
 */
async function enviar({ telefono, lada, texto, tipo, plantilla, ids }) {
  const cfg = await configuracion();
  const numero = numeroInternacional(telefono, lada || (cfg && '+' + cfg.LadaPais));
  const resultado = { Enviado: false, Configurado: false, Texto: texto, Enlace: numero ? enlace(numero, texto) : null, Telefono: numero };
  if (!numero) return { ...resultado, Error: 'El cliente no tiene teléfono registrado.' };

  const listo = cfg && cfg.WhatsAppActivo && cfg.WhatsAppPhoneId && cfg.WhatsAppToken;
  if (!listo) return resultado;
  resultado.Configurado = true;

  try {
    if (plantilla && plantilla.nombre) {
      await llamarApi(cfg, {
        to: numero, type: 'template',
        template: {
          name: plantilla.nombre,
          language: { code: cfg.WhatsAppIdiomaPlantilla || 'es_MX' },
          components: [{ type: 'body', parameters: plantilla.parametros.map((t) => ({ type: 'text', text: String(t) })) }]
        }
      });
    } else {
      await llamarApi(cfg, { to: numero, type: 'text', text: { body: texto, preview_url: false } });
    }
    await registrar(numero, tipo, 'Enviado', plantilla ? `Plantilla ${plantilla.nombre}` : 'Texto', ids);
    return { ...resultado, Enviado: true };
  } catch (error) {
    console.warn('[whatsapp] Error al enviar:', error.message);
    await registrar(numero, tipo, 'Error', error.message, ids);
    return { ...resultado, Error: error.message };
  }
}

/**
 * Mensaje de prueba. Primero intenta texto libre; si Meta lo rechaza porque el
 * teléfono no ha escrito en las últimas 24 h, envía la plantilla «hello_world»
 * que todas las cuentas tienen aprobada.
 */
async function enviarPrueba(telefono, texto) {
  const r = await enviar({ telefono, tipo: 'Prueba', texto });
  if (r.Enviado || !r.Configurado || !/Meta 131047|24 horas/.test(r.Error || '')) return r;
  const cfg = await configuracion();
  try {
    await llamarApi(cfg, { to: r.Telefono, type: 'template', template: { name: 'hello_world', language: { code: 'en_US' } } });
    await registrar(r.Telefono, 'Prueba', 'Enviado', 'Plantilla hello_world');
    return { ...r, Enviado: true, Error: undefined, Plantilla: 'hello_world' };
  } catch (e) {
    return { ...r, Error: e.message };
  }
}

module.exports = { enviar, enviarPrueba, configuracion, numeroInternacional, enlace, probarConexion, responderTexto, marcarLeido };
