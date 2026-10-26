# Engreídos Barbershop · Front end web

Interfaz web del sistema de citas, cobro y cierre de caja de **Engreídos Barbershop**
(Proyecto de Ingeniería de Software, ITS Xalapa).

Es **solo el front end**: HTML, CSS y JavaScript sin frameworks ni compilación.
Todas las pantallas están listas para conectarse a un back end en **Node.js (JavaScript) + MySQL**
a través de una API REST documentada en [`docs/API.md`](docs/API.md).

---

## Contenido

1. [Cómo abrirlo](#cómo-abrirlo)
2. [Estructura de carpetas](#estructura-de-carpetas)
3. [Pantallas y permisos](#pantallas-y-permisos)
4. [Encabezado común](#encabezado-común)
5. [Conectar el back end](#conectar-el-back-end)
6. [Convenciones del código](#convenciones-del-código)
7. [Agregar una pantalla nueva](#agregar-una-pantalla-nueva)
8. [Compilar estilos para producción](#compilar-estilos-para-producción)

---

## Cómo abrirlo

**Opción rápida:** abrir `index.html` con doble clic (Chrome, Edge o Firefox).

**Recomendado** (igual que en un servidor real): servir la carpeta con un servidor local.

```bash
# Con Node.js
npx serve .
# o con Python
python -m http.server 8080
```
y abrir `http://localhost:8080`.

Se necesita internet para las tipografías, los íconos y Tailwind CSS (CDN).

### Modo sin servidor (desarrollo)

Mientras `USAR_BACKEND` sea `false` en `assets/js/config.js`, la aplicación funciona **sin back end**:
se puede iniciar sesión y navegar por todas las pantallas, pero **no hay datos**: cada pantalla muestra su
estado vacío y los guardados avisan «Modo sin servidor: la información no se guardó».
La suspensión del servicio sí se conserva en el navegador para poder probar la pantalla de mantenimiento.

Usuarios de prueba (solo existen en este modo, en `assets/js/api-sin-servidor.js`):

| Usuario   | Contraseña | Rol     |
|-----------|-----------|---------|
| `cajero`  | `123`     | Cajero  |
| `dueño`   | `123`     | Dueño   |
| `barbero` | `123`     | Barbero |

---

## Estructura de carpetas

```
engreidos-web/
├── index.html                  Inicio de sesión
├── panel.html                  Panel principal (uno solo; los mosaicos cambian según el rol)
├── agendar-cita.html           Agendar cita
├── registrar-cobro.html        Punto de venta
├── ticket-digital.html         Ticket de la venta (?venta=ID)
├── nuevo-cliente.html          Alta de cliente
├── perfil-cliente.html         Ficha del cliente, vista tableta (?cliente=ID)
├── cierre-caja.html            Corte de caja y arqueo
├── historial-ventas.html       Consulta y exportación de ventas
├── personal-horarios.html      Jornadas de los barberos (Dueño)
├── suspender-servicio.html     Suspender / reanudar el sistema (Dueño)
├── mantenimiento.html          Aviso mientras el servicio está suspendido
├── barbero-mis-citas.html      Agenda del barbero (móvil)
├── barbero-perfil-cliente.html Ficha del cliente, vista móvil
├── barbero-mi-horario.html     Horario del barbero (móvil, solo lectura)
│
├── assets/
│   ├── css/comun.css           Sistema de diseño: variables, encabezado y componentes
│   ├── img/                    Imágenes de la interfaz
│   └── js/
│       ├── config.js           ★ Configuración (URL de la API, modo sin servidor)
│       ├── tailwind.config.js  Configuración compartida de Tailwind
│       ├── utilidades.js       Formatos, plantillas, avisos y ayudas generales
│       ├── sesion.js           Sesión, roles, permisos y navegación
│       ├── api.js              ★ Cliente de la API REST (único punto de acceso a datos)
│       ├── api-sin-servidor.js Respuestas vacías para trabajar sin back end
│       ├── componentes/
│       │   ├── encabezado-app.js     <encabezado-app>
│       │   └── navegacion-barbero.js <navegacion-barbero>
│       └── paginas/            Un controlador por pantalla
│
└── docs/
    ├── API.md                  ★ Contrato de la API (endpoints, JSON, errores)
    └── esquema.sql             ★ Base de datos MySQL lista para crear
```

---

## Pantallas y permisos

Los permisos están en `PERMISOS` dentro de `assets/js/sesion.js`. Si un rol abre una pantalla que no le
corresponde, regresa al panel. **El back end debe validar lo mismo en cada endpoint.**

| Pantalla | Cajero | Dueño | Barbero |
|---|:-:|:-:|:-:|
| Panel principal, Agendar cita, Nuevo cliente | ✔ | ✔ | ✔ |
| Registrar cobro, Ticket digital, Perfil del cliente (tableta), Cierre de caja, Historial de ventas | ✔ | ✔ | |
| Personal y horarios, Suspender servicio | | ✔ | |
| Mis citas, Perfil del cliente (móvil), Mi horario | | | ✔ |

Con el servicio **suspendido**, Cajero y Barbero solo ven `mantenimiento.html`; el Dueño sigue operando
para poder reanudarlo.

---

## Encabezado común

Todas las pantallas con sesión usan el mismo componente, definido una sola vez en
`assets/js/componentes/encabezado-app.js`:

```html
<!-- Panel principal -->
<encabezado-app variante="panel"></encabezado-app>

<!-- Cualquier módulo -->
<encabezado-app variante="modulo"></encabezado-app>
```

| Elemento | Panel | Módulos |
|---|:-:|:-:|
| Menú de tres líneas (☰) — reservado para ajustes futuros | ✔ | |
| Flecha para regresar al panel principal | | ✔ |
| Logotipo `[ Engreídos ] BARBERSHOP` (lleva al panel) | ✔ | ✔ |
| Punto «En línea» | ✔ | ✔ |
| Rol del usuario | ✔ | ✔ |
| Botón «Cerrar sesión» | ✔ | ✔ |

El menú (☰) emite el evento `encabezado:menu`. Para conectar los ajustes cuando existan:

```js
document.addEventListener('encabezado:menu', function (evento) {
  evento.preventDefault();   // evita el aviso «próximamente»
  abrirAjustes();            // tu implementación
});
```

---

## Conectar el back end

1. **Crear la base de datos** con [`docs/esquema.sql`](docs/esquema.sql)
   (`mysql -u root -p < docs/esquema.sql`). Contiene las 8 tablas del modelo relacional del
   documento, más `ESTABLECIMIENTO`, `ADMINISTRADOR` y las tablas/columnas sugeridas que el front end ya usa.
2. **Implementar la API** (por ejemplo, Express + `mysql2` + `jsonwebtoken` + `bcrypt`) siguiendo
   [`docs/API.md`](docs/API.md). Los nombres de los campos JSON son los de las columnas de MySQL.
3. **Habilitar CORS** para el origen donde se publique el front end.
4. **Editar `assets/js/config.js`:**
   ```js
   API_URL: 'http://localhost:3000/api',   // dirección real del servidor
   USAR_BACKEND: true,
   ```
5. Opcional: quitar `assets/js/api-sin-servidor.js` y su `<script>` de cada página.

No hace falta tocar las pantallas: todas obtienen y envían datos únicamente a través de `api.js`.

---

## Convenciones del código

- **Idioma:** nombres, comentarios y textos en español, igual que el documento del proyecto.
- **Comentarios:** cada HTML inicia con un bloque que describe la pantalla, sus parámetros y endpoints;
  cada JS usa JSDoc (`@file`, `@param`, `@returns`, `@typedef`).
- **CSS:** clases BEM en español (`tarjeta__titulo`, `boton--primario`) en `comun.css`;
  Tailwind solo para distribución (`grid`, `flex`, `gap-4`, `lg:col-span-7`).
- **Sin datos fijos en el HTML:** todo lo que viene de la base de datos se dibuja desde la API.

### Navegación declarativa (`data-nav`)

```html
<button data-nav="registrar-cobro.html">…</button>       <!-- abre una pantalla -->
<a data-nav="@panel">…</a>                                <!-- panel principal -->
<button data-nav="@perfil?cliente=7">…</button>           <!-- perfil (tableta o móvil según el rol) -->
<button data-nav="@logout">…</button>                     <!-- cierra sesión -->
```

### Plantillas y llenado de datos

Las listas se dibujan con `<template>` y atributos `data-campo`; los valores se insertan como texto
(nunca como HTML) para evitar XSS.

```html
<template id="plantilla-venta">
  <tr>
    <td data-campo="NumeroFactura"></td>
    <td data-campo="NombreCliente" data-vacio="Público en general"></td>
    <td data-campo="ImporteTotal" data-formato="moneda"></td>
  </tr>
</template>
```
```js
Utilidades.dibujarLista({
  contenedor: document.getElementById('ventas-filas'),
  plantilla: 'plantilla-venta',
  datos: ventas,                       // respuesta de la API
  vacio: document.getElementById('ventas-vacio')
});
```

Formatos disponibles en `data-formato`: `moneda`, `fecha`, `fechaLarga`, `hora`, `telefono`,
`iniciales`, `mayusculas`. Otros atributos: `data-campo-src` (imagen), `data-campo-valor` (value),
`data-campo-id` (data-id).

---

## Agregar una pantalla nueva

1. Copiar la estructura de una pantalla existente (bloque de comentario, `<head>` y scripts).
2. Usar `<encabezado-app variante="modulo">` como primer elemento del `<body>`.
3. Registrar el archivo y sus roles en `PERMISOS` (`assets/js/sesion.js`).
4. Agregar los endpoints que necesite en `assets/js/api.js` y documentarlos en `docs/API.md`.
5. Crear su controlador en `assets/js/paginas/` iniciando con
   `if (!window.Sesion.permitida) return;`.
6. Agregar el mosaico en `panel.html` con `data-roles` y `data-nav`.

---

## Compilar estilos para producción

El CDN de Tailwind es cómodo para desarrollar, pero en producción conviene generar un CSS estático:

```bash
npm install -D tailwindcss@3.4.17
```

`tailwind.config.cjs`:
```js
const tailwind = {};
eval(require('fs').readFileSync('./assets/js/tailwind.config.js', 'utf8'));
module.exports = { ...tailwind.config, content: ['./*.html', './assets/js/**/*.js'] };
```

```bash
echo "@tailwind base; @tailwind components; @tailwind utilities;" > tailwind.entrada.css
npx tailwindcss -c tailwind.config.cjs -i tailwind.entrada.css -o assets/css/tailwind.css --minify
```

Después, en cada HTML, reemplazar las dos líneas del CDN y `tailwind.config.js` por
`<link rel="stylesheet" href="assets/css/tailwind.css">` (antes de `comun.css`).
