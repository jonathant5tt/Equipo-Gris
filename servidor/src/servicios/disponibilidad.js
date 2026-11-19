/**
 * @file servicios/disponibilidad.js
 * @description Agenda de un barbero: bloques del día y estado de cada día.
 *
 * Reglas:
 *  - La agenda se divide en bloques de PASO_AGENDA_MIN (30 min) dentro de la
 *    jornada del barbero (HoraEntrada → HoraSalida).
 *  - Un bloque es «Comida» si cae en su horario de comida, «Ocupado» si lo
 *    cubre una cita activa y «NoDisponible» si la hora ya pasó.
 *  - Un bloque «Libre» se puede elegir solo si cabe la duración completa del
 *    servicio sin chocar con comida, otras citas ni el fin de la jornada.
 *  - Un día es «NoDisponible» si es descanso del barbero, si el servicio no
 *    se ofrece ese día o si ya pasó; «Ocupado» si no queda ningún hueco.
 */
'use strict';

const config = require('../config');
const f = require('./fechas');
const { ErrorApi } = require('../middleware/errores');

const PASO = config.PASO_AGENDA_MIN;
/** Estados de cita que ocupan lugar en la agenda. */
const ESTADOS_ACTIVOS = "('Agendada','EnEspera','EnAtencion','Atendida')";

/**
 * @param {{uno: Function}} db
 * @returns {Promise<Object>} Barbero activo.
 */
async function obtenerBarbero(db, idBarbero) {
  const barbero = await db.uno(
    `SELECT ID_Barbero, Nombre, HoraEntrada, HoraSalida, ComidaInicio, ComidaFin, DiasTrabajo
       FROM BARBERO WHERE ID_Barbero = ? AND Activo = 1`, [idBarbero]);
  if (!barbero) throw new ErrorApi(404, 'El barbero no existe o ya no está activo.');
  return barbero;
}

/**
 * Calcula los bloques de un día.
 * @param {{consultar: Function, uno: Function}} db
 * @param {Object} barbero   Fila de BARBERO.
 * @param {string} fecha     'AAAA-MM-DD'
 * @param {Object|null} servicio  Fila de SERVICIO (para duración y días disponibles).
 * @param {number} [ignorarCita]  ID de cita a ignorar (reprogramación).
 */
async function diaDeAgenda(db, barbero, fecha, servicio, ignorarCita) {
  const duracion = servicio ? Number(servicio.DuracionMin) : PASO;
  const letra = f.letraDia(fecha);
  const { fecha: hoy, hora } = f.ahora();
  const resultado = { Fecha: fecha, Estado: 'Libre', Motivo: null, Libres: 0, DuracionMin: duracion, Bloques: [] };

  if (fecha < hoy) return { ...resultado, Estado: 'NoDisponible', Motivo: 'Fecha pasada' };
  if (!String(barbero.DiasTrabajo).split(',').includes(letra)) return { ...resultado, Estado: 'NoDisponible', Motivo: 'Descanso del barbero' };
  if (servicio && servicio.DiasDisponibles && !servicio.DiasDisponibles.split(',').includes(letra)) {
    return { ...resultado, Estado: 'NoDisponible', Motivo: 'El servicio no se ofrece este día' };
  }

  const entrada = f.aMinutos(barbero.HoraEntrada);
  const salida = f.aMinutos(barbero.HoraSalida);
  const comida = barbero.ComidaInicio ? [f.aMinutos(barbero.ComidaInicio), f.aMinutos(barbero.ComidaFin)] : null;
  const ahoraMin = fecha === hoy ? f.aMinutos(hora) : -1;

  const citas = (await db.consultar(
    `SELECT c.ID_Cita, TIME(c.FechaHora) AS Hora, c.DuracionMin, c.Estado, c.Origen,
            cl.Nombre AS NombreCliente, s.NombreServicio
       FROM CITA c
       JOIN CLIENTE cl ON cl.ID_Cliente = c.ID_Cliente
       JOIN SERVICIO s ON s.ID_Servicio = c.ID_Servicio
      WHERE c.ID_Barbero = ? AND DATE(c.FechaHora) = ? AND c.Estado IN ${ESTADOS_ACTIVOS}
        AND c.ID_Cita <> ?
      ORDER BY c.FechaHora`, [barbero.ID_Barbero, fecha, ignorarCita || 0]))
    .map((c) => ({ ...c, inicio: f.aMinutos(c.Hora), fin: f.aMinutos(c.Hora) + Number(c.DuracionMin) }));

  const choca = (a, b, c, d) => a < d && c < b;   // [a,b) ∩ [c,d) ≠ ∅
  const libreEntre = (ini, fin) => fin <= salida &&
    !(comida && choca(ini, fin, comida[0], comida[1])) &&
    !citas.some((c) => choca(ini, fin, c.inicio, c.fin));

  for (let t = entrada; t + PASO <= salida; t += PASO) {
    const bloque = { Hora: f.aHora(t), Estado: 'Libre', Cabe: false };
    const cita = citas.find((c) => choca(t, t + PASO, c.inicio, c.fin));
    if (comida && choca(t, t + PASO, comida[0], comida[1])) {
      Object.assign(bloque, { Estado: 'NoDisponible', Motivo: 'Comida' });
    } else if (cita) {
      Object.assign(bloque, {
        Estado: 'Ocupado', ID_Cita: cita.ID_Cita, NombreCliente: cita.NombreCliente,
        NombreServicio: cita.NombreServicio, Origen: cita.Origen, Inicio: cita.inicio === t
      });
    } else if (t <= ahoraMin) {
      Object.assign(bloque, { Estado: 'NoDisponible', Motivo: 'Hora pasada' });
    } else {
      bloque.Cabe = libreEntre(t, t + duracion);
      if (bloque.Cabe) resultado.Libres += 1;
    }
    resultado.Bloques.push(bloque);
  }

  if (!resultado.Libres) {
    resultado.Estado = resultado.Bloques.some((b) => b.Estado === 'Ocupado') ? 'Ocupado' : 'NoDisponible';
    resultado.Motivo = resultado.Estado === 'Ocupado' ? 'Sin horarios libres' : 'Fuera de horario';
  }
  return resultado;
}

/**
 * Confirma que una hora concreta se puede agendar (dentro de una transacción).
 * @returns {Promise<void>} Lanza 409 si no está libre.
 */
async function confirmarHueco(db, barbero, fecha, horaTexto, servicio, ignorarCita) {
  const dia = await diaDeAgenda(db, barbero, fecha, servicio, ignorarCita);
  if (dia.Estado === 'NoDisponible' && dia.Motivo !== 'Fuera de horario') {
    throw new ErrorApi(409, `No se puede agendar ese día: ${dia.Motivo.toLowerCase()}.`);
  }
  const bloque = dia.Bloques.find((b) => b.Hora === horaTexto.slice(0, 5));
  if (!bloque) throw new ErrorApi(409, 'Esa hora está fuera de la jornada del barbero.');
  if (!bloque.Cabe) throw new ErrorApi(409, 'Ese horario ya no está disponible. Elige otro.');
}

module.exports = { obtenerBarbero, diaDeAgenda, confirmarHueco, ESTADOS_ACTIVOS };
