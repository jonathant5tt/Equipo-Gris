/**
 * @file api.js
 * @description Cliente de la API REST del servidor (Node.js + Express + MySQL).
 *
 * Todas las pantallas obtienen y envían datos SOLO a través de este archivo.
 * Cada función corresponde a un endpoint documentado en docs/API.md; los
 * nombres de los campos son los de las columnas de MySQL
 * (base-de-datos/esquema.sql).
 *
 * Convenciones:
 *   - JSON en peticiones y respuestas (las fotos viajan como data URL base64).
 *   - Autenticación: cabecera «Authorization: Bearer <token>» (JWT).
 *   - Errores: código HTTP + { "mensaje": "Texto para el usuario" }.
 *       401 → la sesión terminó: se vuelve al inicio de sesión.
 *       503 → servicio suspendido: Cajero y Barbero van a mantenimiento.
 *   - Fechas: "AAAA-MM-DD"; fecha y hora: "AAAA-MM-DD HH:MM:SS".
 *
 * Expone los objetos globales `Api` y `ErrorApi`.
 * Requiere: config.js, idioma.js, sesion.js
 */
(function () {
  'use strict';

  var CFG = window.APP_CONFIG;
  var t = window.Idioma ? window.Idioma.t : function (x) { return x; };

  /**
   * Error con el código HTTP y el mensaje del servidor.
   * @param {string} mensaje  Texto para el usuario.
   * @param {number} estado   Código HTTP (0 = sin conexión).
   * @param {*} [datos]       Cuerpo completo de la respuesta.
   */
  function ErrorApi(mensaje, estado, datos) {
    this.name = 'ErrorApi';
    this.message = mensaje;
    this.estado = estado;
    this.datos = datos;
  }
  ErrorApi.prototype = Object.create(Error.prototype);
  ErrorApi.prototype.constructor = ErrorApi;

  /** Cadena de consulta sin valores vacíos: { fecha: '2026-11-05' } → "?fecha=2026-11-05". */
  function cadenaConsulta(consulta) {
    if (!consulta) return '';
    var params = new URLSearchParams();
    Object.keys(consulta).forEach(function (clave) {
      var valor = consulta[clave];
      if (valor !== undefined && valor !== null && valor !== '') params.append(clave, valor);
    });
    var texto = params.toString();
    return texto ? '?' + texto : '';
  }

  /**
   * Petición a la API; devuelve el cuerpo JSON.
   * @param {'GET'|'POST'|'PUT'|'PATCH'|'DELETE'} metodo
   * @param {string} ruta  Ej. "/clientes".
   * @param {{consulta?: Object, cuerpo?: Object}} [opciones]
   * @returns {Promise<*>}
   * @throws {ErrorApi}
   */
  async function solicitar(metodo, ruta, opciones) {
    opciones = opciones || {};
    if (!CFG.API_URL) throw new ErrorApi(t('Configura la dirección del servidor.'), 0);

    var cabeceras = { Accept: 'application/json' };
    var cuerpo;
    if (opciones.cuerpo !== undefined) {
      cabeceras['Content-Type'] = 'application/json';
      cuerpo = JSON.stringify(opciones.cuerpo);
    }
    var token = window.Sesion.token();
    if (token) cabeceras.Authorization = 'Bearer ' + token;

    var control = new AbortController();
    var temporizador = setTimeout(function () { control.abort(); }, CFG.TIEMPO_ESPERA_MS);
    var respuesta;
    try {
      respuesta = await fetch(CFG.API_URL + ruta + cadenaConsulta(opciones.consulta), {
        method: metodo, headers: cabeceras, body: cuerpo, signal: control.signal
      });
    } catch (error) {
      throw new ErrorApi(t(error.name === 'AbortError'
        ? 'El servidor tardó demasiado en responder.'
        : 'No hay conexión con el servidor. Revisa que esté encendido y en la misma red.'), 0, error);
    } finally {
      clearTimeout(temporizador);
    }

    var datos = null;
    if (respuesta.status !== 204) {
      try { datos = await respuesta.json(); } catch (e) { datos = null; }
    }
    if (respuesta.ok) return datos;

    var mensaje = t((datos && datos.mensaje) || ('Error ' + respuesta.status + ' del servidor.'));
    if (respuesta.status === 401 && ruta !== '/auth/login') {
      window.Sesion.borrar();
      window.location.replace(CFG.PAGINA_LOGIN);
    }
    if (respuesta.status === 503 && datos && datos.EstadoServicio === 'Suspendido') {
      window.Sesion.guardarEstadoServicio({ EstadoServicio: 'Suspendido', MensajeMantenimiento: datos.MensajeMantenimiento });
      if (window.Sesion.rol() !== window.Sesion.ROLES.DUENO) window.location.replace(CFG.PAGINA_MANTENIMIENTO);
    }
    throw new ErrorApi(mensaje, respuesta.status, datos);
  }

  var obtener = function (ruta, consulta) { return solicitar('GET', ruta, { consulta: consulta }); };
  var crear = function (ruta, cuerpo) { return solicitar('POST', ruta, { cuerpo: cuerpo || {} }); };
  var reemplazar = function (ruta, cuerpo) { return solicitar('PUT', ruta, { cuerpo: cuerpo || {} }); };
  var modificar = function (ruta, cuerpo) { return solicitar('PATCH', ruta, { cuerpo: cuerpo || {} }); };
  var eliminar = function (ruta) { return solicitar('DELETE', ruta); };
  var id = encodeURIComponent;

  var Api = {
    /** Autenticación. */
    auth: {
      /** POST /auth/login → { token, usuario: { id, nombre, usuario, rol } } */
      iniciarSesion: function (usuario, contrasena) { return crear('/auth/login', { usuario: usuario, contrasena: contrasena }); },
      /** POST /auth/logout */
      cerrarSesion: function () { return crear('/auth/logout'); },
      /** GET /auth/inicial → { RequiereDueno } (primer uso: falta la cuenta del Dueño) */
      inicial: function () { return obtener('/auth/inicial'); },
      /** POST /auth/primer-dueno { Nombre, Usuario, Contrasena } → { token, usuario } */
      primerDueno: function (datos) { return crear('/auth/primer-dueno', datos); }
    },

    /** GET /salud → { estado: "ok" } (punto «En línea»). */
    salud: { verificar: function () { return obtener('/salud'); } },

    /** Negocio y estado del servicio (ESTABLECIMIENTO). */
    establecimiento: {
      /** GET /establecimiento → datos del negocio para el ticket. */
      obtener: function () { return obtener('/establecimiento'); },
      /** PUT /establecimiento (Dueño) */
      actualizar: function (datos) { return reemplazar('/establecimiento', datos); },
      /** GET /establecimiento/estado (pública); guarda copia local. */
      estado: function () {
        return obtener('/establecimiento/estado').then(function (estado) {
          if (estado) window.Sesion.guardarEstadoServicio(estado);
          return estado;
        });
      },
      /** PUT /establecimiento/estado (Dueño) { EstadoServicio, MensajeMantenimiento } */
      cambiarEstado: function (datos) {
        return reemplazar('/establecimiento/estado', datos).then(function (estado) {
          window.Sesion.guardarEstadoServicio(estado);
          return estado;
        });
      }
    },

    /** Configuración de WhatsApp (Dueño). */
    whatsapp: {
      obtener: function () { return obtener('/ajustes/whatsapp'); },
      guardar: function (datos) { return reemplazar('/ajustes/whatsapp', datos); },
      /** POST /ajustes/whatsapp/prueba { Telefono } */
      probar: function (telefono) { return crear('/ajustes/whatsapp/prueba', { Telefono: telefono }); },
      /** POST /ajustes/whatsapp/conexion → { Conectado, Numero, Nombre, Calidad, Error } (no envía mensajes) */
      conexion: function () { return crear('/ajustes/whatsapp/conexion'); },
      /** POST /ajustes/whatsapp/bot/simular { Mensaje } → { Tema, Respuesta } */
      simular: function (mensaje) { return crear('/ajustes/whatsapp/bot/simular', { Mensaje: mensaje }); },
      /** GET /ajustes/whatsapp/chats → últimos mensajes recibidos y respuestas del bot */
      chats: function () { return obtener('/ajustes/whatsapp/chats'); }
    },

    /** Descuentos y promociones (DESCUENTO). */
    descuentos: {
      /** GET /descuentos[?vigentes=1] */
      listar: function (soloVigentes) { return obtener('/descuentos', soloVigentes ? { vigentes: 1 } : null); },
      crear: function (datos) { return crear('/descuentos', datos); },
      actualizar: function (idDescuento, datos) { return reemplazar('/descuentos/' + id(idDescuento), datos); },
      eliminar: function (idDescuento) { return eliminar('/descuentos/' + id(idDescuento)); }
    },

    /** Reembolsos (REEMBOLSO). */
    reembolsos: {
      /** GET /reembolsos?desde=&hasta= → { registros, resumen } */
      listar: function (filtros) { return obtener('/reembolsos', filtros); },
      /** GET /reembolsos/venta/:id → venta con lo que todavía se puede reembolsar */
      venta: function (idVenta) { return obtener('/reembolsos/venta/' + id(idVenta)); },
      /** POST /reembolsos { ID_Venta, Renglones[{ID_Detalle, Cantidad}], Motivo, MetodoDevolucion, RegresarInventario, Contrasena } */
      crear: function (datos) { return crear('/reembolsos', datos); }
    },

    /** Cuentas de cajeros y barberos (Dueño). */
    cuentas: {
      /** 'Dueño' → 'dueno' (ruta sin acentos). */
      _ruta: function (rol) { return String(rol).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); },
      listar: function () { return obtener('/cuentas'); },
      /** POST /cuentas { Rol, Nombre, Usuario, Contrasena, Telefono? } */
      crear: function (datos) { return crear('/cuentas', datos); },
      cambiarContrasena: function (rol, idCuenta, contrasena) {
        return reemplazar('/cuentas/' + id(this._ruta(rol)) + '/' + id(idCuenta) + '/contrasena', { Contrasena: contrasena });
      },
      eliminar: function (rol, idCuenta) { return eliminar('/cuentas/' + id(this._ruta(rol)) + '/' + id(idCuenta)); }
    },

    /** Clientes (CLIENTE, FOTO_CLIENTE). */
    clientes: {
      /**
       * GET /clientes?buscar=&filtro=&limite=
       * @param {{buscar?: string, filtro?: 'recientes'|'primeros'|'membresia', limite?: number}} filtros
       */
      buscar: function (filtros) { return obtener('/clientes', typeof filtros === 'string' ? { buscar: filtros } : filtros); },
      /** GET /clientes/:id → ficha con estadísticas (Asistencias, Faltas, Puntualidad, ProximaCita…) */
      obtener: function (idCliente) { return obtener('/clientes/' + id(idCliente)); },
      /** POST /clientes { Nombre, Lada, Telefono, Descripcion, Observaciones, foto? } */
      crear: function (datos) { return crear('/clientes', datos); },
      actualizar: function (idCliente, datos) { return reemplazar('/clientes/' + id(idCliente), datos); },
      /** GET /clientes/:id/servicios → historial cobrado */
      historial: function (idCliente) { return obtener('/clientes/' + id(idCliente) + '/servicios'); },
      /** GET /clientes/:id/pendientes → citas atendidas sin cobrar */
      pendientes: function (idCliente) { return obtener('/clientes/' + id(idCliente) + '/pendientes'); },
      /** GET /clientes/:id/membresia → membresía que aplica hoy con sus beneficios (o null) */
      membresia: function (idCliente) { return obtener('/clientes/' + id(idCliente) + '/membresia'); },
      fotos: function (idCliente) { return obtener('/clientes/' + id(idCliente) + '/fotos'); },
      /** POST /clientes/:id/fotos { foto: dataURL, Titulo?, Referencia? } */
      subirFoto: function (idCliente, datos) { return crear('/clientes/' + id(idCliente) + '/fotos', datos); },
      eliminarFoto: function (idCliente, idFoto) { return eliminar('/clientes/' + id(idCliente) + '/fotos/' + id(idFoto)); },
      usarComoReferencia: function (idCliente, idFoto) {
        return reemplazar('/clientes/' + id(idCliente) + '/foto-referencia', { ID_Foto: idFoto });
      },
      /** DELETE /clientes/:id/foto-referencia → elimina la foto principal */
      eliminarFotoPrincipal: function (idCliente) { return eliminar('/clientes/' + id(idCliente) + '/foto-referencia'); }
    },

    /** Barberos (BARBERO). */
    barberos: {
      listar: function () { return obtener('/barberos'); },
      yo: function () { return obtener('/barberos/yo'); },
      /** PUT /barberos/:id/horario (Dueño) */
      actualizarHorario: function (idBarbero, datos) { return reemplazar('/barberos/' + id(idBarbero) + '/horario', datos); },
      /** GET /barberos/:id/ingresos?dias= */
      ingresos: function (idBarbero, dias) { return obtener('/barberos/' + id(idBarbero) + '/ingresos', { dias: dias }); }
    },

    /** Citas (CITA). */
    citas: {
      listar: function (filtros) { return obtener('/citas', filtros); },
      mias: function (fecha) { return obtener('/citas/mias', { fecha: fecha }); },
      proxima: function () { return obtener('/citas/proxima'); },
      /** GET /citas/disponibilidad → { Fecha, Estado, Motivo, Libres, DuracionMin, Bloques[] } */
      disponibilidad: function (barbero, fecha, servicio) {
        return obtener('/citas/disponibilidad', { barbero: barbero, fecha: fecha, servicio: servicio });
      },
      /** GET /citas/dias → [{ Fecha, Estado: Libre|Ocupado|NoDisponible, Motivo, Libres }] */
      dias: function (barbero, desde, dias, servicio) {
        return obtener('/citas/dias', { barbero: barbero, desde: desde, dias: dias, servicio: servicio });
      },
      /** POST /citas { ID_Cliente, ID_Barbero, ID_Servicio, FechaHora } → cita + resultado de WhatsApp */
      crear: function (datos) { return crear('/citas', datos); },
      /** PATCH /citas/:id/estado { Estado } */
      cambiarEstado: function (idCita, estado) { return modificar('/citas/' + id(idCita) + '/estado', { Estado: estado }); },
      /** POST /citas/:id/enviar → reenvía la confirmación por WhatsApp */
      enviar: function (idCita) { return crear('/citas/' + id(idCita) + '/enviar'); }
    },

    /** Catálogos (SERVICIO, PRODUCTO, MEMBRESIA). */
    catalogos: {
      servicios: function () { return obtener('/servicios'); },
      productos: function () { return obtener('/productos'); },
      membresias: function () { return obtener('/membresias'); }
    },

    /** Altas, cambios y bajas de servicios (Dueño). */
    servicios: {
      crear: function (datos) { return crear('/servicios', datos); },
      actualizar: function (idServicio, datos) { return reemplazar('/servicios/' + id(idServicio), datos); },
      eliminar: function (idServicio) { return eliminar('/servicios/' + id(idServicio)); }
    },

    /** Productos e inventario. */
    productos: {
      crear: function (datos) { return crear('/productos', datos); },
      actualizar: function (idProducto, datos) { return reemplazar('/productos/' + id(idProducto), datos); },
      eliminar: function (idProducto) { return eliminar('/productos/' + id(idProducto)); },
      /** POST /productos/:id/entrada { Cantidad, Motivo? } */
      entrada: function (idProducto, datos) { return crear('/productos/' + id(idProducto) + '/entrada', datos); },
      /** POST /productos/:id/baja { Cantidad, Motivo, Contrasena } */
      baja: function (idProducto, datos) { return crear('/productos/' + id(idProducto) + '/baja', datos); },
      movimientos: function (idProducto) { return obtener('/productos/' + id(idProducto) + '/movimientos'); }
    },

    /** Membresías y beneficios (Dueño). */
    membresias: {
      crear: function (datos) { return crear('/membresias', datos); },
      actualizar: function (idMembresia, datos) { return reemplazar('/membresias/' + id(idMembresia), datos); },
      eliminar: function (idMembresia) { return eliminar('/membresias/' + id(idMembresia)); }
    },

    /** Ventas y tickets (VENTA, DETALLE_VENTA). */
    ventas: {
      /** POST /ventas/calcular { ID_Cliente, Detalle } → { Lineas, Subtotal, Descuento, Total, Membresia } */
      calcular: function (datos) { return crear('/ventas/calcular', datos); },
      /** POST /ventas { ID_Cliente, MetodoPago, MontoRecibido, TotalEsperado, Detalle } → Venta */
      crear: function (datos) { return crear('/ventas', datos); },
      /** GET /ventas?desde=&hasta=&concepto=&buscar=&pagina=&tamano= */
      listar: function (filtros) { return obtener('/ventas', filtros); },
      obtener: function (idVenta) { return obtener('/ventas/' + id(idVenta)); },
      /** POST /ventas/:id/enviar { canal: 'whatsapp'|'sms', Telefono? } */
      enviarTicket: function (idVenta, canal, telefono) {
        return crear('/ventas/' + id(idVenta) + '/enviar', { canal: canal, Telefono: telefono || undefined });
      }
    },

    /** Cierre de caja (CIERRE_CAJA). */
    cierres: {
      resumen: function () { return obtener('/cierres/resumen'); },
      /** POST /cierres { EfectivoContado } */
      crear: function (datos) { return crear('/cierres', datos); },
      listar: function (limite) { return obtener('/cierres', { limite: limite }); },
      /** GET /cierres/:id → corte con sus ventas */
      obtener: function (id) { return obtener('/cierres/' + encodeURIComponent(id)); }
    },

    /** Avisos del barbero. */
    avisos: {
      listar: function () { return obtener('/avisos'); },
      marcarLeidos: function () { return crear('/avisos/leidos'); }
    }
  };

  // ---------------------------------------------------------------------------
  // Sincronización entre dispositivos
  // ---------------------------------------------------------------------------
  // El servidor lleva un contador por tema (citas, ventas, catalogo, clientes).
  // Cada pantalla pregunta cada pocos segundos y, si el contador de sus temas
  // cambió (alguien guardó algo desde otro equipo), vuelve a cargar sus datos.

  var vigilantes = [];
  var ultimoEstado = null;
  var temporizadorSync = null;
  var consultando = false;

  async function revisarCambios() {
    if (consultando || !vigilantes.length || document.hidden || !window.Sesion.token() || !CFG.API_URL) return;
    consultando = true;
    try {
      var control = new AbortController();
      var limite = setTimeout(function () { control.abort(); }, 4000);
      var r = await fetch(CFG.API_URL + '/sincronizar', {
        headers: { Accept: 'application/json', Authorization: 'Bearer ' + window.Sesion.token() }, cache: 'no-store', signal: control.signal
      });
      clearTimeout(limite);
      if (!r.ok) return;
      var estado = await r.json();
      var anterior = ultimoEstado;
      ultimoEstado = estado;
      if (!anterior) return;
      var reinicio = anterior.servidor !== estado.servidor;
      vigilantes.forEach(function (v) {
        var cambio = reinicio || v.temas.some(function (tema) { return anterior[tema] !== estado[tema]; });
        if (cambio) { try { v.fn(); } catch (e) { /* la pantalla sigue */ } }
      });
    } catch (e) { /* sin conexión: se reintenta en la siguiente vuelta */ }
    finally { consultando = false; }
  }

  /**
   * Avisa a la pantalla cuando cambian datos en el servidor (desde cualquier equipo).
   * @param {Array<'citas'|'ventas'|'catalogo'|'clientes'>} temas
   * @param {Function} fn  Vuelve a cargar los datos de la pantalla.
   */
  Api.alCambiar = function (temas, fn) {
    vigilantes.push({ temas: temas, fn: fn });
    if (temporizadorSync) return;
    temporizadorSync = setInterval(revisarCambios, CFG.INTERVALO_SINCRONIA_MS || 3000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) revisarCambios(); });
    window.addEventListener('focus', revisarCambios);
    window.addEventListener('online', revisarCambios);
    revisarCambios();
  };
  /** Revisa en este momento (ej. al volver a la pantalla). */
  Api.revisarCambios = revisarCambios;

  window.ErrorApi = ErrorApi;
  window.Api = Object.freeze(Api);
})();
