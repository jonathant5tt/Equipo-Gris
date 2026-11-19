# API REST · Engreídos Barbershop v3.4

Base: `http://<servidor>:3000/api` · JSON en UTF-8 · fechas `AAAA-MM-DD`,
horas `HH:MM`, fecha-hora `AAAA-MM-DD HH:MM:SS` (zona del negocio).

## Sesión
`POST /auth/login { usuario, contrasena }` → `{ token, usuario: { id, nombre, usuario, rol } }`.
Las demás rutas requieren `Authorization: Bearer <token>`. Roles: **D** Dueño,
**C** Cajero, **B** Barbero. Tras 5 intentos fallidos el usuario se bloquea 5 min.

## Errores
`{ mensaje, ...datos }` con código HTTP: 400 dato inválido · 401 sin sesión ·
403 sin permiso / contraseña incorrecta · 404 no existe · 409 conflicto
(horario ocupado, teléfono repetido, importes cambiados) · 413 archivo grande ·
429 demasiados intentos · 409 también si ya existe un servicio, producto o membresía activa con el mismo nombre · 503 servicio suspendido (`EstadoServicio`) o sin BD.

Con el servicio **suspendido**, Cajero y Barbero reciben 503 en todas las
rutas con sesión; el Dueño sigue operando.

---

## Autenticación
| Método | Ruta | Roles | Descripción |
|---|---|---|---|
| POST | /auth/login | — | Inicia sesión |
| POST | /auth/logout | todos | Cierra sesión |
| GET | /auth/yo | todos | Datos de la sesión |
| GET | /salud | — | `{ estado: "ok", version }` |
| GET | /auth/inicial | — | `{ RequiereDueno }` — true si aún no existe la cuenta del Dueño |
| POST | /auth/primer-dueno | — | `{ Nombre, Usuario, Contrasena }` → sesión. Solo funciona en el primer uso (409 después) |

## Negocio y ajustes
| Método | Ruta | Roles | Cuerpo / respuesta |
|---|---|---|---|
| GET | /establecimiento/estado | — | `{ EstadoServicio, MensajeMantenimiento }` |
| GET | /establecimiento | todos | Datos del negocio (ticket) |
| PUT | /establecimiento | D | `{ NombreEstablecimiento, Eslogan, Direccion, Telefono, DatosFiscales, MensajeTicket, RedesSociales, FondoCaja, HorarioAtencion, UbicacionMapa, InfoCitas }`. `HorarioAtencion`: `{ "L": ["09:00","20:00"], …, "D": null }` (null = cerrado) |
| PUT | /establecimiento/estado | D | `{ EstadoServicio: 'Activo'\|'Suspendido', MensajeMantenimiento }` |
| GET | /ajustes/whatsapp | D | `{ WhatsAppActivo, WhatsAppPhoneId, TokenGuardado, WhatsAppPlantillaCita, WhatsAppIdiomaPlantilla, LadaPais }` |
| PUT | /ajustes/whatsapp | D | Igual + `WhatsAppToken` (opcional: si se omite se conserva) |
| POST | /ajustes/whatsapp/prueba | D | `{ Telefono }` → resultado de envío (si el texto no pasa por la regla de 24 h usa la plantilla `hello_world`) |
| POST | /ajustes/whatsapp/conexion | D | Comprueba número y token sin enviar: `{ Conectado, Numero, Nombre, Calidad, Error }` |
| POST | /ajustes/whatsapp/bot/simular | D | `{ Mensaje }` → `{ Tema, Respuesta }` (lo que contestaría el bot) |
| GET | /ajustes/whatsapp/chats | D | Últimos 60 mensajes recibidos y respuestas del bot |
| GET | /sincronizar | todos | `{ servidor, citas, ventas, catalogo, clientes }`: contadores que suben con cada cambio; las pantallas los consultan cada 3 s para actualizarse solas |

`GET/PUT /ajustes/whatsapp` incluyen además `BotActivo, BotBienvenida, VerifyToken, AppSecretGuardado, RutaWebhook` (y al guardar `WhatsAppAppSecret`, `QuitarAppSecret`).

## Webhook de WhatsApp (público, lo llama Meta)
| Método | Ruta | Descripción |
|---|---|---|
| GET | /whatsapp/webhook | Verificación: devuelve `hub.challenge` si `hub.verify_token` coincide |
| POST | /whatsapp/webhook | Mensajes entrantes. Si hay clave secreta guardada exige `X-Hub-Signature-256`. Responde con el bot y guarda la conversación |

## Descuentos
| Método | Ruta | Roles | Cuerpo / respuesta |
|---|---|---|---|
| GET | /descuentos[?vigentes=1] | todos | Lista con `Estado` (`Vigente`, `En pausa`, `Programado`, `Terminado`) y `Vigente` |
| POST | /descuentos | D | `{ Nombre, Descripcion?, Aplica: 'Todo'\|'Servicios'\|'Productos'\|'Membresias', ID_Servicio?, ID_Producto?, Categoria?, ID_Membresia?, Tipo: 'Porcentaje'\|'Monto', Valor, FechaInicio?, FechaFin?, Activo? }` |
| PUT | /descuentos/:id | D | Igual |
| DELETE | /descuentos/:id | D | Baja lógica |

## Reembolsos (C D)
| Método | Ruta | Descripción |
|---|---|---|
| GET | /reembolsos?desde=&hasta= | `{ registros[], resumen: { Numero, Total, PorMetodo } }` |
| GET | /reembolsos/venta/:id | Venta con `Detalle[]` y, por renglón, `CantidadDisponible` e `ImporteDisponible` |
| POST | /reembolsos | `{ ID_Venta, Renglones: [{ ID_Detalle, Cantidad }], Motivo, MetodoDevolucion, RegresarInventario, Contrasena }` → reembolso con `Monto`. 403 si la contraseña no es la de la sesión |

## Cuentas (D)
| Método | Ruta | Cuerpo |
|---|---|---|
| GET | /cuentas | — (dueños, cajeros y barberos activos) |
| POST | /cuentas | `{ Rol: 'Cajero'\|'Barbero', Nombre, Usuario, Contrasena, Telefono? }` |
| PUT | /cuentas/:rol/:id/contrasena | `{ Contrasena }` · `:rol` = cajero, barbero o dueno |
| DELETE | /cuentas/:rol/:id | Baja lógica (libera el usuario). Barbero con citas próximas → 409 |

## Catálogos
| Método | Ruta | Roles | Cuerpo |
|---|---|---|---|
| GET | /servicios | todos | Activos |
| POST · PUT /:id | /servicios | D | `{ NombreServicio, Precio, DuracionMin (10–480), DiasDisponibles: 'L,M,X,J,V,S,D'\|null, Descripcion? }` |
| DELETE | /servicios/:id | D | Baja lógica (se quita de los beneficios) |
| GET | /productos | todos | Con `Stock` y `Categoria` |
| POST | /productos | D | `{ NombreProducto, Categoria?, Precio, Stock, Descripcion? }` |
| PUT | /productos/:id | D | `{ NombreProducto, Categoria?, Precio, Descripcion? }` |
| DELETE | /productos/:id | D | Baja lógica (se quita de los beneficios) |
| POST | /productos/:id/entrada | C D | `{ Cantidad, Motivo? }` |
| POST | /productos/:id/baja | C D | `{ Cantidad, Motivo, Contrasena }` (contraseña de la sesión; 403 si no coincide) |
| GET | /productos/:id/movimientos | C D | Bitácora: Alta, Entrada, Baja, Venta |
| GET | /membresias | todos | Con `Beneficios[]` en el orden del plan |
| POST · PUT /:id | /membresias | D | `{ NombrePlan, Precio, DuracionMeses, Descripcion?, Beneficios: [Beneficio] }` (máx. 30) |
| DELETE | /membresias/:id | D | Baja lógica (los clientes la conservan hasta vencer; si se crea otra activa con el mismo nombre, reciben sus beneficios) |

`Beneficio`:
```json
{ "ID_Beneficio": 7,                 // al editar: se actualiza en su lugar y conserva sus usos del mes
  "Aplica": "Servicio",              // Servicio | Producto | Categoria | Productos (todos) | Texto
  "ID_Servicio": 1, "ID_Producto": null, "Categoria": null,
  "Tipo": "Gratis",                  // Gratis | Descuento ('Productos' solo Descuento)
  "Porcentaje": 100,                 // 1–100 si es Descuento
  "Usos": 1, "Periodo": "Visita",    // Usos null = ilimitado · Periodo Visita (por día) | Mes
  "Etiqueta": "Cortes ilimitados" }  // texto del cartel (obligatorio en 'Texto')
```
Se acepta también el formato anterior `{ ID_Servicio, Tipo, Porcentaje, UsosPorMes }`
y `DescuentoProductos` (se convierte en un beneficio «Todos los productos»).

## Clientes
| Método | Ruta | Roles | Descripción |
|---|---|---|---|
| GET | /clientes?buscar=&filtro=&limite= | todos | `buscar`: nombre o teléfono · `filtro`: recientes, primeros, membresia. Incluye `MembresiaActiva` |
| GET | /clientes/:id | todos | Ficha + `Asistencias, Faltas, Canceladas, Puntualidad (%), FaltasConsecutivas, Visitas, UltimaVisita, ProximaCita` |
| POST | /clientes | todos | `{ Nombre, Lada, Telefono, Descripcion?, Observaciones?, foto?: dataURL }` (siempre sin membresía) |
| PUT | /clientes/:id | C D | Datos de contacto y estilo |
| GET | /clientes/:id/servicios | todos | Historial cobrado |
| GET | /clientes/:id/pendientes | C D | Citas atendidas sin cobrar |
| GET | /clientes/:id/membresia | todos | Membresía que aplica hoy `{ ID_Membresia, NombrePlan, VenceActual, Beneficios[] }` o `null` |
| GET · POST | /clientes/:id/fotos | todos | POST `{ foto: dataURL (JPG/PNG/WEBP ≤ 8 MB), Titulo?, Notas?, Referencia? }` |
| DELETE | /clientes/:id/fotos/:idFoto | todos | Elimina la foto |
| PUT | /clientes/:id/foto-referencia | todos | `{ ID_Foto }` |
| DELETE | /clientes/:id/foto-referencia | todos | Elimina la foto principal |

## Barberos y avisos
| Método | Ruta | Roles | Descripción |
|---|---|---|---|
| GET | /barberos | todos | Activos con jornada |
| GET | /barberos/yo | B | Barbero con sesión |
| PUT | /barberos/:id/horario | D | `{ HoraEntrada, HoraSalida, ComidaInicio?, ComidaFin?, DiasTrabajo, RolesActividades }` (genera aviso) |
| GET | /barberos/:id/ingresos?dias=7 | D | Servicios e ingreso por día |
| GET | /avisos | B | No leídos |
| POST | /avisos/leidos | B | Marca todos como leídos |

## Citas
| Método | Ruta | Roles | Descripción |
|---|---|---|---|
| GET | /citas?fecha=&barbero= | C D | Citas del día |
| GET | /citas/mias?fecha= | B | Agenda propia |
| GET | /citas/proxima | B | En atención o siguiente de hoy |
| GET | /citas/dias?barbero=&desde=&dias=7&servicio= | todos | `[{ Fecha, Estado: Libre\|Ocupado\|NoDisponible, Motivo, Libres }]` |
| GET | /citas/disponibilidad?barbero=&fecha=&servicio= | todos | `{ Estado, Motivo, Libres, DuracionMin, Bloques: [{ Hora, Estado: Libre\|Ocupado\|NoDisponible, Cabe, Motivo ('Comida', 'Hora pasada'), NombreCliente?, NombreServicio? }] }` |
| POST | /citas | todos | `{ ID_Cliente, ID_Barbero, ID_Servicio, FechaHora }` → cita + `WhatsApp: { Enviado, Configurado, Enlace, Error? }` |
| PATCH | /citas/:id/estado | todos | `{ Estado }` · Agendada → EnEspera\|EnAtencion\|Cancelada\|NoAsistio · EnEspera → EnAtencion\|Cancelada\|NoAsistio · EnAtencion → Atendida |
| POST | /citas/:id/enviar | todos | Reenvía la confirmación |

## Ventas
| Método | Ruta | Roles | Descripción |
|---|---|---|---|
| POST | /ventas/calcular | C D | `{ ID_Cliente\|null, Detalle }` → `{ Lineas, Subtotal, Descuento, Total, Membresia }` |
| POST | /ventas | C D | `{ ID_Cliente\|null, MetodoPago, MontoRecibido?, TotalEsperado, Detalle }` → venta (409 si el total cambió) |
| GET | /ventas?desde=&hasta=&concepto=&buscar=&pagina=&tamano= | C D | `{ registros, total, pagina, resumen }` · `buscar=Cliente 0` filtra ventas sin cliente |
| GET | /ventas/:id | C D | Venta completa con `Detalle` y `Establecimiento` |
| POST | /ventas/:id/enviar | C D | `{ canal: 'whatsapp'\|'sms', Telefono? }` → `{ Enviado, Enlace }` |

`Detalle` (conceptos):
```json
[
  { "TipoItem": "Servicio",  "ID_Servicio": 1, "ID_Barbero": 2, "Cantidad": 1 },
  { "TipoItem": "Servicio",  "ID_Cita": 15 },
  { "TipoItem": "Producto",  "ID_Producto": 3, "Cantidad": 2 },
  { "TipoItem": "Membresía", "ID_Membresia": 1 }
]
```
Reglas: una membresía por venta (no a Cliente 0); si se compra en la misma
venta sus beneficios aplican; vencimiento = vencimiento vigente + duración o,
si no hay vigente, hoy + duración. Sin IVA. Folio `T-AAAA-000001`.

Cada renglón de `Lineas` trae `Indice` (posición del concepto en `Detalle`),
`Descuento`, `Importe`, `Beneficio` (texto, ej. «Supremo · Corte para amigo:
gratis (uso 1 de 1 del mes)»), `UsaBeneficio` e `ID_Beneficio`. Un producto
que usa dos beneficios se divide en dos renglones con el mismo `Indice`
(ej. 3 bebidas → 2 gratis + 1 con 20 %). Por pieza se elige el beneficio que
más descuenta; a igual descuento: ilimitado → por visita → por mes.

## Cierre de caja (C D)
| Método | Ruta | Descripción |
|---|---|---|
| GET | /cierres/resumen | Ventas y reembolsos sin corte: `NumeroVentas, VentasBrutas, Descuentos, TotalIngresos, NumeroReembolsos, TotalReembolsos, IngresoNeto, PorMetodo, Operaciones, ReembolsosPorMetodo, PorTipo, PorBarbero, PorCajero, ProductosVendidos, TicketPromedio, FondoInicial, EfectivoEsperado, Desde, Hasta, Responsable, Denominaciones[], Ventas[], Reembolsos[]` |
| POST | /cierres | `{ EfectivoContado, Arqueo?: { "500": 2, "0.5": 4 }, Observaciones? }` → corte completo con `Diferencia` |
| GET | /cierres?limite=10 | Cortes anteriores |
| GET | /cierres/:id | Un corte con `Ventas[]` y totales (para exportar a CSV) |

## Archivos
`GET /uploads/clientes/<id>/<archivo>` sirve las fotos de los clientes.
