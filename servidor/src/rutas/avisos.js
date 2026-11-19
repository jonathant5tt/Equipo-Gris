/**
 * @file rutas/avisos.js
 * @description Avisos para el barbero (nuevas citas, cancelaciones y cambios de horario).
 *
 *   GET  /api/avisos           B   Avisos no leídos (máx. 20)
 *   POST /api/avisos/leidos    B   Marca todos como leídos
 */
'use strict';

const express = require('../lib/web');
const db = require('../db');
const { ROLES, requiereSesion, permitir } = require('../middleware/autenticacion');
const { envolver } = require('../middleware/errores');

const router = express.Router();
router.use(requiereSesion, permitir(ROLES.BARBERO));

router.get('/', envolver(async (req, res) => {
  res.json(await db.consultar(
    'SELECT ID_Aviso, Tipo, Mensaje, Fecha FROM AVISO WHERE ID_Barbero = ? AND Leido = 0 ORDER BY Fecha DESC LIMIT 20',
    [req.usuario.id]));
}));

router.post('/leidos', envolver(async (req, res) => {
  await db.consultar('UPDATE AVISO SET Leido = 1 WHERE ID_Barbero = ? AND Leido = 0', [req.usuario.id]);
  res.status(204).end();
}));

module.exports = router;
