/**
 * Pruebas unitarias · servicios/disponibilidad.js
 * Componente crítico de CU-01 «Agendar cita vía WhatsApp» y CU-16 «Agendar
 * cita manual»: decide qué horarios se ofrecen y evita citas encimadas.
 *
 * Barbero de prueba: Luis, de 10:00 a 20:00, comida de 14:00 a 15:00,
 * trabaja de lunes a sábado. Reloj fijo: jueves 19/11/2026 a las 09:00.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const agenda = require('../../src/servicios/disponibilidad');
const { crearBdMemoria } = require('../apoyo/bd-memoria');
const { fijarReloj } = require('../apoyo/reloj');

const VIERNES = '2026-11-20';
const CORTE = { ID_Servicio: 1, NombreServicio: 'Corte', DuracionMin: 30, DiasDisponibles: null };
const UNA_HORA = { ID_Servicio: 9, NombreServicio: 'Corte y barba', DuracionMin: 60, DiasDisponibles: null };
const SOLO_SABADO = { ID_Servicio: 3, NombreServicio: 'Ritual Facial', DuracionMin: 60, DiasDisponibles: 'S' };

const conCita = (hora, duracion = 60, estado = 'Agendada') => crearBdMemoria((t) => t.CITA.push({
  ID_Cita: 1, ID_Cliente: 8, ID_Barbero: 1, ID_Servicio: 1, FechaHora: `${VIERNES} ${hora}:00`, DuracionMin: duracion,
  Estado: estado, Origen: 'Caja', ID_Venta: null
}));

async function dia(t, bd, fecha, servicio, ignorar) {
  const barbero = await agenda.obtenerBarbero(bd, 1);
  return agenda.diaDeAgenda(bd, barbero, fecha, servicio, ignorar);
}
const bloque = (d, hora) => d.Bloques.find((b) => b.Hora === hora);

describe('Agenda y disponibilidad (servicios/disponibilidad.js)', () => {
  it('PU-DIS-01 Día libre: bloques de 30 min y la hora de comida bloqueada', async (t) => {
    fijarReloj(t, '2026-11-19');
    const d = await dia(t, crearBdMemoria(), VIERNES, CORTE);
    assert.equal(d.Estado, 'Libre');
    assert.equal(d.Bloques.length, 20, '10:00 a 19:30');
    assert.equal(bloque(d, '14:00').Motivo, 'Comida');
    assert.equal(bloque(d, '14:30').Motivo, 'Comida');
    assert.equal(d.Libres, 18);
  });

  it('PU-DIS-02 Servicio de 60 min: no se ofrece si choca con la comida o el cierre', async (t) => {
    fijarReloj(t, '2026-11-19');
    const d = await dia(t, crearBdMemoria(), VIERNES, UNA_HORA);
    assert.equal(bloque(d, '13:30').Cabe, false, 'chocaría con la comida');
    assert.equal(bloque(d, '19:30').Cabe, false, 'terminaría después de las 20:00');
    assert.equal(bloque(d, '19:00').Cabe, true);
    assert.equal(d.Libres, 16);
  });

  it('PU-DIS-03 Cita existente: ocupa sus bloques y no permite encimar otra', async (t) => {
    fijarReloj(t, '2026-11-19');
    const d = await dia(t, conCita('11:00', 60), VIERNES, UNA_HORA);
    assert.equal(bloque(d, '11:00').Estado, 'Ocupado');
    assert.equal(bloque(d, '11:00').Inicio, true);
    assert.equal(bloque(d, '11:30').Estado, 'Ocupado');
    assert.equal(bloque(d, '11:30').Inicio, false);
    assert.equal(bloque(d, '10:30').Cabe, false, '10:30-11:30 se enciman con la cita');
    assert.equal(bloque(d, '12:00').Cabe, true);
  });

  it('PU-DIS-04 Citas canceladas no ocupan lugar', async (t) => {
    fijarReloj(t, '2026-11-19');
    const d = await dia(t, conCita('11:00', 60, 'Cancelada'), VIERNES, CORTE);
    assert.equal(bloque(d, '11:00').Estado, 'Libre');
  });

  it('PU-DIS-05 Días no disponibles: descanso, fecha pasada y servicio que no se ofrece ese día', async (t) => {
    fijarReloj(t, '2026-11-19');
    const bd = crearBdMemoria();
    assert.deepEqual([(await dia(t, bd, '2026-11-22', CORTE)).Motivo], ['Descanso del barbero']);
    assert.deepEqual([(await dia(t, bd, '2026-11-18', CORTE)).Motivo], ['Fecha pasada']);
    assert.deepEqual([(await dia(t, bd, VIERNES, SOLO_SABADO)).Motivo], ['El servicio no se ofrece este día']);
    assert.equal((await dia(t, bd, '2026-11-21', SOLO_SABADO)).Estado, 'Libre');
  });

  it('PU-DIS-06 Hoy: las horas que ya pasaron no se ofrecen', async (t) => {
    fijarReloj(t, '2026-11-19', '15:10:00');
    const d = await dia(t, crearBdMemoria(), '2026-11-19', CORTE);
    assert.equal(bloque(d, '15:00').Motivo, 'Hora pasada');
    assert.equal(bloque(d, '15:30').Cabe, true);
    assert.equal(d.Libres, 9, '15:30 a 19:30');
  });

  it('PU-DIS-07 Día lleno: estado «Ocupado» cuando no queda ningún hueco', async (t) => {
    fijarReloj(t, '2026-11-19');
    const bd = crearBdMemoria((tb) => {
      tb.CITA.push({ ID_Cita: 1, ID_Cliente: 8, ID_Barbero: 1, ID_Servicio: 1, FechaHora: `${VIERNES} 10:00:00`, DuracionMin: 240, Estado: 'Agendada' });
      tb.CITA.push({ ID_Cita: 2, ID_Cliente: 7, ID_Barbero: 1, ID_Servicio: 1, FechaHora: `${VIERNES} 15:00:00`, DuracionMin: 300, Estado: 'Agendada' });
    });
    const d = await dia(t, bd, VIERNES, CORTE);
    assert.equal(d.Estado, 'Ocupado');
    assert.equal(d.Motivo, 'Sin horarios libres');
  });

  it('PU-DIS-08 confirmarHueco: acepta un horario libre y rechaza uno ocupado o fuera de jornada', async (t) => {
    fijarReloj(t, '2026-11-19');
    const bd = conCita('11:00', 60);
    const barbero = await agenda.obtenerBarbero(bd, 1);
    await assert.doesNotReject(agenda.confirmarHueco(bd, barbero, VIERNES, '12:00', CORTE));
    await assert.rejects(agenda.confirmarHueco(bd, barbero, VIERNES, '11:30', CORTE), (e) => e.estado === 409 && /ya no está disponible/.test(e.message));
    await assert.rejects(agenda.confirmarHueco(bd, barbero, VIERNES, '21:00', CORTE), (e) => e.estado === 409 && /fuera de la jornada/.test(e.message));
    await assert.rejects(agenda.confirmarHueco(bd, barbero, '2026-11-22', '12:00', CORTE), (e) => e.estado === 409 && /descanso/.test(e.message));
  });

  it('PU-DIS-09 Reprogramación: la cita que se mueve no se bloquea a sí misma', async (t) => {
    fijarReloj(t, '2026-11-19');
    const bd = conCita('11:00', 60);
    const barbero = await agenda.obtenerBarbero(bd, 1);
    await assert.doesNotReject(agenda.confirmarHueco(bd, barbero, VIERNES, '11:30', CORTE, 1));
  });

  it('PU-DIS-10 Barbero inexistente o dado de baja: 404', async () => {
    const bd = crearBdMemoria((tb) => { tb.BARBERO[0].Activo = 0; });
    await assert.rejects(agenda.obtenerBarbero(bd, 1), (e) => e.estado === 404);
    await assert.rejects(agenda.obtenerBarbero(crearBdMemoria(), 99), (e) => e.estado === 404);
  });
});
