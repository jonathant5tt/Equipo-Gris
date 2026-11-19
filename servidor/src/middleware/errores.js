/**
 * @file middleware/errores.js
 * @description Errores de la API y su respuesta JSON uniforme:
 *   HTTP <código>  { "mensaje": "Texto listo para mostrarse al usuario" }
 */
'use strict';

/** Error con código HTTP y mensaje para el usuario. */
class ErrorApi extends Error {
  /**
   * @param {number} estado   Código HTTP (400, 401, 403, 404, 409, 503…).
   * @param {string} mensaje  Texto para el usuario.
   * @param {Object} [datos]  Información adicional que se agrega a la respuesta.
   */
  constructor(estado, mensaje, datos) {
    super(mensaje);
    this.estado = estado;
    this.datos = datos;
  }
}

/**
 * Envuelve un controlador async para que sus errores lleguen al manejador
 * central (Express 4 no captura promesas rechazadas).
 * @param {Function} controlador
 */
const envolver = (controlador) => (req, res, next) => {
  Promise.resolve(controlador(req, res, next)).catch(next);
};

/** Ruta de la API inexistente. */
function noEncontrado(req, res) {
  res.status(404).json({ mensaje: 'Ruta no encontrada.' });
}

/** Traduce cualquier error a una respuesta JSON. */
// eslint-disable-next-line no-unused-vars
function manejador(error, req, res, next) {
  if (error instanceof ErrorApi) {
    return res.status(error.estado).json({ mensaje: error.message, ...(error.datos || {}) });
  }
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ mensaje: 'El archivo es demasiado grande.' });
  }
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ mensaje: 'La información enviada no es válida.' });
  }
  // Errores de MySQL que se deben a datos del usuario
  if (error.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ mensaje: 'Ya existe un registro con esos datos.' });
  }
  if (error.code === 'ER_CHECK_CONSTRAINT_VIOLATED' || error.errno === 3819) {
    return res.status(400).json({ mensaje: 'Algún dato está fuera de los valores permitidos.' });
  }
  if (error.code === 'ER_ROW_IS_REFERENCED_2' || error.errno === 1451) {
    return res.status(409).json({ mensaje: 'No se puede eliminar porque tiene registros relacionados.' });
  }
  if (error.code === 'ECONNREFUSED' || error.code === 'PROTOCOL_CONNECTION_LOST') {
    console.error('[bd] Sin conexión con MySQL:', error.message);
    return res.status(503).json({ mensaje: 'No hay conexión con la base de datos.' });
  }
  console.error('[error]', req.method, req.originalUrl, error);
  return res.status(500).json({ mensaje: 'Ocurrió un error en el servidor. Intenta de nuevo.' });
}

module.exports = { ErrorApi, envolver, noEncontrado, manejador };
