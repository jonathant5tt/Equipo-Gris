/**
 * @file api-sin-servidor.js
 * @description Respuestas locales para trabajar el front end SIN back end.
 *
 * Se usa solo cuando `APP_CONFIG.USAR_BACKEND` es `false`. Permite:
 *   - Iniciar sesión con los usuarios de prueba (solo desarrollo).
 *   - Navegar por todas las pantallas según el rol.
 *   - Suspender y reanudar el servicio (se guarda en este navegador).
 * No contiene datos de ejemplo: todas las consultas devuelven listas vacías,
 * por lo que cada pantalla muestra su estado vacío. Las operaciones de
 * guardado no se guardan y lo indican con un aviso.
 *
 * ⚠ Al conectar el back end, cambiar USAR_BACKEND a true en config.js. Este
 *   archivo puede eliminarse (y su <script>) cuando ya no se necesite.
 *
 * Expone el objeto global `ApiSinServidor`.
 * Requiere: config.js, utilidades.js, sesion.js, api.js
 */
(function () {
  'use strict';

  /**
   * Usuarios de prueba — SOLO PARA DESARROLLO.
   * En producción los usuarios salen de las tablas CAJERO, BARBERO y del
   * administrador, con contraseñas cifradas (bcrypt) validadas por el servidor.
   * @type {Object<string, {clave:string, rol:string, nombre:string}>}
   */
  var USUARIOS_PRUEBA = {
    cajero: { clave: '123', rol: 'Cajero', nombre: 'Cajero' },
    dueno: { clave: '123', rol: 'Dueño', nombre: 'Dueño' },
    barbero: { clave: '123', rol: 'Barbero', nombre: 'Barbero' }
  };

  /** Simula la latencia de red para que se vean los estados de carga. */
  var LATENCIA_MS = 120;

  var ESTADO_INICIAL = { EstadoServicio: 'Activo', MensajeMantenimiento: '' };

  /** Resumen en ceros para listados con totales. */
  function resumenVacio() {
    return {
      Total: 0, Transacciones: 0, Servicios: 0, Productos: 0, TicketPromedio: 0,
      PorMetodo: { Efectivo: 0, Tarjeta: 0, Transferencia: 0 }
    };
  }

  /**
   * Tabla de rutas: [método, expresión de la ruta, manejador].
   * El manejador recibe (coincidencias, opciones) y devuelve la respuesta.
   */
  var RUTAS = [
    ['POST', /^\/auth\/login$/, function (m, op) {
      var datos = op.cuerpo || {};
      var clave = window.Utilidades.normalizarTexto(datos.usuario);   // "Dueño" → "dueno"
      var u = USUARIOS_PRUEBA[clave];
      if (!u || u.clave !== datos.contrasena) {
        throw new window.ErrorApi('Usuario o contraseña incorrectos.', 401);
      }
      return { token: 'sin-servidor', usuario: { id: null, nombre: u.nombre, usuario: clave, rol: u.rol } };
    }],
    ['POST', /^\/auth\/logout$/, function () { return null; }],
    ['GET', /^\/salud$/, function () { return { estado: 'ok', modo: 'sin-servidor' }; }],

    ['GET', /^\/establecimiento$/, function () {
      return { NombreEstablecimiento: window.APP_CONFIG.NOMBRE, Direccion: '', Telefono: '', DatosFiscales: '', MensajeTicket: '' };
    }],
    ['GET', /^\/establecimiento\/estado$/, function () {
      return window.Sesion.estadoServicio() || ESTADO_INICIAL;
    }],
    ['PUT', /^\/establecimiento\/estado$/, function (m, op) {
      // Única operación que sí se conserva localmente, para poder probar el flujo de mantenimiento.
      var estado = {
        EstadoServicio: op.cuerpo.EstadoServicio === 'Suspendido' ? 'Suspendido' : 'Activo',
        MensajeMantenimiento: op.cuerpo.MensajeMantenimiento || ''
      };
      window.Sesion.guardarEstadoServicio(estado);
      return estado;
    }],

    // Registros individuales: sin servidor no existen.
    ['GET', /^\/clientes\/[^/]+$/, function () { return null; }],
    ['GET', /^\/ventas\/[^/]+$/, function () { return null; }],
    ['GET', /^\/barberos\/yo$/, function () { return null; }],
    ['GET', /^\/citas\/proxima$/, function () { return null; }],

    // Listados con resumen.
    ['GET', /^\/ventas$/, function () { return { registros: [], total: 0, pagina: 1, resumen: resumenVacio() }; }],
    ['GET', /^\/cierres\/resumen$/, function () {
      var r = resumenVacio();
      return {
        Fecha: window.Utilidades.fechaISO(), NombreCajero: (window.Sesion.usuario() || {}).nombre || '',
        FondoInicial: 0, Ventas: [], TotalIngresos: 0, TotalIVA: 0,
        PorMetodo: r.PorMetodo, Servicios: 0, Productos: 0, TicketPromedio: 0
      };
    }]
  ];

  /**
   * Contesta una petición como lo haría el back end.
   * @param {string} metodo
   * @param {string} ruta
   * @param {{consulta?:Object, cuerpo?:*}} opciones
   * @returns {Promise<*>}
   */
  function responder(metodo, ruta, opciones) {
    return new Promise(function (resolver, rechazar) {
      setTimeout(function () {
        try {
          for (var i = 0; i < RUTAS.length; i++) {
            var r = RUTAS[i];
            var coincidencia = metodo === r[0] && ruta.match(r[1]);
            if (coincidencia) { resolver(r[2](coincidencia, opciones || {})); return; }
          }
          if (metodo === 'GET') { resolver([]); return; }   // cualquier otro listado: vacío

          // Escrituras (POST, PUT, PATCH, DELETE): no se guardan.
          window.Utilidades.aviso('Modo sin servidor: la información no se guardó.', 'info');
          resolver({ simulado: true });
        } catch (error) {
          rechazar(error);
        }
      }, LATENCIA_MS);
    });
  }

  window.ApiSinServidor = Object.freeze({ responder: responder });
})();
