/**
 * @file servicios/bot.js
 * @description Bot de WhatsApp: entiende la pregunta del cliente y arma la
 * respuesta con los datos reales del sistema.
 *
 * Temas que contesta:
 *   servicios (lista, precio y duración)      productos (precio y si hay existencias)
 *   membresias (planes, precio y beneficios)  descuentos (promociones vigentes)
 *   horario (a qué hora abren o cierran)      direccion (ubicación y mapa)
 *   contacto (teléfono y redes)               citas (cómo agendar)
 *   menu (saludo y opciones 1 a 8)            asesor (pide hablar con una persona)
 *
 * El horario, la dirección, el mapa, el teléfono, las redes y cómo agendar se
 * editan en Ajustes → Datos del negocio. Lo demás sale de los catálogos.
 * No usa inteligencia artificial ni internet: busca palabras clave, así que
 * siempre responde igual y solo con información guardada en el sistema.
 */
'use strict';

const db = require('../db');
const f = require('./fechas');
const { descuentosVigentes } = require('./precios');

const DIAS = [['L', 'lunes'], ['M', 'martes'], ['X', 'miércoles'], ['J', 'jueves'], ['V', 'viernes'], ['S', 'sábado'], ['D', 'domingo']];
const dinero = (n) => '$' + Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });
/** Minúsculas, sin acentos ni signos. */
const limpiar = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ\s]/g, ' ').replace(/\s+/g, ' ').trim();

/** '18:00' → '6:00 p.m.' */
function hora12(h) {
  const [hh, mm] = String(h).split(':').map(Number);
  return `${hh % 12 || 12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'a.m.' : 'p.m.'}`;
}

/** Horario guardado (JSON) → { L: ['09:00','18:00'] | null, … } o null si no se ha capturado. */
function leerHorario(texto) {
  if (!texto) return null;
  try {
    const h = typeof texto === 'string' ? JSON.parse(texto) : texto;
    const limpio = {};
    let alguno = false;
    for (const [letra] of DIAS) {
      const d = h[letra];
      limpio[letra] = Array.isArray(d) && /^\d{2}:\d{2}$/.test(d[0]) && /^\d{2}:\d{2}$/.test(d[1]) ? [d[0], d[1]] : null;
      alguno = alguno || !!limpio[letra];
    }
    return alguno ? limpio : null;
  } catch (e) { return null; }
}

/** Renglones del horario agrupando días seguidos con las mismas horas. */
function renglonesHorario(h) {
  const grupos = [];
  for (const [letra, nombre] of DIAS) {
    const clave = h[letra] ? h[letra].join('-') : 'cerrado';
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.clave === clave) ultimo.fin = nombre; else grupos.push({ clave, inicio: nombre, fin: nombre, horas: h[letra] });
  }
  return grupos.map((g) => {
    const dias = g.inicio === g.fin ? g.inicio : `${g.inicio} a ${g.fin}`;
    return `• ${dias.charAt(0).toUpperCase() + dias.slice(1)}: ${g.horas ? `${hora12(g.horas[0])} a ${hora12(g.horas[1])}` : 'cerrado'}`;
  });
}

/** Datos que usa el bot (una sola lectura por mensaje). */
async function cargarDatos() {
  const hoy = f.hoy();
  const [negocio, servicios, productos, planes, beneficios, descuentos] = await Promise.all([
    db.uno(`SELECT NombreEstablecimiento, Direccion, Telefono, RedesSociales, HorarioAtencion, UbicacionMapa, InfoCitas, BotBienvenida
              FROM ESTABLECIMIENTO WHERE ID_Local = 1`),
    db.consultar('SELECT NombreServicio, Precio, DuracionMin, Descripcion FROM SERVICIO WHERE Activo = 1 ORDER BY NombreServicio'),
    db.consultar('SELECT NombreProducto, Categoria, Precio, Stock FROM PRODUCTO WHERE Activo = 1 ORDER BY Categoria, NombreProducto'),
    db.consultar('SELECT ID_Membresia, NombrePlan, Descripcion, Precio, DuracionMeses FROM MEMBRESIA WHERE Activo = 1 ORDER BY Precio'),
    db.consultar(
      `SELECT b.ID_Membresia, b.Aplica, b.Tipo, b.Porcentaje, b.Usos, b.Periodo, b.Etiqueta, b.Categoria, s.NombreServicio, p.NombreProducto
         FROM MEMBRESIA_BENEFICIO b LEFT JOIN SERVICIO s ON s.ID_Servicio = b.ID_Servicio LEFT JOIN PRODUCTO p ON p.ID_Producto = b.ID_Producto
        ORDER BY b.Orden, b.ID_Beneficio`),
    descuentosVigentes(db, hoy)
  ]);
  return { hoy, ahora: f.ahora(), negocio: negocio || {}, servicios, productos, planes, beneficios, descuentos };
}

/** Texto de un beneficio de membresía (la etiqueta del cartel o la regla). */
function textoBeneficio(b) {
  if (b.Etiqueta) return b.Etiqueta;
  const sobre = b.Aplica === 'Producto' ? b.NombreProducto : b.Aplica === 'Categoria' ? b.Categoria
    : b.Aplica === 'Productos' ? 'todos los productos' : b.NombreServicio;
  const que = b.Tipo === 'Descuento' ? `${Number(b.Porcentaje)} % de descuento en ${sobre}` : `${sobre} gratis`;
  return que + (b.Usos == null ? '' : ` (${b.Usos} ${b.Periodo === 'Visita' ? 'por visita' : 'al mes'})`);
}

/** A qué aplica un descuento, en palabras. */
function alcanceDescuento(d) {
  if (d.Aplica === 'Todo') return 'toda tu compra';
  if (d.Aplica === 'Servicios') return d.NombreServicio || 'todos los servicios';
  if (d.Aplica === 'Membresias') return d.NombrePlan ? `la membresía ${d.NombrePlan}` : 'todas las membresías';
  return d.NombreProducto || (d.Categoria ? `productos de ${d.Categoria}` : 'todos los productos');
}

// ---------------------------------------------------------------------------
// Respuestas por tema
// ---------------------------------------------------------------------------
const TEMAS = {
  servicios(d, texto) {
    if (!d.servicios.length) return 'Por el momento no tenemos la lista de servicios disponible. Escríbenos más tarde o llámanos.';
    const pedidos = d.servicios.filter((s) => texto.includes(limpiar(s.NombreServicio)));
    const lista = pedidos.length ? pedidos : d.servicios;
    const l = [pedidos.length ? '✂️ *Esto es lo que buscas:*' : '✂️ *Nuestros servicios:*'];
    for (const s of lista) l.push(`• ${s.NombreServicio}: ${dinero(s.Precio)} (${s.DuracionMin} min)${pedidos.length && s.Descripcion ? ` — ${s.Descripcion}` : ''}`);
    return l.join('\n');
  },
  productos(d, texto) {
    const conExistencia = d.productos.filter((p) => p.Stock > 0);
    const pedidos = d.productos.filter((p) => texto.includes(limpiar(p.NombreProducto)));
    if (pedidos.length) {
      return ['🧴 *Esto es lo que buscas:*', ...pedidos.map((p) => `• ${p.NombreProducto}: ${dinero(p.Precio)} — ${p.Stock > 0 ? 'disponible' : 'agotado por ahora'}`)].join('\n');
    }
    if (!conExistencia.length) return 'Por el momento no tenemos productos disponibles.';
    return ['🧴 *Productos disponibles:*', ...conExistencia.map((p) => `• ${p.NombreProducto}: ${dinero(p.Precio)}`)].join('\n');
  },
  membresias(d) {
    if (!d.planes.length) return 'Por el momento no manejamos membresías.';
    const l = ['👑 *Nuestras membresías:*'];
    for (const p of d.planes) {
      l.push('', `*${p.NombrePlan}* — ${dinero(p.Precio)} por ${Number(p.DuracionMeses) === 1 ? 'mes' : p.DuracionMeses + ' meses'}`);
      if (p.Descripcion) l.push(p.Descripcion);
      for (const b of d.beneficios.filter((x) => x.ID_Membresia === p.ID_Membresia)) l.push(`✓ ${textoBeneficio(b)}`);
    }
    l.push('', 'Se contratan directamente en la barbería.');
    return l.join('\n');
  },
  descuentos(d) {
    if (!d.descuentos.length) return 'Por ahora no tenemos promociones activas. 😉 Pregunta por nuestras membresías: incluyen descuentos todo el mes.';
    const l = ['🏷️ *Promociones vigentes:*'];
    for (const x of d.descuentos) {
      const cuanto = x.Tipo === 'Porcentaje' ? `${Number(x.Valor)} % de descuento` : `${dinero(x.Valor)} de descuento`;
      const hasta = x.FechaFin ? ` (hasta el ${f.fechaLarga(String(x.FechaFin).slice(0, 10))})` : '';
      l.push(`• *${x.Nombre}*: ${cuanto} en ${alcanceDescuento(x)}${hasta}`);
      if (x.Descripcion) l.push(`  ${x.Descripcion}`);
    }
    return l.join('\n');
  },
  horario(d, texto) {
    const h = leerHorario(d.negocio.HorarioAtencion);
    if (!h) return 'Todavía no tenemos el horario publicado aquí. Llámanos y con gusto te informamos.';
    const letra = f.letraDia(d.hoy);
    const hoy = h[letra];
    const nombreHoy = DIAS.find((x) => x[0] === letra)[1];
    const minutos = f.aMinutos(d.ahora.hora);
    let primero;
    if (!hoy) primero = `Hoy ${nombreHoy} estamos cerrados.`;
    else if (minutos < f.aMinutos(hoy[0])) primero = `Hoy ${nombreHoy} abrimos a las ${hora12(hoy[0])} y cerramos a las ${hora12(hoy[1])}.`;
    else if (minutos < f.aMinutos(hoy[1])) primero = `Hoy ${nombreHoy} estamos abiertos y cerramos a las ${hora12(hoy[1])}.`;
    else primero = `Hoy ${nombreHoy} ya cerramos (cerramos a las ${hora12(hoy[1])}).`;
    if (/\bmanana\b/.test(texto) && !/\bpor la manana\b|\ben la manana\b/.test(texto)) {
      const m = DIAS[(DIAS.findIndex((x) => x[0] === letra) + 1) % 7];
      primero = h[m[0]] ? `Mañana ${m[1]} abrimos de ${hora12(h[m[0]][0])} a ${hora12(h[m[0]][1])}.` : `Mañana ${m[1]} estamos cerrados.`;
    }
    return [`🕒 ${primero}`, '', '*Horario:*', ...renglonesHorario(h)].join('\n');
  },
  direccion(d) {
    if (!d.negocio.Direccion && !d.negocio.UbicacionMapa) return 'Todavía no tenemos la dirección publicada aquí. Llámanos y con gusto te indicamos cómo llegar.';
    const l = ['📍 *Estamos en:*'];
    if (d.negocio.Direccion) l.push(d.negocio.Direccion);
    if (d.negocio.UbicacionMapa) l.push(`Mapa: ${d.negocio.UbicacionMapa}`);
    return l.join('\n');
  },
  contacto(d) {
    const l = ['📞 *Contacto:*'];
    if (d.negocio.Telefono) l.push(`Teléfono: ${d.negocio.Telefono}`);
    if (d.negocio.RedesSociales) l.push(`Redes: ${d.negocio.RedesSociales}`);
    return l.length > 1 ? l.join('\n') : 'Puedes escribirnos por este mismo chat.';
  },
  citas(d) {
    if (d.negocio.InfoCitas) return `📅 ${d.negocio.InfoCitas}`;
    return '📅 Para agendar tu cita ' + (d.negocio.Telefono ? `llámanos al ${d.negocio.Telefono} o ` : '') +
      'visítanos en la barbería. Dinos qué servicio quieres, con qué barbero y el día y la hora que prefieres.';
  },
  asesor() { return '🙋 Con gusto. En cuanto se desocupe, una persona del equipo te responde por este chat.'; },
  gracias() { return '¡Con gusto! 💈 Aquí estamos para lo que necesites.'; }
};

/** Menú numerado. */
function menu(d, saludo) {
  const nombre = d.negocio.NombreEstablecimiento || 'la barbería';
  const inicio = saludo
    ? (d.negocio.BotBienvenida || `¡Hola! 👋 Gracias por escribir a *${nombre}*.`)
    : 'No estoy seguro de haber entendido. 🙂';
  return [inicio, '', 'Escribe el número o la palabra de lo que quieres saber:',
    '1️⃣ Servicios y precios', '2️⃣ Productos', '3️⃣ Membresías', '4️⃣ Descuentos y promociones',
    '5️⃣ Horario', '6️⃣ Dirección', '7️⃣ Agendar una cita', '8️⃣ Hablar con una persona'].join('\n');
}

const POR_NUMERO = { 1: 'servicios', 2: 'productos', 3: 'membresias', 4: 'descuentos', 5: 'horario', 6: 'direccion', 7: 'citas', 8: 'asesor' };

/** Palabras clave de cada tema (texto ya sin acentos). El orden es el de la respuesta. */
const CLAVES = [
  ['horario', /\b(horario|horarios|a que hora|que hora|que horas|abren|abre|abierto|abiertos|cierran|cierra|cerrado|cerrados|atienden|atencion|trabajan|laboran)\b/],
  ['direccion', /\b(direccion|ubicacion|ubicados|ubicado|ubican|donde estan|donde se encuentran|donde queda|donde es|domicilio|como llego|como llegar|mapa|sucursal)\b/],
  ['descuentos', /\b(descuento|descuentos|promo|promos|promocion|promociones|oferta|ofertas|rebaja|rebajas|cupon|cupones)\b/],
  ['membresias', /\b(membresia|membresias|membrecia|membrecias|plan|planes|suscripcion|mensualidad|socio)\b/],
  ['productos', /\b(producto|productos|venden|vende|articulo|articulos|pomada|cera|shampoo|champu|aceite|gel)\b/],
  ['servicios', /\b(servicio|servicios|corte|cortes|barba|precio|precios|cuanto cuesta|cuanto cuestan|cuanto cobran|cuanto sale|costo|costos|tarifa|tarifas|que hacen|que ofrecen)\b/],
  ['citas', /\b(cita|citas|agendar|agenda|reservar|reserva|reservacion|apartar|turno|disponibilidad)\b/],
  ['contacto', /\b(telefono|numero|llamar|contacto|instagram|facebook|redes)\b/],
  ['asesor', /\b(asesor|persona|humano|alguien|encargado|dueno|queja|reclamo)\b/]
];

/**
 * Respuesta del bot a un mensaje.
 * @param {string} mensaje  Texto que escribió el cliente
 * @param {Object} [datos]  Datos ya cargados (pruebas); por omisión se leen de la base
 * @returns {Promise<{Tema: string, Respuesta: string}>}
 */
async function responder(mensaje, datos) {
  const d = datos || await cargarDatos();
  const texto = limpiar(mensaje);
  if (!texto) return { Tema: 'menu', Respuesta: menu(d, true) };

  // Opción del menú: «1», «opcion 3»…
  const numero = /^(?:opcion\s*)?([1-8])$/.exec(texto);
  if (numero) {
    const tema = POR_NUMERO[numero[1]];
    return { Tema: tema, Respuesta: TEMAS[tema](d, texto) };
  }

  const temas = CLAVES.filter(([, patron]) => patron.test(texto)).map(([t]) => t);
  // También cuenta si nombra un servicio o un producto («¿cuánto el fade?»).
  if (!temas.includes('servicios') && d.servicios.some((s) => texto.includes(limpiar(s.NombreServicio)))) temas.push('servicios');
  if (!temas.includes('productos') && d.productos.some((p) => texto.includes(limpiar(p.NombreProducto)))) temas.push('productos');
  // «precio de la pomada» es de productos, no la lista de servicios.
  if (temas.includes('productos') && temas.includes('servicios') &&
      !/\b(servicio|servicios|corte|cortes|barba)\b/.test(texto) && !d.servicios.some((s) => texto.includes(limpiar(s.NombreServicio)))) {
    temas.splice(temas.indexOf('servicios'), 1);
  }

  if (temas.length) {
    const elegidos = temas.slice(0, 3);
    return { Tema: elegidos.join('+'), Respuesta: elegidos.map((t) => TEMAS[t](d, texto)).join('\n\n') };
  }
  if (/\b(gracias|muchas gracias|ok gracias|perfecto|excelente|vale)\b/.test(texto)) return { Tema: 'gracias', Respuesta: TEMAS.gracias() };
  if (/\b(hola|buenas|buenos dias|buen dia|buenas tardes|buenas noches|que tal|menu|inicio|opciones|ayuda|info|informacion|informes)\b/.test(texto)) {
    return { Tema: 'menu', Respuesta: menu(d, true) };
  }
  return { Tema: 'desconocido', Respuesta: menu(d, false) };
}

module.exports = { responder, cargarDatos, leerHorario, renglonesHorario, hora12, limpiar, DIAS };
