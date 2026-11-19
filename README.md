# Engreídos Barbershop · Sistema de citas, caja y clientes (v3.4)

Sistema completo para la barbería: **front end** (pantallas web y app de
Android), **back end** (Node.js, sin paquetes externos) y **base de datos**
(MySQL 8).

```
engreidos-web/
├── iniciar-servidor.bat    ← Doble clic en Windows para encender el sistema
├── iniciar-servidor.sh     Lo mismo en macOS / Linux (sh iniciar-servidor.sh)
├── *.html                  Pantallas (se abren desde el servidor o desde la app)
├── assets/                 Estilos, imágenes, lógica de pantallas e idiomas
├── servidor/               Back end Node.js (API REST + archivos de la web)
├── base-de-datos/          esquema.sql (la base se crea sola al primer arranque)
├── herramientas/           Fuentes de estilos (Tailwind) y traducciones
└── docs/API.md             Referencia de la API
```

> **Importante:** el sistema necesita que el servidor esté encendido. Abrir
> `index.html` con doble clic o con «Live Server» de VS Code no basta por sí
> solo: primero enciende el servidor (paso 1.2) y luego entra a
> **http://localhost:3000**.

---

## 1. Instalación en la computadora de la barbería

La computadora (Windows, macOS o Linux) funciona como **servidor**: guarda la
base de datos y las fotos. Los teléfonos y tabletas se conectan a ella por la
red Wi-Fi del local.

### 1.1 Requisitos (solo dos programas)
| Programa | Versión | Descarga |
|---|---|---|
| Node.js | 18 o superior (LTS) | https://nodejs.org |
| MySQL Server | 8.0 o superior | https://dev.mysql.com/downloads/installer/ |

Durante la instalación de MySQL anota la **contraseña del usuario `root`**.
No hace falta `npm install`: el servidor no usa paquetes externos.

### 1.2 Encender el sistema
1. Descomprime `engreidos-web` (por ejemplo en `C:\engreidos-web`).
2. Doble clic en **`iniciar-servidor.bat`**.
3. **Solo la primera vez** aparece el asistente. Responde con Enter para
   aceptar lo que está entre corchetes y escribe la contraseña de MySQL:
   ```
   Servidor de MySQL [localhost]:
   Puerto de MySQL [3306]:
   Usuario de MySQL [root]:
   Contraseña de MySQL: ********
   ✔ Conexión correcta con MySQL 8.0.x
   Puerto del sistema (navegador y app) [3000]:
   ✔ Configuración guardada en servidor/.env
   ✔ Base de datos «engreidos» creada con todas sus tablas.
   ```
4. El servidor queda encendido y muestra:
   ```
   ✔ Engreídos Barbershop está funcionando
     En esta computadora:  http://localhost:3000
     Desde el teléfono o la app (misma red Wi-Fi):  http://192.168.1.70:3000
   ```
   **No cierres esa ventana** mientras uses el sistema.
5. Abre **http://localhost:3000** en el navegador. La primera vez aparece
   «Configuración inicial»: crea la **cuenta del Dueño** (nombre, usuario y
   contraseña) y entras directo al panel.

Si la contraseña de MySQL está mal, el `.bat` vuelve a abrir el asistente.
Si MySQL está apagado: Windows → «Servicios» (services.msc) → inicia
**MySQL80**.

Windows puede preguntar si permite a Node.js usar la red: elige **Redes
privadas → Permitir** (si no, los teléfonos no podrán conectarse). Para que la
IP de la computadora no cambie, reserva una IP fija en el módem («DHCP
estático»).

Sin el `.bat` (terminal): `cd servidor`, `node scripts/configurar.js` (solo la
primera vez) y `npm start`.

### 1.4 Primer uso (como dueño)
Entra con la cuenta del dueño y toca **☰** (panel «Ajustes del sistema»):
1. **Servicios**: nombre, precio, duración y (opcional) días en que existe.
2. **Productos e inventario**: nombre, **categoría** (ej. *Bebida*), precio y
   cantidad inicial.
3. **Membresías**: nombre, precio, duración y la lista de **beneficios** tal
   como aparecen en tu cartel (ver 1.5).
4. **Cuentas**: crea cajeros y barberos (usuario y contraseña).
5. **Datos del negocio**: eslogan, dirección, teléfono, redes y fondo de caja.
6. **Impresora** y **WhatsApp** (secciones 3 y 4).
7. En **Personal y horarios** ajusta jornada, comida y días de cada barbero.

### 1.4.1 Exportar a Excel (CSV)
- **Historial de ventas → Exportar CSV**: todas las ventas del filtro, con
  *Fecha* y *Hora* en columnas separadas y un renglón de totales.
- **Cierre de caja**: *Exportar resumen (CSV)* antes de cerrar, *Exportar CSV*
  al terminar el corte, el botón **CSV** de cada corte anterior y *Exportar
  CSV* con la lista de cortes. (Ya no se imprime desde estas pantallas.)
- En la **app de Android** el archivo se guarda en *Descargas/Engreidos* y
  la app ofrece compartirlo por WhatsApp, correo o Drive.
- La fecha va como texto corto (`06/11/26`) para que Excel no muestre `#####`.

### 1.5 Beneficios de las membresías
Cada beneficio tiene: **texto del cartel** (lo que ve el cliente), **a qué
aplica** (un servicio, un producto, una categoría de productos, todos los
productos o *solo texto*), **gratis o descuento %** y **límite** (ilimitado,
N por visita o N por mes). Se ordenan con ↑ ↓ y cada fila muestra la regla
que aplicará la caja. Ejemplo de los carteles:

| Cartel | Aplica a | Beneficio | Límite |
|---|---|---|---|
| Cortes ilimitados | Corte | Gratis | Ilimitado (o *1 por visita* si el plan tiene «Corte para amigo») |
| 1 bebida por visita / 2 bebidas | Categoría «Bebida» | Gratis | 1 (o 2) por visita |
| 10 % / 15 % / 20 % en productos | Todos los productos | Descuento 10/15/20 % | Ilimitado |
| Barba 2 veces al mes | Barba | Gratis | 2 por mes |
| Barba ilimitada | Barba | Gratis | Ilimitado |
| Ritual Facial Engreído (mensual) | Ritual Facial | Gratis | 1 por mes |
| Corte para amigo | Corte | Gratis | 1 por mes |
| Acceso a promociones exclusivas · Pase preferente · Acceso preferente limitado | Solo texto | — | — |

Para cambiar los beneficios de un plan usa **Editar** (no lo elimines y lo
vuelvas a crear). Si ya lo hiciste, no pasa nada: los clientes del plan
eliminado reciben los beneficios del plan activo con el mismo nombre. No se
permiten dos membresías, servicios o productos activos con el mismo nombre.
Al elegir al cliente en caja se muestran sus beneficios y su foto de corte.

En caja, cada pieza usa el beneficio que más descuenta; a igual descuento,
primero el ilimitado, luego el *por visita* y al final el *por mes*. Si un
producto usa dos beneficios (3 bebidas: 2 gratis + 1 con 20 %) se ve en dos
renglones. «Por visita» se cuenta por día; «por mes», por el periodo de la
membresía.

---

## 2. App de Android

Instala `Engreidos-Barbershop-v2.5.apk` (permite «instalar apps de origen
desconocido»; se instala encima de la versión anterior). Con el servidor
encendido y el teléfono en **la misma red Wi-Fi** que la computadora:

1. Abre la app y toca **Buscar el servidor en la red Wi-Fi** (lo encuentra
   solo), o escribe la dirección que muestra la ventana del servidor
   (ej. `192.168.1.70:3000`) y toca **Probar y guardar**.
2. Inicia sesión.

La dirección se puede cambiar después en **Ajustes → Servidor** o en el botón
**Cambiar** de la pantalla de inicio de sesión.

La app agrega funciones del teléfono: cámara y galería para las fotos, impresión
directa por Bluetooth y apertura de WhatsApp/SMS.

> iPhone: no usa el APK; abre la dirección del servidor en Safari y elige
> «Compartir → Agregar a pantalla de inicio».

---

## 3. Impresora térmica de 58 mm (Bluetooth / USB)

Probada con impresoras ESC/POS de 58 mm (32 caracteres por renglón), como la
«Impresora Bluetooth-58MM» con USB y Bluetooth.

| Dónde | Conexión | Cómo configurarla (Ajustes → Impresora) |
|---|---|---|
| App de Android | Bluetooth | Vincula la impresora en el teléfono (PIN 0000 o 1234) → «Bluetooth (app de Android)» → **Buscar vinculadas** → elígela |
| Computadora | USB o Bluetooth | Instala el controlador → «Impresora del sistema» (diálogo de impresión con formato de 58 mm) |
| Chrome/Edge en PC | USB/Bluetooth como puerto COM | «USB / Bluetooth directo» (envía ESC/POS sin diálogo) |

En la app de Android (v2.5): **Abrir Bluetooth del teléfono** lleva a vincular
la impresora, **Buscar vinculadas** la lista y **Probar conexión** dice si
responde, sin gastar papel. La app intenta las tres formas de conexión que usan
estas impresoras y reintenta una vez antes de avisar.

Si no conecta: apágala y enciéndela, revisa que no esté conectada a otro
teléfono o computadora (solo acepta uno a la vez), acércala y, si sigue igual,
elige «Olvidar» en el Bluetooth del teléfono y vuelve a vincularla.

En «USB / Bluetooth directo» elige el puerto con **Elegir puerto**; si la
prueba imprime símbolos raros cambia la **velocidad** (9600 es la más común).

Usa **Imprimir prueba** para comprobar acentos y ñ. Desde el ticket digital
el botón **Imprimir ticket físico** usa la impresora configurada en ese equipo.

---

## 4. WhatsApp (confirmación de citas y tickets)

Sin configurar, el sistema **abre WhatsApp con el mensaje ya escrito** para
enviarlo con un toque. Para el envío **automático** se usa la API oficial de
Meta (WhatsApp Cloud API):

1. En https://developers.facebook.com crea una app tipo **Empresa** y agrega
   el producto **WhatsApp**.
2. Registra el número del negocio y copia su **Phone number ID**.
3. En Business Manager crea un **usuario del sistema** y genera un **token
   permanente** con el permiso `whatsapp_business_messaging`.
4. Para escribir a clientes que no te han escrito en las últimas 24 h, Meta
   exige una **plantilla aprobada**. Crea una (ej. `confirmacion_cita`,
   idioma `es_MX`) con 6 variables:
   `{{1}}` cliente · `{{2}}` fecha · `{{3}}` hora · `{{4}}` servicio ·
   `{{5}}` duración · `{{6}}` barbero.
5. En **Ajustes → WhatsApp** pega el Phone number ID, el token y el nombre de
   la plantilla, activa el envío y usa **Probar**.

Los tickets se envían como texto (WhatsApp) o abren la app de mensajes (SMS).

**Probar conexión** comprueba el identificador y el token sin enviar mensajes
y, si Meta los rechaza, explica el motivo en español (token vencido,
identificador equivocado, cuenta en modo de prueba, etc.).

### 4.1 Bot que responde a los clientes

El bot contesta solo cuando un cliente escribe al número del negocio y
pregunta por **servicios, productos, membresías, descuentos, horario
(«¿a qué hora cierran?»), dirección, teléfono o cómo agendar**. Si no
entiende, manda un menú numerado. No inventa nada: los precios y promociones
salen de los catálogos, y el horario, la dirección, el mapa, el teléfono y la
forma de agendar se editan en **Ajustes → Datos del negocio**.

Se puede probar sin conectar nada en **Ajustes → WhatsApp → Probar el bot
aquí**. Para que conteste en WhatsApp de verdad:

1. Conecta la API (pasos de arriba) y verifica con **Probar conexión**.
2. Meta necesita una dirección **https pública** para avisar de cada mensaje.
   Lo más sencillo es un túnel gratuito en la computadora del servidor:
   instala `cloudflared` y ejecuta
   `cloudflared tunnel --url http://localhost:3000`. Pega la dirección que te
   da en «Dirección pública del servidor».
3. En developers.facebook.com → tu app → WhatsApp → Configuración → Webhook
   pega la **URL de devolución de llamada** y el **Token de verificación**
   que muestra el sistema y toca «Verificar y guardar». Suscríbete al campo
   `messages`.
4. (Recomendado) Pega la **Clave secreta de la app** para que solo se acepten
   mensajes firmados por Meta.
5. Enciende **Responder automáticamente** y guarda.

La computadora del servidor y el túnel deben estar encendidos para que el bot
conteste. El túnel gratuito cambia de dirección cada vez que se reinicia (hay
que actualizarla en Meta); para una dirección fija usa un túnel con dominio
propio. En «Mensajes recientes» se ve lo que escribieron los clientes y lo que
contestó el bot.

---

## 4.5 Descuentos, reembolsos y cierre de caja (v3.4)

**Descuentos (Ajustes → Descuentos, solo el dueño).** Cada descuento tiene
nombre, descripción, la **sección** a la que aplica (toda la venta, servicios,
productos o membresías; o un servicio, producto, categoría o plan en
particular), porcentaje o cantidad en pesos por pieza y, si se quiere, fechas
de inicio y término. Se puede poner en pausa. En caja se aplica solo y el
ticket dice qué descuento fue. Si el cliente tiene membresía y el concepto
también tiene promoción, se aplica **el que más le conviene** (no se suman).

**Reembolsos (panel → Reembolsos, cajero y dueño).** Se busca el ticket, se
marcan los conceptos y piezas a devolver, se escribe el motivo, cómo se
devuelve el dinero y si los productos regresan al inventario; se autoriza con
la contraseña de quien lo hace. Se devuelve lo que el cliente pagó en realidad
(ya con descuentos). Reembolsar una membresía la desactiva. Hay historial por
fechas y exportación a CSV.

**Cierre de caja.** Incluye ventas brutas, descuentos, total cobrado,
reembolsos e ingreso neto; cobrado y reembolsado por método de pago; ventas
por tipo, por barbero, por cajero y productos vendidos; fondo inicial y
**efectivo esperado = fondo + ventas en efectivo − reembolsos en efectivo**;
arqueo (se puede contar por billetes y monedas), diferencia y observaciones.
Todo sale en el CSV del corte. El historial de ventas muestra los mismos
totales por periodo.

**Actualización automática entre equipos.** Cuando alguien agenda, cancela o
cobra desde otro equipo, las pantallas abiertas (citas del barbero, panel,
agenda, caja, cierre e historial) se actualizan solas en unos 3 segundos, sin
recargar.

---

## 5. Reglas del negocio implementadas

- **Clientes**: nombre y teléfono (10 dígitos, único) obligatorios; estilo,
  observaciones y foto opcionales. Todo cliente nuevo inicia **sin
  membresía**; solo se activa al cobrarla en caja.
- **Cliente 0**: venta sin datos del cliente (aparece así en el ticket). No
  puede comprar membresías.
- **Agenda**: bloques de 30 min; un día se marca *Libre*, *Ocupado* o *No
  disponible* (descanso, servicio que no existe ese día o fecha pasada). Se
  muestran horarios libres, ocupados y de comida. Al confirmar se envía el
  resumen por WhatsApp (hora AM/PM, fecha, duración, barbero y cliente).
- **Cita atendida**: cuando el barbero la finaliza queda **pendiente de pago**;
  al buscar al cliente en caja se agrega sola con un «?» rojo.
- **Membresía**: si se compra en la misma venta sus beneficios aplican de
  inmediato. Vencimiento: pagada el 05/11/2026 → vence 05/12/2026; renovada
  antes de vencer suma un mes a la fecha de vencimiento (05/01/2027); vencida,
  cuenta desde el día del pago. Los beneficios se configuran por plan
  (servicio, producto, categoría, todos los productos o solo texto; gratis o
  descuento; ilimitados, por visita o por mes — ver 1.5). Editar un plan
  conserva los usos ya hechos en el mes.
- **Precios**: el servidor calcula subtotal, descuentos y total (sin IVA) y
  vuelve a verificarlos al cobrar.
- **Inventario**: la venta descuenta existencias; las bajas piden la
  contraseña del dueño o cajero con sesión; todo queda en la bitácora.
- **Cierre de caja**: incluye todas las ventas desde el último corte (cajero
  y dueño), con arqueo contra el efectivo esperado (fondo + efectivo).
- **Suspender servicio**: el dueño bloquea caja, agenda y WhatsApp; cajeros y
  barberos ven la pantalla de mantenimiento.
- **Idiomas**: español (predeterminado), inglés e italiano (Ajustes → Idioma).

> Nota: el documento de diseño (Parte III) contempla una columna de IVA; por
> indicación del negocio el sistema **no desglosa IVA** en tickets ni cortes.

---

## 6. Mantenimiento

**Respaldo** de la base de datos (recomendado diario):
```bash
mysqldump -u root -p engreidos > respaldo-engreidos-AAAA-MM-DD.sql
```
Guarda también la carpeta `servidor/uploads/` (fotos de clientes).

**Restaurar**: `mysql -u root -p engreidos < respaldo-engreidos-AAAA-MM-DD.sql`

**Iniciar con Windows**: copia un acceso directo de `iniciar-servidor.bat` en
la carpeta `shell:startup` (Win + R → `shell:startup`), o usa un
administrador de procesos como `pm2`.

**Olvidé la contraseña del dueño**: en la carpeta `servidor` ejecuta
`node scripts/crear-dueno.js dueno NuevaContraseña` (restablece la contraseña).

**Cambiar los datos de MySQL**: borra `servidor/.env` y vuelve a abrir
`iniciar-servidor.bat` (o ejecuta `node scripts/configurar.js`).

**Actualizar a una versión nueva**: cierra la ventana del servidor, copia los
archivos nuevos encima de los anteriores **conservando** `servidor/.env` y
`servidor/uploads/`, y vuelve a abrir `iniciar-servidor.bat`. La base de datos
se actualiza sola al arrancar, sin perder clientes, ventas ni membresías
(«✔ Base de datos … actualizada a la versión 3.4»).

---

## 7. Para desarrolladores

### Estructura
```
assets/
├── css/comun.css            Sistema de diseño (variables, componentes, BEM en español)
├── css/tailwind.css         Utilidades de Tailwind compiladas (no editar a mano)
├── img/                     Logotipo e íconos
└── js/
    ├── config.js            Configuración y dirección del servidor
    ├── idioma.js            Traducción (Idioma.t y traducción automática del DOM)
    ├── idiomas/en.js, it.js Diccionarios (generados)
    ├── utilidades.js        Formatos, plantillas, avisos, fotos
    ├── sesion.js            Sesión, permisos por pantalla y navegación (data-nav)
    ├── api.js               Cliente de la API REST
    ├── impresora.js         Tickets ESC/POS de 58 mm (Bluetooth, USB, sistema)
    ├── componentes/         <encabezado-app>, <menu-ajustes>, <buscador-cliente>, <logo-engreidos>…
    └── paginas/             Un controlador por pantalla
servidor/src/
├── index.js / app.js        Arranque y rutas
├── db.js                    Pool MySQL e instalación automática del esquema
├── lib/mysql.js             Cliente MySQL 8 propio (TLS, caching_sha2_password)
├── lib/web.js               Mini marco web (rutas, JSON, archivos estáticos)
├── middleware/              Sesión (JWT), roles, suspensión, errores
├── rutas/                   auth, clientes, citas, ventas, cierres, catálogos…
├── servicios/               precios, disponibilidad, whatsapp, fotos, validación
└── seguridad/               contraseñas (scrypt) y tokens (JWT HS256)
```

### Pantallas y permisos
| Pantalla | Dueño | Cajero | Barbero |
|---|:-:|:-:|:-:|
| panel, agendar-cita, nuevo-cliente, ajustes | ✔ | ✔ | ✔ |
| registrar-cobro, ticket-digital, perfil-cliente, cierre-caja, historial-ventas | ✔ | ✔ | |
| personal-horarios, suspender-servicio | ✔ | | |
| barbero-mis-citas, barbero-mi-horario, barbero-perfil-cliente | | | ✔ |

El servidor valida los mismos permisos en cada petición (ver `docs/API.md`).

### Convenciones
- Navegación declarativa: `<button data-nav="registrar-cobro.html">`, alias
  `@panel`, `@perfil`, `@logout`.
- Plantillas: `<template>` + `data-campo`, `data-formato`, `data-campo-src`,
  `data-traducir`, llenadas con `Utilidades.llenar()` (siempre como texto).
- Textos en español en el HTML y en `Idioma.t('…')`; los datos (`data-campo`,
  `translate="no"`) no se traducen.

### Estilos (Tailwind)
Después de usar clases de Tailwind nuevas en el HTML o JS:
```bash
cd servidor && npm run estilos
```
(Configuración en `herramientas/estilos/tailwind.config.cjs`.)

### Traducciones
Agrega o corrige textos en `herramientas/idiomas/textos.tsv`
(`español<TAB>inglés<TAB>italiano`) y genera los diccionarios:
```bash
cd servidor && npm run idiomas
```
