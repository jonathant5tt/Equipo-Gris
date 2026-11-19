/**
 * @file middleware/suspension.js
 * @description Bloqueo por «servicio suspendido».
 *
 * Mientras ESTABLECIMIENTO.EstadoServicio = 'Suspendido', Cajero y Barbero
 * reciben 503 y la interfaz los envía a la pantalla de mantenimiento. El Dueño
 * sigue operando para poder reanudar el servicio.
 */
'use strict';

const db = require('../db');
const { ROLES } = require('./autenticacion');
const { envolver } = require('./errores');

let cache = { estado: null, hasta: 0 };

/** Estado del servicio con caché de 5 segundos. */
async function estadoServicio() {
  if (cache.estado && Date.now() < cache.hasta) return cache.estado;
  const fila = await db.uno('SELECT EstadoServicio, MensajeMantenimiento FROM ESTABLECIMIENTO WHERE ID_Local = 1');
  cache = { estado: fila || { EstadoServicio: 'Activo', MensajeMantenimiento: null }, hasta: Date.now() + 5000 };
  return cache.estado;
}

/** Olvida la caché (después de suspender o reanudar). */
function reiniciarCache() { cache = { estado: null, hasta: 0 }; }

const bloquearSiSuspendido = envolver(async (req, res, next) => {
  if (req.usuario && req.usuario.rol === ROLES.DUENO) return next();
  const estado = await estadoServicio();
  if (estado.EstadoServicio === 'Suspendido') {
    return res.status(503).json({
      mensaje: estado.MensajeMantenimiento || 'El servicio está suspendido temporalmente.',
      EstadoServicio: 'Suspendido',
      MensajeMantenimiento: estado.MensajeMantenimiento
    });
  }
  next();
});

module.exports = { bloquearSiSuspendido, estadoServicio, reiniciarCache };
