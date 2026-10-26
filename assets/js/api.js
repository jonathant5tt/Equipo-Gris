/**
 * @file api.js
 * @description Cliente de la API REST del back end (Node.js + Express + MySQL).
 *
 * Todas las pantallas obtienen y envían datos SOLO a través de este archivo.
 * Cada función corresponde a un endpoint documentado en docs/API.md, y los
 * nombres de los campos coinciden con las columnas del modelo relacional
 * (sección 3.3 del documento del proyecto: CLIENTE, BARBERO, CAJERO, CITA,
 * PRODUCTO, VENTA, DETALLE_VENTA, CIERRE_CAJA).
 *
 * Convenciones con el back end:
 *   - Formato JSON en peticiones y respuestas (salvo subida de fotos: multipart).
 *   - Autenticación: cabecera `Authorization: Bearer <token>` (JWT).
 *   - Errores: código HTTP + cuerpo `{ "mensaje": "Texto para el usuario" }`.
 *   - 401: token vencido o inválido   → se cierra la sesión.
 *   - 403: el rol no tiene permiso      → se muestra el mensaje.
 *   - 503: servicio suspendido          → se muestra la pantalla de mantenimiento.
 *   - Fechas: "AAAA-MM-DD"; fecha y hora: "AAAA-MM-DDTHH:MM:SS" (hora local).
 *
 * Con `APP_CONFIG.USAR_BACKEND = false` las peticiones las contesta
 * `ApiSinServidor` (assets/js/api-sin-servidor.js) sin datos de ejemplo.
 *
 * Expone los objetos globales `Api` y `ErrorApi`.
 * Requiere: config.js, sesion.js. Opcional: api-sin-servidor.js
 */
(function () {
  'use strict';

  var CFG = window.APP_CONFIG;

  // ---------------------------------------------------------------------------
  // Tipos de datos (reflejan las tablas MySQL)
  // ---------------------------------------------------------------------------

  /**
   * @typedef {Object} Cliente                       Tabla CLIENTE
   * @property {number} ID_Cliente
   * @property {string} Nombre
   * @property {string} Telefono                     10 dígitos, único.
   * @property {string|null} FotoCorteReferencia     URL de la imagen.
   * @property {string|null} Descripcion             Estilo de corte preferido.
   * @property {string|null} Observaciones           Notas técnicas o médicas (columna sugerida).
   * @property {'Activa'|'Inactiva'} EstadoMembresia
   * @property {number|null} ID_Membresia            Plan contratado (tabla MEMBRESIA, sugerida).
   * @property {string|null} NombrePlan              (JOIN) Nombre del plan.
   * @property {number|null} DescuentoServicios      (JOIN) Porcentaje 0-100 sobre servicios.
   * @property {string|null} FechaInicio             "AAAA-MM-DD"
   * @property {number} FaltasConsecutivas
   */

  /**
   * @typedef {Object} Barbero                       Tabla BARBERO (sin Contrasena)
   * @property {number} ID_Barbero
   * @property {string} Nombre
   * @property {string} Telefono
   * @property {string} HoraEntrada                  "09:00"
   * @property {string} HoraSalida                   "19:00"
   * @property {string|null} ComidaInicio            (columna sugerida) "14:00"
   * @property {string|null} ComidaFin               (columna sugerida) "15:00"
   * @property {string} DiasTrabajo                  Letras separadas por coma: "L,M,X,J,V,S"
   * @property {string|null} RolesActividades        Texto separado por comas.
   */

  /**
   * @typedef {Object} Cita                          Tabla CITA (+ JOIN)
   * @property {number} ID_Cita
   * @property {string} FechaHora                    "AAAA-MM-DDTHH:MM:SS"
   * @property {'Agendada'|'EnEspera'|'EnAtencion'|'Atendida'|'Cancelada'|'NoAsistio'} Estado
   * @property {'WhatsApp'|'Caja'|'App'|'SinCita'} Origen
   * @property {number} ID_Cliente
   * @property {number} ID_Barbero
   * @property {string} NombreCliente                (JOIN)
   * @property {string} NombreBarbero                (JOIN)
   * @property {string|null} NombreServicio          (JOIN, opcional)
   */

  /**
   * @typedef {Object} Producto                      Tabla PRODUCTO
   * @property {number} ID_Producto
   * @property {string} NombreProducto
   * @property {number} Precio
   * @property {string|null} FotoProducto
   * @property {string|null} Descripcion
   * @property {number} Stock
   */

  /**
   * @typedef {Object} DetalleVenta                  Tabla DETALLE_VENTA
   * @property {number} ID_Detalle
   * @property {'Servicio'|'Producto'|'Membresía'} TipoItem
   * @property {string} NombreItem
   * @property {number} PrecioUnitario
   * @property {number} Cantidad
   * @property {number|null} ID_Barbero
   * @property {string|null} NombreBarbero           (JOIN)
   * @property {number|null} ID_Producto
   */

  /**
   * @typedef {Object} Venta                         Tabla VENTA (+ JOIN)
   * @property {number} ID_Venta
   * @property {string} NumeroFactura                Folio único.
   * @property {string} FechaHoraCobro
   * @property {number} Subtotal                     Suma de conceptos antes de descuento.
   * @property {number} Descuento                    Descuento por membresía.
   * @property {number} ImporteTotal
   * @property {number} IVA                          IVA incluido en el total.
   * @property {'Efectivo'|'Tarjeta'|'Transferencia'} MetodoPago
   * @property {number|null} MontoRecibido           Solo efectivo.
   * @property {number|null} Cambio                  Solo efectivo.
   * @property {number|null} ID_Cliente
   * @property {string|null} NombreCliente           (JOIN)
   * @property {string|null} TelefonoCliente         (JOIN)
   * @property {number} ID_Cajero
   * @property {string} NombreCajero                 (JOIN)
   * @property {number|null} ID_Corte
   * @property {DetalleVenta[]} [Detalle]
   */

  // ---------------------------------------------------------------------------
  // Error de la API
  // ---------------------------------------------------------------------------

  /**
   * Error con el código HTTP y el mensaje que envía el back end.
   * @param {string} mensaje  Texto listo para mostrarse al usuario.
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

  // ---------------------------------------------------------------------------
  // Petición base
  // ---------------------------------------------------------------------------

  /**
   * Arma la cadena de consulta omitiendo valores vacíos.
   * @param {Object} [consulta]
   * @returns {string} Ej. "?fecha=2026-10-24&barbero=3"
   */
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
   * Realiza una petición a la API y devuelve el cuerpo JSON ya interpretado.
   *
   * @param {'GET'|'POST'|'PUT'|'PATCH'|'DELETE'} metodo
   * @param {string} ruta  Ruta relativa a API_URL, ej. "/clientes".
   * @param {Object} [opciones]
   * @param {Object} [opciones.consulta]  Parámetros de la URL.
   * @param {Object|FormData} [opciones.cuerpo]  Cuerpo de la petición.
   * @returns {Promise<*>}
   * @throws {ErrorApi}
   */
  async function solicitar(metodo, ruta, opciones) {
    opciones = opciones || {};

    // Modo sin servidor: no se hace ninguna llamada de red.
    if (!CFG.USAR_BACKEND) {
      if (!window.ApiSinServidor) throw new ErrorApi('Falta assets/js/api-sin-servidor.js.', 0);
      return window.ApiSinServidor.responder(metodo, ruta, opciones);
    }

    var cabeceras = { Accept: 'application/json' };
    var cuerpo = opciones.cuerpo;
    if (cuerpo && !(cuerpo instanceof FormData)) {
      cabeceras['Content-Type'] = 'application/json';
      cuerpo = JSON.stringify(cuerpo);
    }
    var token = window.Sesion.token();
    if (token) cabeceras.Authorization = 'Bearer ' + token;

    var control = new AbortController();
    var temporizador = setTimeout(function () { control.abort(); }, CFG.TIEMPO_ESPERA_MS);
    var respuesta;
    try {
      respuesta = await fetch(CFG.API_URL + ruta + cadenaConsulta(opciones.consulta), {
        method: metodo,
        headers: cabeceras,
        body: cuerpo,
        signal: control.signal
      });
    } catch (error) {
      throw new ErrorApi(
        error.name === 'AbortError' ? 'El servidor tardó demasiado en responder.' : 'No hay conexión con el servidor.',
        0, error);
    } finally {
      clearTimeout(temporizador);
    }

    var datos = null;
    if (respuesta.status !== 204) {
      try { datos = await respuesta.json(); } catch (e) { datos = null; }
    }
    if (respuesta.ok) return datos;

    var mensaje = (datos && (datos.mensaje || datos.error)) || ('Error ' + respuesta.status + ' del servidor.');

    if (respuesta.status === 401 && ruta !== '/auth/login') {
      window.Sesion.borrar();
      window.location.replace(CFG.PAGINA_LOGIN);
    }
    if (respuesta.status === 503) {
      window.Sesion.guardarEstadoServicio({ EstadoServicio: 'Suspendido', MensajeMantenimiento: mensaje });
      if (window.Sesion.rol() !== window.Sesion.ROLES.DUENO) window.location.replace(CFG.PAGINA_MANTENIMIENTO);
    }
    throw new ErrorApi(mensaje, respuesta.status, datos);
  }

  var obtener = function (ruta, consulta) { return solicitar('GET', ruta, { consulta: consulta }); };
  var crear = function (ruta, cuerpo) { return solicitar('POST', ruta, { cuerpo: cuerpo }); };
  var reemplazar = function (ruta, cuerpo) { return solicitar('PUT', ruta, { cuerpo: cuerpo }); };
  var modificar = function (ruta, cuerpo) { return solicitar('PATCH', ruta, { cuerpo: cuerpo }); };
  var eliminar = function (ruta) { return solicitar('DELETE', ruta); };

  // ---------------------------------------------------------------------------
  // Endpoints agrupados por recurso
  // ---------------------------------------------------------------------------

  var Api = {
    /** Autenticación (tablas CAJERO, BARBERO y administrador). */
    auth: {
      /**
       * POST /auth/login
       * @param {string} usuario
       * @param {string} contrasena
       * @returns {Promise<{token:string, usuario:{id:number, nombre:string, usuario:string, rol:string}}>}
       */
      iniciarSesion: function (usuario, contrasena) {
        return crear('/auth/login', { usuario: usuario, contrasena: contrasena });
      },
      /** POST /auth/logout — invalida el token en el servidor. */
      cerrarSesion: function () { return crear('/auth/logout'); }
    },

    /** Estado de la conexión (punto «En línea» del encabezado). */
    salud: {
      /** GET /salud → { estado: "ok" } */
      verificar: function () { return obtener('/salud'); }
    },

    /** Datos del negocio y suspensión del servicio (tabla ESTABLECIMIENTO). */
    establecimiento: {
      /** GET /establecimiento → { NombreEstablecimiento, Direccion, Telefono, DatosFiscales, MensajeTicket } */
      obtener: function () { return obtener('/establecimiento'); },
      /**
       * GET /establecimiento/estado (público) → { EstadoServicio, MensajeMantenimiento }
       * Guarda una copia local para la protección de pantallas.
       */
      estado: function () {
        return obtener('/establecimiento/estado').then(function (estado) {
          if (estado) window.Sesion.guardarEstadoServicio(estado);
          return estado;
        });
      },
      /**
       * PUT /establecimiento/estado (solo Dueño)
       * @param {{EstadoServicio:'Activo'|'Suspendido', MensajeMantenimiento:string}} datos
       */
      cambiarEstado: function (datos) {
        return reemplazar('/establecimiento/estado', datos).then(function (estado) {
          window.Sesion.guardarEstadoServicio(estado || datos);
          return estado || datos;
        });
      }
    },

    /** Clientes (tabla CLIENTE). */
    clientes: {
      /** GET /clientes?buscar= → Cliente[]  (busca por nombre o teléfono) */
      buscar: function (texto) { return obtener('/clientes', { buscar: texto }); },
      /** GET /clientes/:id → Cliente */
      obtener: function (id) { return obtener('/clientes/' + encodeURIComponent(id)); },
      /**
       * POST /clientes → Cliente creado (con ID_Cliente).
       * Se envía como multipart/form-data cuando incluye la foto de referencia.
       * @param {FormData|Object} datos
       */
      crear: function (datos) { return crear('/clientes', datos); },
      /** PUT /clientes/:id → Cliente actualizado */
      actualizar: function (id, datos) { return reemplazar('/clientes/' + encodeURIComponent(id), datos); },
      /** GET /clientes/:id/servicios → [{ FechaHoraCobro, NombreItem, NombreBarbero, PrecioUnitario, Cantidad }] */
      historial: function (id) { return obtener('/clientes/' + encodeURIComponent(id) + '/servicios'); },
      /** GET /clientes/:id/fotos → [{ ID_Foto, Url, Titulo, Notas, Fecha, NombreBarbero }] */
      fotos: function (id) { return obtener('/clientes/' + encodeURIComponent(id) + '/fotos'); },
      /** POST /clientes/:id/fotos (multipart: foto, Titulo, Notas) */
      subirFoto: function (id, formulario) { return crear('/clientes/' + encodeURIComponent(id) + '/fotos', formulario); },
      /** DELETE /clientes/:id/fotos/:idFoto */
      eliminarFoto: function (id, idFoto) {
        return eliminar('/clientes/' + encodeURIComponent(id) + '/fotos/' + encodeURIComponent(idFoto));
      },
      /** PUT /clientes/:id/foto-referencia { ID_Foto } */
      usarComoReferencia: function (id, idFoto) {
        return reemplazar('/clientes/' + encodeURIComponent(id) + '/foto-referencia', { ID_Foto: idFoto });
      }
    },

    /** Barberos y sus horarios (tabla BARBERO). */
    barberos: {
      /** GET /barberos → Barbero[] */
      listar: function () { return obtener('/barberos'); },
      /** GET /barberos/yo → Barbero del usuario con sesión (rol Barbero) */
      yo: function () { return obtener('/barberos/yo'); },
      /**
       * PUT /barberos/:id/horario (solo Dueño)
       * @param {number} id
       * @param {{HoraEntrada:string, HoraSalida:string, ComidaInicio:string, ComidaFin:string, DiasTrabajo:string, RolesActividades:string}} datos
       */
      actualizarHorario: function (id, datos) { return reemplazar('/barberos/' + encodeURIComponent(id) + '/horario', datos); },
      /** GET /barberos/:id/ingresos?dias=7 → [{ Fecha, Servicios, Ingreso }] */
      ingresos: function (id, dias) { return obtener('/barberos/' + encodeURIComponent(id) + '/ingresos', { dias: dias }); }
    },

    /** Citas (tabla CITA). */
    citas: {
      /** GET /citas?fecha=&barbero= → Cita[] */
      listar: function (filtros) { return obtener('/citas', filtros); },
      /** GET /citas/mias?fecha= → Cita[] del barbero con sesión */
      mias: function (fecha) { return obtener('/citas/mias', { fecha: fecha }); },
      /** GET /citas/proxima → Cita | null (siguiente turno del barbero con sesión) */
      proxima: function () { return obtener('/citas/proxima'); },
      /**
       * GET /citas/disponibilidad?barbero=&fecha=
       * → [{ Hora:"09:00", Estado:"Libre"|"Ocupado"|"NoDisponible", Motivo?, NombreCliente?, Origen? }]
       */
      disponibilidad: function (barbero, fecha) { return obtener('/citas/disponibilidad', { barbero: barbero, fecha: fecha }); },
      /**
       * POST /citas → Cita creada. El back end valida jornada, descanso y
       * que el horario siga libre (UNIQUE ID_Barbero + FechaHora).
       * @param {{ID_Cliente:number, ID_Barbero:number, FechaHora:string, ID_Servicio?:number, Origen:string}} datos
       */
      crear: function (datos) { return crear('/citas', datos); },
      /** PATCH /citas/:id/estado { Estado } — transiciones del diagrama de estados (3.2). */
      cambiarEstado: function (id, estado) { return modificar('/citas/' + encodeURIComponent(id) + '/estado', { Estado: estado }); }
    },

    /** Catálogos para el punto de venta. */
    catalogos: {
      /** GET /servicios → [{ ID_Servicio, NombreServicio, Descripcion, Precio, DuracionMin }] */
      servicios: function () { return obtener('/servicios'); },
      /** GET /productos → Producto[] */
      productos: function () { return obtener('/productos'); },
      /** GET /membresias → [{ ID_Membresia, NombrePlan, Precio, DescuentoServicios, DuracionDias }] */
      membresias: function () { return obtener('/membresias'); }
    },

    /** Ventas y tickets (tablas VENTA y DETALLE_VENTA). */
    ventas: {
      /**
       * POST /ventas → Venta completa (con Detalle) para el ticket.
       * El back end recalcula precios, descuento e IVA, descuenta inventario
       * y guarda todo en una sola transacción.
       * @param {{ID_Cliente:number|null, MetodoPago:string, MontoRecibido:number|null,
       *          Detalle:Array<{TipoItem:string, ID_Servicio?:number, ID_Producto?:number,
       *          ID_Membresia?:number, ID_Barbero?:number, Cantidad:number}>}} datos
       */
      crear: function (datos) { return crear('/ventas', datos); },
      /**
       * GET /ventas?desde=&hasta=&concepto=&buscar=&pagina=&tamano=
       * → { registros: Venta[], total, pagina, resumen: { Total, Transacciones, Servicios, Productos, TicketPromedio, PorMetodo } }
       */
      listar: function (filtros) { return obtener('/ventas', filtros); },
      /** GET /ventas/:id → Venta (con Detalle) */
      obtener: function (id) { return obtener('/ventas/' + encodeURIComponent(id)); },
      /** POST /ventas/:id/enviar { canal: "whatsapp" | "sms" } — envía el ticket digital al cliente. */
      enviarTicket: function (id, canal) { return crear('/ventas/' + encodeURIComponent(id) + '/enviar', { canal: canal }); }
    },

    /** Cierre de caja (tabla CIERRE_CAJA). */
    cierres: {
      /**
       * GET /cierres/resumen → ventas del cajero con sesión que aún no tienen corte:
       * { Fecha, NombreCajero, FondoInicial, Ventas: Venta[], TotalIngresos, TotalIVA,
       *   PorMetodo: { Efectivo, Tarjeta, Transferencia }, Servicios, Productos, TicketPromedio }
       */
      resumen: function () { return obtener('/cierres/resumen'); },
      /** POST /cierres { EfectivoContado } → { ID_Corte, FechaCorte, TotalIngresos, TotalIVA, EfectivoContado, Diferencia } */
      crear: function (datos) { return crear('/cierres', datos); }
    },

    /** Avisos para el barbero (cancelaciones por WhatsApp, cambios de horario). */
    avisos: {
      /** GET /avisos → [{ ID_Aviso, Tipo, Mensaje, Fecha }] */
      listar: function () { return obtener('/avisos'); }
    }
  };

  window.ErrorApi = ErrorApi;
  window.Api = Object.freeze(Api);
})();
