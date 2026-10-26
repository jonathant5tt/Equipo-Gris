# Contrato de la API REST · Engreídos Barbershop

Este documento describe **lo que el front end espera del back end** (Node.js + Express + MySQL).
Cada endpoint corresponde a una función de `assets/js/api.js`; los nombres de los campos JSON son
**los mismos que las columnas de MySQL** del modelo relacional (sección 3.3 del documento del proyecto),
para que el back end pueda devolver las filas casi sin transformarlas.

- [Convenciones generales](#convenciones-generales)
- [Autenticación](#autenticación)
- [Endpoints](#endpoints)
- [Columnas y tablas sugeridas](#columnas-y-tablas-sugeridas)
- [Reglas que debe validar el servidor](#reglas-que-debe-validar-el-servidor)

---

## Convenciones generales

| Tema | Regla |
|---|---|
| URL base | `APP_CONFIG.API_URL` en `assets/js/config.js` (por omisión `http://localhost:3000/api`). |
| Formato | JSON en peticiones y respuestas. La subida de fotos usa `multipart/form-data`. |
| Autenticación | Cabecera `Authorization: Bearer <token>` (JWT) en todas las rutas, salvo las marcadas como **públicas**. |
| Fechas | `"AAAA-MM-DD"`. Fecha y hora: `"AAAA-MM-DDTHH:MM:SS"` en hora local del negocio (`America/Mexico_City`). Horas: `"HH:MM"` o `"HH:MM:SS"` (columna `TIME`). |
| Importes | Números (no texto), con dos decimales. Columnas `DECIMAL(10,2)` → convertir a `Number` antes de responder (el driver `mysql2` las entrega como texto). |
| Errores | Código HTTP + cuerpo `{ "mensaje": "Texto listo para mostrarse al usuario" }`. |
| CORS | Permitir el origen donde se publique el front end y las cabeceras `Authorization` y `Content-Type`. |

### Códigos de error que el front end interpreta

| Código | Cuándo | Qué hace el front end |
|---|---|---|
| `400` | Datos inválidos | Muestra `mensaje`. |
| `401` | Token ausente, vencido o inválido | Borra la sesión y regresa a `index.html` (en `/auth/login`: muestra «Usuario o contraseña incorrectos»). |
| `403` | El rol no tiene permiso | Muestra `mensaje`. |
| `404` | Registro inexistente | Muestra `mensaje` o el estado vacío de la pantalla. |
| `409` | Conflicto (horario ya ocupado, teléfono duplicado, sin existencias) | Muestra `mensaje` y, en citas, vuelve a consultar los horarios. |
| `503` | Servicio suspendido por el Dueño | Guarda el estado y envía a cajeros y barberos a `mantenimiento.html`. |

---

## Autenticación

Los usuarios salen de tres tablas: `ADMINISTRADOR` (rol **Dueño**), `CAJERO` (rol **Cajero**) y `BARBERO` (rol **Barbero**).
Las contraseñas se guardan cifradas con **bcrypt** en la columna `Contrasena`.

### `POST /auth/login` · pública
```json
// Petición
{ "usuario": "cajero", "contrasena": "••••" }

// Respuesta 200
{
  "token": "eyJhbGciOi...",
  "usuario": { "id": 3, "nombre": "Nombre del cajero", "usuario": "cajero", "rol": "Cajero" }
}
```
- `rol` debe ser exactamente `"Cajero"`, `"Dueño"` o `"Barbero"` (ver `Sesion.ROLES` en `sesion.js`).
- El JWT debe incluir `id` y `rol` para que cada endpoint valide permisos.
- Credenciales incorrectas → `401 { "mensaje": "Usuario o contraseña incorrectos." }`.
- Sugerencia: agregar una columna `Usuario VARCHAR(50) UNIQUE` a las tres tablas para iniciar sesión.

### `POST /auth/logout`
Invalida el token (lista negra o simplemente `204`). El front end borra la sesión aunque falle.

---

## Endpoints

Permisos: **C** = Cajero · **D** = Dueño · **B** = Barbero.

### Salud y establecimiento

| Método y ruta | Roles | Respuesta |
|---|---|---|
| `GET /salud` | pública | `{ "estado": "ok" }` — alimenta el punto «En línea» del encabezado. |
| `GET /establecimiento` | C D B | `{ NombreEstablecimiento, Direccion, Telefono, DatosFiscales, MensajeTicket }` |
| `GET /establecimiento/estado` | pública | `{ EstadoServicio: "Activo" \| "Suspendido", MensajeMantenimiento }` |
| `PUT /establecimiento/estado` | D | Cuerpo y respuesta: `{ EstadoServicio, MensajeMantenimiento }` |

Mientras `EstadoServicio = 'Suspendido'`, todas las rutas (excepto `/auth/*`, `/salud`, `/establecimiento/estado`)
deben responder **`503`** a Cajero y Barbero, con `MensajeMantenimiento` en `mensaje`. El Dueño sigue operando.

### Clientes — tabla `CLIENTE`

| Método y ruta | Roles | Petición | Respuesta |
|---|---|---|---|
| `GET /clientes?buscar=texto` | C D B | — | `Cliente[]` (busca en `Nombre` y `Telefono`; máx. 20) |
| `GET /clientes/:id` | C D B | — | `Cliente` |
| `POST /clientes` | C D B | `multipart/form-data` (ver abajo) | `Cliente` creado (con `ID_Cliente`) |
| `PUT /clientes/:id` | C D | JSON con los campos editables | `Cliente` |
| `GET /clientes/:id/servicios` | C D B | — | `[{ FechaHoraCobro, NombreItem, NombreBarbero, PrecioUnitario, Cantidad }]` (renglones de `DETALLE_VENTA` con `TipoItem='Servicio'`, más recientes primero) |
| `GET /clientes/:id/fotos` | C D B | — | `[{ ID_Foto, Url, Titulo, Notas, Fecha, NombreBarbero }]` |
| `POST /clientes/:id/fotos` | C D B | `multipart`: `foto` (y opcionalmente `Titulo`, `Notas`) | Foto creada; el servidor registra la fecha y al usuario que la subió |
| `DELETE /clientes/:id/fotos/:idFoto` | C D B | — | `204` |
| `PUT /clientes/:id/foto-referencia` | C D B | `{ ID_Foto }` | `Cliente` (actualiza `FotoCorteReferencia`) |

**Objeto `Cliente`**
```json
{
  "ID_Cliente": 7, "Nombre": "…", "Telefono": "2281234567",
  "FotoCorteReferencia": "/uploads/clientes/7/ref.jpg",
  "Descripcion": "Estilo de corte preferido", "Observaciones": "Notas técnicas o médicas",
  "EstadoMembresia": "Activa", "ID_Membresia": 1, "FechaInicio": "2026-09-01", "FaltasConsecutivas": 0,
  "NombrePlan": "…", "DescuentoServicios": 10
}
```
`NombrePlan` y `DescuentoServicios` vienen de un `LEFT JOIN MEMBRESIA`.

**Alta (`POST /clientes`, multipart)** — campos del formulario `nuevo-cliente.html`:
`Nombre`, `Lada` (ej. `+52`), `Telefono` (10 dígitos), `Descripcion`, `Observaciones`,
`EstadoMembresia` (`Activa`/`Inactiva`), `ID_Membresia`, `FechaInicio`, `foto` (archivo opcional).
Teléfono repetido → `409 { "mensaje": "Ya existe un cliente con ese teléfono." }`.

### Barberos — tabla `BARBERO`

| Método y ruta | Roles | Petición | Respuesta |
|---|---|---|---|
| `GET /barberos` | C D B | — | `Barbero[]` (sin `Contrasena`) |
| `GET /barberos/yo` | B | — | `Barbero` del token |
| `PUT /barberos/:id/horario` | D | `{ HoraEntrada, HoraSalida, ComidaInicio, ComidaFin, DiasTrabajo, RolesActividades }` | `Barbero` |
| `GET /barberos/:id/ingresos?dias=7` | D | — | `[{ Fecha, Servicios, Ingreso }]` (uno por día con servicios) |

**Objeto `Barbero`**
```json
{
  "ID_Barbero": 1, "Nombre": "…", "Telefono": "…",
  "HoraEntrada": "09:00:00", "HoraSalida": "19:00:00",
  "ComidaInicio": "14:00:00", "ComidaFin": "15:00:00",
  "DiasTrabajo": "L,M,X,J,V,S", "RolesActividades": "Cortes, Barba"
}
```
`DiasTrabajo`: letras `L M X J V S D` separadas por coma (X = miércoles). Los días ausentes son de descanso.

`ingresos` se obtiene de `DETALLE_VENTA` (servicios del barbero) agrupado por `DATE(VENTA.FechaHoraCobro)`:
`Servicios = SUM(Cantidad)`, `Ingreso = SUM(PrecioUnitario * Cantidad)`.

### Citas — tabla `CITA`

| Método y ruta | Roles | Petición | Respuesta |
|---|---|---|---|
| `GET /citas?fecha=&barbero=` | C D | — | `Cita[]` |
| `GET /citas/mias?fecha=AAAA-MM-DD` | B | — | `Cita[]` del barbero del token, ordenadas por hora |
| `GET /citas/proxima` | B | — | `Cita` o `null`: la cita `EnAtencion`, o la siguiente `Agendada`/`EnEspera` de hoy |
| `GET /citas/disponibilidad?barbero=&fecha=` | C D B | — | Lista de bloques (ver abajo) |
| `POST /citas` | C D B | `{ ID_Cliente, ID_Barbero, FechaHora, ID_Servicio, Origen }` | `Cita` creada |
| `PATCH /citas/:id/estado` | C D B | `{ Estado }` | `Cita` |

**Objeto `Cita`** (con `JOIN` a `CLIENTE`, `BARBERO` y `SERVICIO`)
```json
{
  "ID_Cita": 12, "FechaHora": "2026-10-25T11:00:00",
  "Estado": "Agendada", "Origen": "WhatsApp",
  "ID_Cliente": 7, "ID_Barbero": 1,
  "NombreCliente": "…", "NombreBarbero": "…", "NombreServicio": "…"
}
```
- `Estado`: `Agendada`, `EnEspera`, `EnAtencion`, `Atendida`, `Cancelada`, `NoAsistio` (diagrama de estados 3.2).
- `Origen`: `WhatsApp`, `Caja`, `App`, `SinCita`. El front end envía `Caja` (Cajero/Dueño) o `App` (Barbero).

**Disponibilidad** — un bloque por cada `DURACION_CITA_MIN` (30 min) dentro de la jornada del barbero:
```json
[
  { "Hora": "09:00", "Estado": "Libre" },
  { "Hora": "09:30", "Estado": "Ocupado", "NombreCliente": "…", "Origen": "WhatsApp" },
  { "Hora": "14:00", "Estado": "NoDisponible", "Motivo": "Comida" }
]
```
Si la fecha es día de descanso del barbero, responder `[]`.

**Transiciones permitidas en `PATCH /citas/:id/estado`** (las demás → `409`):
`Agendada → EnEspera | EnAtencion | Cancelada | NoAsistio` · `EnEspera → EnAtencion | Cancelada` ·
`EnAtencion → Atendida`. Al pasar a `NoAsistio` incrementar `CLIENTE.FaltasConsecutivas`; al pasar a `Atendida`, reiniciarlo a 0.

### Catálogos

| Método y ruta | Roles | Respuesta |
|---|---|---|
| `GET /servicios` | C D B | `[{ ID_Servicio, NombreServicio, Descripcion, Precio, DuracionMin }]` |
| `GET /productos` | C D | `[{ ID_Producto, NombreProducto, Precio, FotoProducto, Descripcion, Stock }]` |
| `GET /membresias` | C D B | `[{ ID_Membresia, NombrePlan, Precio, DescuentoServicios, DuracionDias }]` |

### Ventas — tablas `VENTA` y `DETALLE_VENTA`

| Método y ruta | Roles | Petición | Respuesta |
|---|---|---|---|
| `POST /ventas` | C D | ver abajo | `Venta` completa con `Detalle` |
| `GET /ventas?desde=&hasta=&concepto=&buscar=&pagina=&tamano=` | C D | — | `{ registros, total, pagina, resumen }` |
| `GET /ventas/:id` | C D | — | `Venta` con `Detalle` |
| `POST /ventas/:id/enviar` | C D | `{ canal: "whatsapp" \| "sms" }` | `204` |

**Registrar cobro (`POST /ventas`)**
```json
{
  "ID_Cliente": 7,
  "MetodoPago": "Efectivo",
  "MontoRecibido": 500,
  "TotalEsperado": 315,
  "Detalle": [
    { "TipoItem": "Servicio",  "ID_Servicio": 1, "ID_Barbero": 1, "Cantidad": 1 },
    { "TipoItem": "Producto",  "ID_Producto": 4, "Cantidad": 2 },
    { "TipoItem": "Membresía", "ID_Membresia": 1, "Cantidad": 1 }
  ]
}
```
El servidor, **en una sola transacción**:
1. Toma precios y nombres del catálogo (nunca confía en precios del cliente) y los copia a `NombreItem` y `PrecioUnitario`.
2. Aplica `DescuentoServicios` de la membresía activa del cliente **solo a servicios**.
3. Calcula `ImporteTotal`, `IVA = ImporteTotal − ImporteTotal / 1.16` y, si es efectivo, `Cambio`.
4. Si su total difiere de `TotalEsperado`, responde `409` para que el cajero revise.
5. Descuenta `PRODUCTO.Stock` (`UPDATE … SET Stock = Stock − ? WHERE ID_Producto = ? AND Stock >= ?`; si no afecta filas → `409` «Sin existencias»).
6. Si se vendió una membresía, actualiza `CLIENTE.EstadoMembresia`, `ID_Membresia` y `FechaInicio`.
7. Genera `NumeroFactura` único y deja `ID_Corte = NULL` (turno abierto).

**Objeto `Venta`**
```json
{
  "ID_Venta": 55, "NumeroFactura": "F-000055", "FechaHoraCobro": "2026-10-25T12:30:00",
  "Subtotal": 330, "Descuento": 15, "ImporteTotal": 315, "IVA": 43.45,
  "MetodoPago": "Efectivo", "MontoRecibido": 400, "Cambio": 85,
  "ID_Cliente": 7, "NombreCliente": "…", "TelefonoCliente": "…",
  "ID_Cajero": 1, "NombreCajero": "…", "ID_Corte": null,
  "Detalle": [
    { "ID_Detalle": 1, "TipoItem": "Servicio", "NombreItem": "…", "PrecioUnitario": 150, "Cantidad": 1,
      "ID_Barbero": 1, "NombreBarbero": "…", "ID_Producto": null }
  ]
}
```

**Listado (`GET /ventas`)** — usado por `historial-ventas.html`:
- Filtros: `desde`/`hasta` (fechas inclusivas), `concepto` (`Servicio` \| `Producto` \| `Membresía`), `buscar` (folio o nombre del cliente).
- Paginación: `pagina` (desde 1) y `tamano` (por omisión 20). Exportar CSV pide `tamano = total`.
- Cada registro agrega tres campos de resumen del detalle para la tabla:
  `TipoItem` (del primer concepto), `Concepto` (ej. `"Corte clásico + 1 más"`) y `NombreBarbero` (`null` = «Mostrador»).
```json
{
  "registros": [ /* Venta sin Detalle + TipoItem, Concepto, NombreBarbero */ ],
  "total": 125, "pagina": 1,
  "resumen": {
    "Total": 9650, "Transacciones": 30, "Servicios": 41, "Productos": 12, "TicketPromedio": 321.67,
    "PorMetodo": { "Efectivo": 3150, "Tarjeta": 1500, "Transferencia": 5000 }
  }
}
```
`resumen` se calcula sobre **todo** el filtro, no solo sobre la página.

### Cierre de caja — tabla `CIERRE_CAJA`

| Método y ruta | Roles | Petición | Respuesta |
|---|---|---|---|
| `GET /cierres/resumen` | C D | — | Ventas del cajero del token con `ID_Corte IS NULL` |
| `POST /cierres` | C D | `{ EfectivoContado }` | Corte creado |

```json
// GET /cierres/resumen
{
  "Fecha": "2026-10-25", "NombreCajero": "…", "FondoInicial": 500,
  "Ventas": [ /* registros como en GET /ventas */ ],
  "TotalIngresos": 965, "TotalIVA": 133.10,
  "PorMetodo": { "Efectivo": 315, "Tarjeta": 150, "Transferencia": 500 },
  "Servicios": 2, "Productos": 1, "TicketPromedio": 321.67
}

// POST /cierres → 201
{ "ID_Corte": 3, "FechaCorte": "2026-10-25", "TotalIngresos": 965, "TotalIVA": 133.10,
  "EfectivoContado": 815, "Diferencia": 0 }
```
`POST /cierres`, en una transacción: inserta el corte y ejecuta
`UPDATE VENTA SET ID_Corte = ? WHERE ID_Cajero = ? AND ID_Corte IS NULL`.
Sin ventas pendientes → `409`. Ya existe un corte del cajero en el día → `409` (`UNIQUE (ID_Cajero, FechaCorte)`).
`Diferencia = EfectivoContado − (FondoInicial + PorMetodo.Efectivo)`.

### Avisos

| Método y ruta | Roles | Respuesta |
|---|---|---|
| `GET /avisos` | B | `[{ ID_Aviso, Tipo, Mensaje, Fecha }]` no leídos del barbero del token (ej. cancelaciones por WhatsApp, cambios de horario). |

---

## Columnas y tablas sugeridas

El front end ya usa estos datos además de las 8 tablas del modelo relacional (3.3). Están incluidos en `docs/esquema.sql`.

| Tabla | Columna o tabla nueva | Para qué |
|---|---|---|
| `CLIENTE` | `Observaciones`, `ID_Membresia` (FK) | Notas técnicas/médicas y plan contratado. |
| `BARBERO` | `ComidaInicio`, `ComidaFin`, `Usuario` | Horario de comida y nombre de usuario para iniciar sesión. |
| `CAJERO`, `ADMINISTRADOR` | `Usuario` | Nombre de usuario para iniciar sesión. |
| `CITA` | `ID_Servicio` (FK, opcional) | Servicio solicitado al agendar. |
| `VENTA` | `Subtotal`, `Descuento`, `MontoRecibido`, `Cambio` | Datos que se imprimen en el ticket. |
| `CIERRE_CAJA` | `FondoInicial`, `Diferencia` | Arqueo completo del corte. |
| `ESTABLECIMIENTO` | `Direccion`, `Telefono`, `MensajeTicket`, `FondoCaja` | Encabezado y pie del ticket; fondo inicial de caja. |
| **`SERVICIO`** | tabla nueva | Catálogo de servicios con precio y duración. |
| **`MEMBRESIA`** | tabla nueva | Planes y porcentaje de descuento en servicios. |
| **`FOTO_CLIENTE`** | tabla nueva | Galería de cortes del cliente. |
| **`AVISO`** | tabla nueva | Avisos para el barbero. |

---

## Reglas que debe validar el servidor

La interfaz valida para ayudar al usuario, pero **la autoridad es el back end**:

- Token y rol en cada endpoint (la protección de pantallas de `sesion.js` es solo visual).
- `CITA`: dentro de la jornada, fuera de la comida y del descanso, y libre (`UNIQUE (ID_Barbero, FechaHora)`).
- `BARBERO`: `HoraSalida > HoraEntrada`; la comida dentro de la jornada; al menos un día de trabajo.
- `CLIENTE.Telefono` único; 10 dígitos.
- `PRODUCTO.Stock >= 0` al vender.
- Precios, descuentos, IVA y totales siempre recalculados en el servidor.
- Respuesta `503` mientras el servicio esté suspendido (excepto para el Dueño).
