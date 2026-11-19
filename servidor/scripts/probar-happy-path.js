#!/usr/bin/env node
/**
 * @file scripts/probar-happy-path.js
 * @description Prueba de punta a punta del flujo principal contra el servidor
 * REAL y su base de datos MySQL (complementa a las pruebas automáticas, que
 * usan una base en memoria).
 *
 *   1. Enciende el servidor apuntando a una base de PRUEBAS
 *      (en servidor/.env: BD_NOMBRE=engreidos_pruebas) y crea la cuenta del Dueño.
 *   2. En otra terminal:
 *        node scripts/probar-happy-path.js --base-de-pruebas \
 *             --url http://localhost:3000 --usuario dueno --contrasena ****
 *      (opcional --con-cierre para hacer también el corte de caja)
 *
 * Crea datos con el sufijo «HP-<hora>» (servicio, producto, barbero, cajero,
 * cliente), recorre CU-04 → CU-16 → CU-03 → CU-05 (→ CU-06) y al final da de
 * baja (borrado lógico) el catálogo y las cuentas de prueba. Las ventas se
 * conservan porque son registros contables.
 */
'use strict';

const argumentos = process.argv.slice(2);
const opcion = (nombre, porOmision) => {
  const i = argumentos.indexOf(`--${nombre}`);
  return i >= 0 && argumentos[i + 1] && !argumentos[i + 1].startsWith('--') ? argumentos[i + 1] : porOmision;
};
const bandera = (nombre) => argumentos.includes(`--${nombre}`);

const URL_BASE = opcion('url', process.env.HP_URL || 'http://localhost:3000').replace(/\/+$/, '');
const USUARIO = opcion('usuario', process.env.HP_USUARIO);
const CONTRASENA = opcion('contrasena', process.env.HP_CONTRASENA);

if (!bandera('base-de-pruebas') || !USUARIO || !CONTRASENA) {
  console.log(`Uso: node scripts/probar-happy-path.js --base-de-pruebas --usuario <dueño> --contrasena <clave> [--url ${URL_BASE}] [--con-cierre]

Este script CREA registros reales (cliente, cita y ventas). Úsalo solo con una
base de datos de pruebas; --base-de-pruebas confirma que es así.`);
  process.exit(2);
}

const sufijo = `HP-${new Date().toTimeString().slice(0, 8).replace(/:/g, '')}`;
const telefono = '9' + String(Date.now()).slice(-9);
const resultados = [];
const limpieza = [];

async function api(metodo, ruta, token, cuerpo) {
  const r = await fetch(URL_BASE + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo)
  });
  const texto = await r.text();
  let datos = null;
  try { datos = texto ? JSON.parse(texto) : null; } catch (e) { datos = texto; }
  if (!r.ok) {
    const error = new Error(`${metodo} ${ruta} → HTTP ${r.status}: ${(datos && datos.mensaje) || texto}`);
    error.estado = r.status;
    throw error;
  }
  return datos;
}

async function paso(id, descripcion, trabajo) {
  const inicio = Date.now();
  try {
    const detalle = await trabajo();
    resultados.push({ id, descripcion, ok: true, ms: Date.now() - inicio, detalle });
    console.log(`  ✔ ${id} ${descripcion}${detalle ? ` — ${detalle}` : ''} (${Date.now() - inicio} ms)`);
  } catch (error) {
    resultados.push({ id, descripcion, ok: false, ms: Date.now() - inicio, detalle: error.message });
    console.log(`  ✖ ${id} ${descripcion}\n      ${error.message}`);
    throw error;
  }
}

const comprobar = (condicion, mensaje) => { if (!condicion) throw new Error(mensaje); };

(async () => {
  console.log(`\nEngreídos Barbershop · Happy Path contra ${URL_BASE} (datos «${sufijo}»)\n`);
  const s = {};
  try {
    await paso('E2E-01', 'Servidor y base de datos en línea', async () => {
      const r = await api('GET', '/api/salud');
      return `versión ${r.version}`;
    });
    await paso('E2E-02', 'Inicio de sesión del Dueño', async () => {
      s.dueno = (await api('POST', '/api/auth/login', null, { usuario: USUARIO, contrasena: CONTRASENA })).token;
    });
    await paso('E2E-03', 'Alta de catálogo y cuentas (CREATE)', async () => {
      s.servicio = await api('POST', '/api/servicios', s.dueno, { NombreServicio: `Corte ${sufijo}`, Precio: 150, DuracionMin: 30 });
      limpieza.push(['DELETE', `/api/servicios/${s.servicio.ID_Servicio}`]);
      s.producto = await api('POST', '/api/productos', s.dueno, { NombreProducto: `Agua ${sufijo}`, Categoria: 'Bebida', Precio: 25, Stock: 5 });
      limpieza.push(['DELETE', `/api/productos/${s.producto.ID_Producto}`]);
      const usuario = sufijo.toLowerCase().replace(/[^a-z0-9]/g, '');
      s.barbero = await api('POST', '/api/cuentas', s.dueno, { Rol: 'Barbero', Nombre: `Barbero ${sufijo}`, Usuario: `b${usuario}`, Contrasena: 'prueba123' });
      limpieza.push(['DELETE', `/api/cuentas/barbero/${s.barbero.ID}`]);
      s.cajero = await api('POST', '/api/cuentas', s.dueno, { Rol: 'Cajero', Nombre: `Cajero ${sufijo}`, Usuario: `c${usuario}`, Contrasena: 'prueba123' });
      limpieza.push(['DELETE', `/api/cuentas/cajero/${s.cajero.ID}`]);
      return `servicio #${s.servicio.ID_Servicio}, producto #${s.producto.ID_Producto}, barbero #${s.barbero.ID}, cajero #${s.cajero.ID}`;
    });
    await paso('E2E-04', 'Inicio de sesión de cajero y barbero', async () => {
      s.caja = (await api('POST', '/api/auth/login', null, { usuario: s.cajero.Usuario, contrasena: 'prueba123' })).token;
      s.barb = (await api('POST', '/api/auth/login', null, { usuario: s.barbero.Usuario, contrasena: 'prueba123' })).token;
    });
    await paso('E2E-05', 'CU-04 Registrar nuevo cliente', async () => {
      s.cliente = await api('POST', '/api/clientes', s.caja, { Nombre: `Cliente ${sufijo}`, Telefono: telefono });
      const lista = await api('GET', `/api/clientes?buscar=${telefono}`, s.caja);
      comprobar(lista.some((c) => c.ID_Cliente === s.cliente.ID_Cliente), 'el cliente no aparece en la búsqueda (READ)');
      return `cliente #${s.cliente.ID_Cliente}, encontrado por teléfono`;
    });
    await paso('E2E-06', 'CU-16 Agendar cita en el primer horario libre', async () => {
      const dias = await api('GET', `/api/citas/dias?barbero=${s.barbero.ID}&servicio=${s.servicio.ID_Servicio}&dias=14`, s.caja);
      const dia = dias.find((d) => d.Estado === 'Libre');
      comprobar(dia, 'no hay días libres en las próximas dos semanas');
      const agenda = await api('GET', `/api/citas/disponibilidad?barbero=${s.barbero.ID}&fecha=${dia.Fecha}&servicio=${s.servicio.ID_Servicio}`, s.caja);
      const bloque = agenda.Bloques.find((b) => b.Cabe);
      s.cita = await api('POST', '/api/citas', s.caja, { ID_Cliente: s.cliente.ID_Cliente, ID_Barbero: s.barbero.ID,
        ID_Servicio: s.servicio.ID_Servicio, FechaHora: `${dia.Fecha}T${bloque.Hora}` });
      let encimada = 0;
      try { await api('POST', '/api/citas', s.caja, { ID_Cliente: s.cliente.ID_Cliente, ID_Barbero: s.barbero.ID,
        ID_Servicio: s.servicio.ID_Servicio, FechaHora: `${dia.Fecha}T${bloque.Hora}` }); } catch (e) { encimada = e.estado; }
      comprobar(encimada === 409, 'se permitió encimar dos citas');
      return `cita #${s.cita.ID_Cita} el ${dia.Fecha} a las ${bloque.Hora}; la cita encimada se rechazó (409)`;
    });
    await paso('E2E-07', 'CU-03 El barbero atiende la cita (UPDATE)', async () => {
      await api('PATCH', `/api/citas/${s.cita.ID_Cita}/estado`, s.barb, { Estado: 'EnAtencion' });
      const c = await api('PATCH', `/api/citas/${s.cita.ID_Cita}/estado`, s.barb, { Estado: 'Atendida' });
      comprobar(c.Estado === 'Atendida', `estado final ${c.Estado}`);
      return 'Agendada → EnAtencion → Atendida';
    });
    await paso('E2E-08', 'CU-05 Cobrar cita + 2 productos en efectivo', async () => {
      const pedido = { ID_Cliente: s.cliente.ID_Cliente, Detalle: [{ TipoItem: 'Servicio', ID_Cita: s.cita.ID_Cita },
        { TipoItem: 'Producto', ID_Producto: s.producto.ID_Producto, Cantidad: 2 }] };
      const calculo = await api('POST', '/api/ventas/calcular', s.caja, pedido);
      comprobar(calculo.Total === 200, `total ${calculo.Total}, se esperaba 200`);
      s.venta = await api('POST', '/api/ventas', s.caja, { ...pedido, MetodoPago: 'Efectivo', MontoRecibido: 500, TotalEsperado: calculo.Total });
      comprobar(s.venta.Cambio === 300, `cambio ${s.venta.Cambio}`);
      return `ticket ${s.venta.NumeroFactura}, total $${s.venta.ImporteTotal}, cambio $${s.venta.Cambio}`;
    });
    await paso('E2E-09', 'Inventario y ticket consistentes en la base de datos', async () => {
      const productos = await api('GET', '/api/productos', s.caja);
      const p = productos.find((x) => x.ID_Producto === s.producto.ID_Producto);
      comprobar(Number(p.Stock) === 3, `stock ${p.Stock}, se esperaba 3`);
      const ticket = await api('GET', `/api/ventas/${s.venta.ID_Venta}`, s.caja);
      comprobar(ticket.Detalle.length === 2, 'el ticket no tiene 2 renglones');
      return 'stock 5 → 3; ticket con 2 renglones';
    });
    await paso('E2E-10', 'CU-06 Resumen del turno para el cierre de caja', async () => {
      const r = await api('GET', '/api/cierres/resumen', s.caja);
      comprobar(r.Ventas.some((v) => v.ID_Venta === s.venta.ID_Venta), 'la venta no aparece en el turno');
      if (!bandera('con-cierre')) return `${r.NumeroVentas} venta(s) pendientes de corte; efectivo esperado $${r.EfectivoEsperado}`;
      const corte = await api('POST', '/api/cierres', s.caja, { EfectivoContado: r.EfectivoEsperado });
      return `corte #${corte.ID_Corte} con diferencia $${corte.Diferencia}`;
    });
  } catch (e) {
    // El detalle ya se mostró en el paso que falló.
  }

  if (s.dueno && limpieza.length) {
    let bajas = 0;
    for (const [metodo, ruta] of limpieza.reverse()) {
      try { await api(metodo, ruta, s.dueno); bajas += 1; } catch (e) { console.log(`  · No se pudo dar de baja ${ruta}: ${e.message}`); }
    }
    console.log(`  · Limpieza: ${bajas} de ${limpieza.length} registros de prueba dados de baja (borrado lógico).`);
  }

  const fallas = resultados.filter((r) => !r.ok).length;
  console.log(`\n  Resultado: ${resultados.length - fallas} de ${resultados.length} pasos correctos${fallas ? ' — HAY FALLAS' : ''}.\n`);
  process.exit(fallas ? 1 : 0);
})();
