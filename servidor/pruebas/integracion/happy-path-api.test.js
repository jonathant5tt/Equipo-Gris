/**
 * Prueba de integración · Flujo principal (Happy Path) por la API REST.
 *
 * Levanta el servidor real (app.js, rutas, middleware y servicios) sobre un
 * puerto libre y sustituye solo la conexión a MySQL por la base en memoria
 * (pruebas/apoyo/bd-memoria.js). Recorre, en orden, el flujo del día en la
 * barbería:
 *
 *   Primer uso (Dueño) → inicio de sesión → CU-04 registrar cliente →
 *   CU-16 agendar cita → CU-03 el barbero atiende → CU-05 cobrar y emitir
 *   ticket → venta de membresía → CU-06 cierre de caja.
 *
 * Reloj fijo: jueves 19/11/2026 a las 09:00.
 * Para la misma prueba contra MySQL real: scripts/probar-happy-path.js.
 */
'use strict';

const { describe, it, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const { inyectarBd } = require('../apoyo/inyectar-bd');
const { crearBdMemoria } = require('../apoyo/bd-memoria');

const puente = inyectarBd();
const fechas = require('../../src/servicios/fechas');
const contrasenas = require('../../src/seguridad/contrasenas');

const HOY = '2026-11-19';
mock.method(fechas, 'ahora', () => ({ fecha: HOY, hora: '09:00:00' }));
mock.method(fechas, 'hoy', () => HOY);

const app = require('../../src/app');

let servidor;
let base;
const sesion = {};
const estado = {};

/** Llamada a la API: devuelve { codigo, cuerpo }. */
async function api(metodo, ruta, { token, cuerpo } = {}) {
  const r = await fetch(base + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo)
  });
  const texto = await r.text();
  return { codigo: r.status, cuerpo: texto ? JSON.parse(texto) : null };
}
const tablas = () => puente.actual.tablas;

describe('Happy Path de la API (servidor + base en memoria)', () => {
  before(async () => {
    const claveCaja = await contrasenas.cifrar('caja123');
    const claveBarbero = await contrasenas.cifrar('luis123');
    puente.usar(crearBdMemoria((t) => {
      t.CAJERO.push({ ID_Cajero: 1, Nombre: 'Ana Cajera', Usuario: 'ana', Contrasena: claveCaja, Activo: 1 });
      t.BARBERO[0].Contrasena = claveBarbero;
    }));
    await new Promise((listo) => { servidor = app.listen(0, '127.0.0.1', listo); });
    base = `http://127.0.0.1:${servidor.address().port}`;
  });
  after(() => new Promise((listo) => servidor.close(listo)));

  it('HP-01 El servidor responde en /api/salud', async () => {
    const r = await api('GET', '/api/salud');
    assert.equal(r.codigo, 200);
    assert.deepEqual(r.cuerpo, { estado: 'ok', version: '3.4.0' });
  });

  it('HP-02 Primer uso: se crea la cuenta del Dueño una sola vez', async () => {
    assert.deepEqual((await api('GET', '/api/auth/inicial')).cuerpo, { RequiereDueno: true });
    const r = await api('POST', '/api/auth/primer-dueno', { cuerpo: { Nombre: 'Dueño Engreídos', Usuario: 'dueno', Contrasena: 'dueno123' } });
    assert.equal(r.codigo, 201);
    assert.equal(r.cuerpo.usuario.rol, 'Dueño');
    sesion.dueno = r.cuerpo.token;
    const otra = await api('POST', '/api/auth/primer-dueno', { cuerpo: { Nombre: 'Intruso', Usuario: 'otro', Contrasena: 'abc123' } });
    assert.equal(otra.codigo, 409);
    assert.ok(tablas().ADMINISTRADOR[0].Contrasena.startsWith('scrypt$'), 'la contraseña se guarda cifrada');
  });

  it('HP-03 Inicio de sesión del cajero y del barbero (y rechazo con contraseña incorrecta)', async () => {
    const mala = await api('POST', '/api/auth/login', { cuerpo: { usuario: 'ana', contrasena: 'equivocada' } });
    assert.equal(mala.codigo, 401);
    const caja = await api('POST', '/api/auth/login', { cuerpo: { usuario: 'ANA', contrasena: 'caja123' } });
    assert.equal(caja.codigo, 200);
    assert.equal(caja.cuerpo.usuario.rol, 'Cajero');
    sesion.caja = caja.cuerpo.token;
    const barbero = await api('POST', '/api/auth/login', { cuerpo: { usuario: 'luis', contrasena: 'luis123' } });
    assert.equal(barbero.cuerpo.usuario.rol, 'Barbero');
    sesion.barbero = barbero.cuerpo.token;
    assert.equal((await api('GET', '/api/auth/yo', { token: sesion.caja })).cuerpo.nombre, 'Ana Cajera');
  });

  it('HP-04 CU-04 Registrar nuevo cliente (y evitar teléfonos duplicados)', async () => {
    const r = await api('POST', '/api/clientes', { token: sesion.caja, cuerpo: { Nombre: '  Mario   Ruiz ', Telefono: '228-555-0101' } });
    assert.equal(r.codigo, 201);
    assert.equal(r.cuerpo.Nombre, 'Mario Ruiz');
    assert.equal(r.cuerpo.Telefono, '2285550101');
    assert.equal(r.cuerpo.EstadoMembresia, 'Inactiva');
    estado.cliente = r.cuerpo.ID_Cliente;
    const repetido = await api('POST', '/api/clientes', { token: sesion.caja, cuerpo: { Nombre: 'Otro', Telefono: '2285550101' } });
    assert.equal(repetido.codigo, 409);
  });

  it('HP-05 CU-16 Agendar cita manual en un horario libre (y no encimar otra)', async () => {
    const dia = await api('GET', `/api/citas/disponibilidad?barbero=1&fecha=${HOY}&servicio=1`, { token: sesion.caja });
    assert.equal(dia.codigo, 200);
    assert.equal(dia.cuerpo.Bloques.find((b) => b.Hora === '11:00').Cabe, true);

    const r = await api('POST', '/api/citas', { token: sesion.caja,
      cuerpo: { ID_Cliente: estado.cliente, ID_Barbero: 1, ID_Servicio: 1, FechaHora: `${HOY}T11:00` } });
    assert.equal(r.codigo, 201);
    assert.equal(r.cuerpo.Estado, 'Agendada');
    assert.equal(r.cuerpo.Origen, 'Caja');
    assert.match(r.cuerpo.WhatsApp.Enlace, /^https:\/\/wa\.me\/522285550101\?text=/, 'ofrece el enlace de confirmación por WhatsApp');
    estado.cita = r.cuerpo.ID_Cita;
    assert.equal(tablas().AVISO.length, 1, 'el barbero recibe el aviso de la nueva cita');

    const encimada = await api('POST', '/api/citas', { token: sesion.caja,
      cuerpo: { ID_Cliente: 7, ID_Barbero: 1, ID_Servicio: 1, FechaHora: `${HOY}T11:00` } });
    assert.equal(encimada.codigo, 409);
  });

  it('HP-06 Una fecha que no existe en el calendario se rechaza con 400', async () => {
    const r = await api('POST', '/api/citas', { token: sesion.caja,
      cuerpo: { ID_Cliente: estado.cliente, ID_Barbero: 1, ID_Servicio: 1, FechaHora: '2026-11-31T11:00' } });
    assert.equal(r.codigo, 400);
    assert.equal(tablas().CITA.length, 1, 'no se guardó ninguna cita');
  });

  it('HP-07 CU-03 El barbero atiende la cita: Agendada → EnAtencion → Atendida', async () => {
    const enAtencion = await api('PATCH', `/api/citas/${estado.cita}/estado`, { token: sesion.barbero, cuerpo: { Estado: 'EnAtencion' } });
    assert.equal(enAtencion.cuerpo.Estado, 'EnAtencion');
    const atendida = await api('PATCH', `/api/citas/${estado.cita}/estado`, { token: sesion.barbero, cuerpo: { Estado: 'Atendida' } });
    assert.equal(atendida.cuerpo.Estado, 'Atendida');
    const invalida = await api('PATCH', `/api/citas/${estado.cita}/estado`, { token: sesion.barbero, cuerpo: { Estado: 'Cancelada' } });
    assert.equal(invalida.codigo, 409);
  });

  it('HP-08 CU-05 Calcular y cobrar: cita atendida + 2 aguas en efectivo, con ticket y cambio', async () => {
    const pedido = { ID_Cliente: estado.cliente, Detalle: [{ TipoItem: 'Servicio', ID_Cita: estado.cita }, { TipoItem: 'Producto', ID_Producto: 10, Cantidad: 2 }] };
    const calculo = await api('POST', '/api/ventas/calcular', { token: sesion.caja, cuerpo: pedido });
    assert.equal(calculo.codigo, 200);
    assert.equal(calculo.cuerpo.Total, 200);

    const r = await api('POST', '/api/ventas', { token: sesion.caja,
      cuerpo: { ...pedido, MetodoPago: 'Efectivo', MontoRecibido: 500, TotalEsperado: calculo.cuerpo.Total } });
    assert.equal(r.codigo, 201);
    assert.equal(r.cuerpo.NumeroFactura, 'T-2026-000001');
    assert.equal(r.cuerpo.ImporteTotal, 200);
    assert.equal(r.cuerpo.Cambio, 300);
    assert.equal(r.cuerpo.CobradoPor, 'Ana Cajera (Cajero)');
    assert.equal(r.cuerpo.Detalle.length, 2);
    estado.venta = r.cuerpo.ID_Venta;

    const t = tablas();
    assert.equal(t.PRODUCTO.find((p) => p.ID_Producto === 10).Stock, 3, 'el inventario baja de 5 a 3');
    assert.equal(t.MOVIMIENTO_INVENTARIO.length, 1, 'queda el movimiento de inventario');
    assert.equal(t.CITA[0].ID_Venta, estado.venta, 'la cita queda ligada a su venta');
  });

  it('HP-09 Cobros rechazados no dejan rastro (transacción con ROLLBACK)', async () => {
    const agua = { ID_Cliente: null, Detalle: [{ TipoItem: 'Producto', ID_Producto: 10, Cantidad: 1 }] };
    const cambioPrecio = await api('POST', '/api/ventas', { token: sesion.caja, cuerpo: { ...agua, MetodoPago: 'Tarjeta', TotalEsperado: 20 } });
    assert.equal(cambioPrecio.codigo, 409);
    assert.equal(cambioPrecio.cuerpo.Calculo.Total, 25, 'devuelve el cálculo correcto para mostrarlo');
    const faltaEfectivo = await api('POST', '/api/ventas', { token: sesion.caja, cuerpo: { ...agua, MetodoPago: 'Efectivo', MontoRecibido: 10, TotalEsperado: 25 } });
    assert.equal(faltaEfectivo.codigo, 400);
    const yaCobrada = await api('POST', '/api/ventas', { token: sesion.caja,
      cuerpo: { ID_Cliente: estado.cliente, Detalle: [{ TipoItem: 'Servicio', ID_Cita: estado.cita }], MetodoPago: 'Tarjeta', TotalEsperado: 150 } });
    assert.equal(yaCobrada.codigo, 409);
    assert.equal(tablas().VENTA.length, 1);
    assert.equal(tablas().PRODUCTO.find((p) => p.ID_Producto === 10).Stock, 3);
  });

  it('HP-10 Control de acceso: el barbero no cobra y sin sesión no hay API', async () => {
    assert.equal((await api('POST', '/api/ventas/calcular', { token: sesion.barbero, cuerpo: { Detalle: [] } })).codigo, 403);
    assert.equal((await api('GET', '/api/clientes')).codigo, 401);
  });

  it('HP-11 Venta de membresía: el cliente queda con Premier activa por un mes', async () => {
    const pedido = { ID_Cliente: estado.cliente, Detalle: [{ TipoItem: 'Membresía', ID_Membresia: 3 }] };
    const r = await api('POST', '/api/ventas', { token: sesion.dueno, cuerpo: { ...pedido, MetodoPago: 'Tarjeta', TotalEsperado: 600 } });
    assert.equal(r.codigo, 201);
    assert.equal(r.cuerpo.CobradoPor, 'Dueño Engreídos (Dueño)');
    const fila = tablas().CLIENTE.find((c) => c.ID_Cliente === estado.cliente);
    assert.equal(fila.EstadoMembresia, 'Activa');
    assert.equal(fila.ID_Membresia, 3);
    assert.equal(fila.FechaVencimiento, '2026-12-19');
  });

  it('HP-12 CU-06 Cierre de caja: resumen del turno, corte sin diferencia y no se repite', async () => {
    const resumen = await api('GET', '/api/cierres/resumen', { token: sesion.caja });
    assert.equal(resumen.codigo, 200);
    assert.equal(resumen.cuerpo.NumeroVentas, 2);
    assert.equal(resumen.cuerpo.TotalIngresos, 800);
    assert.equal(resumen.cuerpo.EfectivoEsperado, 700, 'fondo 500 + 200 en efectivo');

    const corte = await api('POST', '/api/cierres', { token: sesion.caja, cuerpo: { EfectivoContado: 700, Arqueo: { 500: 1, 200: 1 } } });
    assert.equal(corte.codigo, 201);
    assert.equal(corte.cuerpo.Diferencia, 0);
    assert.deepEqual(corte.cuerpo.Arqueo, { 500: 1, 200: 1 });
    assert.ok(tablas().VENTA.every((v) => v.ID_Corte === corte.cuerpo.ID_Corte), 'todas las ventas quedan dentro del corte');

    const otraVez = await api('POST', '/api/cierres', { token: sesion.caja, cuerpo: { EfectivoContado: 0 } });
    assert.equal(otraVez.codigo, 409);
  });
});
