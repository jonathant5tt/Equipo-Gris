-- =============================================================================
-- Engreídos Barbershop · Base de datos (MySQL 8.0 o superior)
-- -----------------------------------------------------------------------------
-- Versión 3.4 (descuentos, reembolsos, cierre de caja completo y bot de WhatsApp).
-- Una base creada con una versión anterior se actualiza sola al iniciar el servidor.
-- Basada en el modelo relacional de la sección 3.3 del documento
-- del proyecto (CLIENTE, BARBERO, CAJERO, CITA, PRODUCTO, VENTA,
-- DETALLE_VENTA, CIERRE_CAJA) más las tablas que pide la operación real:
--   ESTABLECIMIENTO, ADMINISTRADOR (Dueño), SERVICIO, MEMBRESIA,
--   MEMBRESIA_BENEFICIO, FOTO_CLIENTE, MOVIMIENTO_INVENTARIO, AVISO,
--   MENSAJE_WHATSAPP.
--
-- Cambios respecto al documento:
--   * Sin IVA: el negocio cobra precios finales (se quitaron VENTA.IVA y
--     CIERRE_CAJA.TotalIVA).
--   * «Cliente 0»: una venta sin cliente guarda VENTA.ID_Cliente = NULL.
--   * Las cuentas, servicios, productos y membresías se «eliminan» con
--     Activo = 0 para no perder el historial de ventas que las usa.
--
-- No contiene datos de ejemplo. Solo inserta el registro único de
-- ESTABLECIMIENTO. La cuenta del Dueño se crea con:
--   cd servidor && npm run crear-dueno
--
-- Uso:  mysql -u root -p < base-de-datos/esquema.sql
-- =============================================================================

CREATE DATABASE IF NOT EXISTS engreidos
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE engreidos;

-- -----------------------------------------------------------------------------
-- Configuración del negocio (un solo registro, ID_Local = 1)
-- -----------------------------------------------------------------------------
CREATE TABLE ESTABLECIMIENTO (
  ID_Local                INT AUTO_INCREMENT PRIMARY KEY,
  NombreEstablecimiento   VARCHAR(100) NOT NULL,
  Eslogan                 VARCHAR(120) NULL,                    -- Ej. «Cortes • Barba • Cuidado masculino»
  Direccion               VARCHAR(255) NULL,
  Telefono                VARCHAR(15)  NULL,
  DatosFiscales           VARCHAR(255) NULL,
  MensajeTicket           VARCHAR(255) NULL,                    -- Pie del ticket
  RedesSociales           VARCHAR(120) NULL,                    -- Ej. «@Engreidos Barber Shop»
  LadaPais                VARCHAR(4)   NOT NULL DEFAULT '52',   -- Para WhatsApp (México = 52)
  FondoCaja               DECIMAL(10,2) NOT NULL DEFAULT 0,     -- Efectivo inicial de la caja
  EstadoServicio          ENUM('Activo','Suspendido') NOT NULL DEFAULT 'Activo',
  MensajeMantenimiento    VARCHAR(255) NULL,
  -- API de WhatsApp Cloud (Meta). El token nunca se envía al navegador.
  WhatsAppActivo          BOOLEAN NOT NULL DEFAULT FALSE,
  WhatsAppPhoneId         VARCHAR(40)  NULL,
  WhatsAppToken           VARCHAR(600) NULL,
  WhatsAppPlantillaCita   VARCHAR(100) NULL,                    -- Plantilla aprobada para confirmar citas
  WhatsAppIdiomaPlantilla VARCHAR(10)  NOT NULL DEFAULT 'es_MX',
  -- Información para los clientes (la usa el bot de WhatsApp)
  HorarioAtencion         VARCHAR(600) NULL,                    -- JSON por día, ej. {"L":["09:00","18:00"],"D":null}
  UbicacionMapa           VARCHAR(255) NULL,                    -- Enlace de Google Maps
  InfoCitas               VARCHAR(300) NULL,                    -- Cómo agendar una cita
  -- Bot de WhatsApp (webhook de Meta)
  BotActivo               BOOLEAN NOT NULL DEFAULT FALSE,
  BotBienvenida           VARCHAR(500) NULL,
  WhatsAppVerifyToken     VARCHAR(80)  NULL,                    -- Token de verificación del webhook
  WhatsAppAppSecret       VARCHAR(80)  NULL                     -- Clave secreta de la app (firma de los mensajes)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Cuentas de usuario (contraseñas cifradas con scrypt, nunca en texto plano).
-- Usuario es NULL cuando la cuenta se elimina, para liberar el nombre.
-- -----------------------------------------------------------------------------
CREATE TABLE ADMINISTRADOR (                                    -- Rol «Dueño»
  ID_Admin      INT AUTO_INCREMENT PRIMARY KEY,
  Nombre        VARCHAR(100) NOT NULL,
  Usuario       VARCHAR(50)  NULL UNIQUE,
  Contrasena    VARCHAR(255) NOT NULL,
  Activo        BOOLEAN NOT NULL DEFAULT TRUE,
  FechaRegistro DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE CAJERO (
  ID_Cajero     INT AUTO_INCREMENT PRIMARY KEY,
  Nombre        VARCHAR(100) NOT NULL,
  Usuario       VARCHAR(50)  NULL UNIQUE,
  Contrasena    VARCHAR(255) NOT NULL,
  Telefono      VARCHAR(15)  NULL,
  Activo        BOOLEAN NOT NULL DEFAULT TRUE,
  FechaRegistro DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE BARBERO (
  ID_Barbero       INT AUTO_INCREMENT PRIMARY KEY,
  Nombre           VARCHAR(100) NOT NULL,
  Usuario          VARCHAR(50)  NULL UNIQUE,
  Contrasena       VARCHAR(255) NOT NULL,
  Telefono         VARCHAR(15)  NULL,
  FechaRegistro    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  HoraEntrada      TIME NOT NULL DEFAULT '09:00:00',
  HoraSalida       TIME NOT NULL DEFAULT '19:00:00',
  ComidaInicio     TIME NULL DEFAULT '14:00:00',
  ComidaFin        TIME NULL DEFAULT '15:00:00',
  DiasTrabajo      VARCHAR(20)  NOT NULL DEFAULT 'L,M,X,J,V,S',  -- L M X J V S D (X = miércoles)
  RolesActividades VARCHAR(255) NULL,
  Activo           BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT chk_barbero_jornada CHECK (HoraSalida > HoraEntrada),
  CONSTRAINT chk_barbero_comida  CHECK (ComidaInicio IS NULL OR (ComidaFin > ComidaInicio
                                        AND ComidaInicio >= HoraEntrada AND ComidaFin <= HoraSalida))
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Catálogos
-- -----------------------------------------------------------------------------
CREATE TABLE SERVICIO (
  ID_Servicio     INT AUTO_INCREMENT PRIMARY KEY,
  NombreServicio  VARCHAR(100) NOT NULL,
  Descripcion     VARCHAR(255) NULL,
  Precio          DECIMAL(10,2) NOT NULL,
  DuracionMin     INT NOT NULL DEFAULT 30,
  DiasDisponibles VARCHAR(20) NULL,                -- NULL = todos los días, o 'L,M,X,J,V,S,D'
  Activo          BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT chk_servicio_precio   CHECK (Precio >= 0),
  CONSTRAINT chk_servicio_duracion CHECK (DuracionMin BETWEEN 10 AND 480)
) ENGINE=InnoDB;

CREATE TABLE PRODUCTO (
  ID_Producto    INT AUTO_INCREMENT PRIMARY KEY,
  NombreProducto VARCHAR(100) NOT NULL,
  Categoria      VARCHAR(40)  NULL,                 -- Ej. Bebida, Cabello, Barba (para beneficios por categoría)
  Precio         DECIMAL(10,2) NOT NULL,
  FotoProducto   VARCHAR(255) NULL,
  Descripcion    VARCHAR(255) NULL,
  Stock          INT NOT NULL DEFAULT 0,
  Activo         BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT chk_producto_precio CHECK (Precio >= 0),
  CONSTRAINT chk_producto_stock  CHECK (Stock >= 0)
) ENGINE=InnoDB;

-- Bitácora de existencias: alta, entradas, bajas (con autorización) y ventas.
CREATE TABLE MOVIMIENTO_INVENTARIO (
  ID_Movimiento INT AUTO_INCREMENT PRIMARY KEY,
  ID_Producto   INT NOT NULL,
  Tipo          ENUM('Alta','Entrada','Baja','Venta') NOT NULL,
  Cantidad      INT NOT NULL,                      -- Siempre positiva, el Tipo indica si suma o resta
  StockFinal    INT NOT NULL,
  Motivo        VARCHAR(255) NULL,
  RealizadoPor  VARCHAR(120) NOT NULL,             -- «Nombre (Rol)»
  ID_Venta      INT NULL,
  Fecha         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_movimiento_cantidad CHECK (Cantidad > 0),
  CONSTRAINT fk_movimiento_producto FOREIGN KEY (ID_Producto) REFERENCES PRODUCTO (ID_Producto) ON DELETE RESTRICT,
  INDEX ix_movimiento_fecha (Fecha)
) ENGINE=InnoDB;

CREATE TABLE MEMBRESIA (
  ID_Membresia  INT AUTO_INCREMENT PRIMARY KEY,
  NombrePlan    VARCHAR(100) NOT NULL,
  Descripcion   VARCHAR(255) NULL,
  Precio        DECIMAL(10,2) NOT NULL,
  DuracionMeses INT NOT NULL DEFAULT 1,
  Activo        BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT chk_membresia_precio   CHECK (Precio >= 0),
  CONSTRAINT chk_membresia_duracion CHECK (DuracionMeses BETWEEN 1 AND 24)
) ENGINE=InnoDB;

-- Beneficios de una membresía (los que se quieran, en el orden en que se muestran).
-- Se pueden repetir sobre el mismo servicio, ej. «Cortes ilimitados» (1 por visita)
-- y «Corte para amigo» (1 por mes).
--   Aplica  'Servicio'  → un servicio (ID_Servicio)
--           'Producto'  → un producto (ID_Producto)
--           'Categoria' → los productos de una categoría (ej. Bebida)
--           'Productos' → todos los productos (descuento %)
--           'Texto'     → beneficio informativo (ej. «Pase preferente»), no cambia precios
--   Tipo    'Gratis' o 'Descuento' (Porcentaje %)
--   Usos    NULL = ilimitado, N = N usos por Periodo
--   Periodo 'Visita' = por día de visita, 'Mes' = periodo mensual de la membresía
--   Etiqueta texto que ve el cliente (ej. «Corte para amigo»)
CREATE TABLE MEMBRESIA_BENEFICIO (
  ID_Beneficio INT AUTO_INCREMENT PRIMARY KEY,
  ID_Membresia INT NOT NULL,
  Aplica       ENUM('Servicio','Producto','Categoria','Productos','Texto') NOT NULL DEFAULT 'Servicio',
  ID_Servicio  INT NULL,
  ID_Producto  INT NULL,
  Categoria    VARCHAR(40) NULL,
  Tipo         ENUM('Gratis','Descuento') NOT NULL DEFAULT 'Gratis',
  Porcentaje   DECIMAL(5,2) NOT NULL DEFAULT 0,
  Usos         INT NULL,
  Periodo      ENUM('Visita','Mes') NOT NULL DEFAULT 'Mes',
  Etiqueta     VARCHAR(80) NULL,
  Orden        INT NOT NULL DEFAULT 0,
  CONSTRAINT chk_beneficio_porcentaje CHECK (Porcentaje BETWEEN 0 AND 100),
  CONSTRAINT chk_beneficio_usos CHECK (Usos IS NULL OR Usos >= 1),
  CONSTRAINT fk_beneficio_membresia FOREIGN KEY (ID_Membresia) REFERENCES MEMBRESIA (ID_Membresia) ON DELETE CASCADE,
  CONSTRAINT fk_beneficio_servicio  FOREIGN KEY (ID_Servicio)  REFERENCES SERVICIO (ID_Servicio)   ON DELETE CASCADE,
  CONSTRAINT fk_beneficio_producto  FOREIGN KEY (ID_Producto)  REFERENCES PRODUCTO (ID_Producto)   ON DELETE CASCADE
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Descuentos (promociones). Se aplican solos en caja mientras estén activos y
-- vigentes. Por pieza se usa el mayor descuento entre la promoción y la
-- membresía del cliente (no se suman).
--   Aplica 'Todo'       → toda la venta
--          'Servicios'  → todos los servicios, o uno (ID_Servicio)
--          'Productos'  → todos, una categoría (Categoria) o uno (ID_Producto)
--          'Membresias' → todas, o una (ID_Membresia)
--   Tipo   'Porcentaje' (Valor %) o 'Monto' (Valor en pesos por pieza)
-- -----------------------------------------------------------------------------
CREATE TABLE DESCUENTO (
  ID_Descuento INT AUTO_INCREMENT PRIMARY KEY,
  Nombre       VARCHAR(80)  NOT NULL,
  Descripcion  VARCHAR(255) NULL,
  Aplica       ENUM('Todo','Servicios','Productos','Membresias') NOT NULL DEFAULT 'Todo',
  ID_Servicio  INT NULL,
  ID_Producto  INT NULL,
  Categoria    VARCHAR(40) NULL,
  ID_Membresia INT NULL,
  Tipo         ENUM('Porcentaje','Monto') NOT NULL DEFAULT 'Porcentaje',
  Valor        DECIMAL(10,2) NOT NULL,
  FechaInicio  DATE NULL,                          -- NULL = desde ahora
  FechaFin     DATE NULL,                          -- NULL = sin fecha de término
  Activo       BOOLEAN NOT NULL DEFAULT TRUE,      -- FALSE = en pausa
  Eliminado    BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT chk_descuento_valor CHECK (Valor > 0),
  CONSTRAINT fk_descuento_servicio  FOREIGN KEY (ID_Servicio)  REFERENCES SERVICIO (ID_Servicio)   ON DELETE CASCADE,
  CONSTRAINT fk_descuento_producto  FOREIGN KEY (ID_Producto)  REFERENCES PRODUCTO (ID_Producto)   ON DELETE CASCADE,
  CONSTRAINT fk_descuento_membresia FOREIGN KEY (ID_Membresia) REFERENCES MEMBRESIA (ID_Membresia) ON DELETE CASCADE
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Clientes
-- -----------------------------------------------------------------------------
CREATE TABLE CLIENTE (
  ID_Cliente          INT AUTO_INCREMENT PRIMARY KEY,
  Nombre              VARCHAR(100) NOT NULL,
  Lada                VARCHAR(5)   NOT NULL DEFAULT '+52',
  Telefono            VARCHAR(15)  NOT NULL UNIQUE,
  FotoCorteReferencia VARCHAR(255) NULL,
  Descripcion         VARCHAR(255) NULL,                     -- Estilo preferido
  Observaciones       VARCHAR(500) NULL,                     -- Historial y observaciones
  FechaRegistro       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Membresía: solo se activa al cobrarla en caja
  EstadoMembresia     ENUM('Activa','Inactiva') NOT NULL DEFAULT 'Inactiva',
  ID_Membresia        INT NULL,
  FechaInicio         DATE NULL,                             -- Inicio del periodo continuo de membresía
  FechaVencimiento    DATE NULL,                             -- Último día de la membresía
  FaltasConsecutivas  INT NOT NULL DEFAULT 0,
  CONSTRAINT chk_cliente_faltas CHECK (FaltasConsecutivas >= 0),
  CONSTRAINT fk_cliente_membresia FOREIGN KEY (ID_Membresia) REFERENCES MEMBRESIA (ID_Membresia) ON DELETE RESTRICT,
  INDEX ix_cliente_nombre (Nombre),
  INDEX ix_cliente_registro (FechaRegistro)
) ENGINE=InnoDB;

CREATE TABLE FOTO_CLIENTE (
  ID_Foto    INT AUTO_INCREMENT PRIMARY KEY,
  ID_Cliente INT NOT NULL,
  Url        VARCHAR(255) NOT NULL,                          -- Ruta pública, ej. /uploads/clientes/7/foto.jpg
  Titulo     VARCHAR(100) NULL,
  Notas      VARCHAR(255) NULL,
  SubidaPor  VARCHAR(120) NULL,
  Fecha      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_foto_cliente FOREIGN KEY (ID_Cliente) REFERENCES CLIENTE (ID_Cliente) ON DELETE CASCADE
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Caja: cierres, ventas y detalle (sin IVA)
-- -----------------------------------------------------------------------------
CREATE TABLE CIERRE_CAJA (
  ID_Corte           INT AUTO_INCREMENT PRIMARY KEY,
  FechaCorte         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  NumeroVentas       INT NOT NULL,
  TotalIngresos      DECIMAL(12,2) NOT NULL,
  TotalEfectivo      DECIMAL(12,2) NOT NULL,
  TotalTarjeta       DECIMAL(12,2) NOT NULL,
  TotalTransferencia DECIMAL(12,2) NOT NULL,
  FondoInicial       DECIMAL(10,2) NOT NULL DEFAULT 0,
  EfectivoContado    DECIMAL(12,2) NOT NULL,
  Diferencia         DECIMAL(12,2) NOT NULL,
  ID_Cajero          INT NULL,                               -- Quién hizo el corte (cajero o dueño)
  ID_Admin           INT NULL,
  RealizadoPor       VARCHAR(120) NOT NULL,
  Desde              DATETIME NULL,                          -- Primera operación del turno
  VentasBrutas       DECIMAL(12,2) NOT NULL DEFAULT 0,       -- A precio normal, antes de descuentos
  TotalDescuentos    DECIMAL(12,2) NOT NULL DEFAULT 0,       -- Membresías y promociones
  NumeroReembolsos   INT NOT NULL DEFAULT 0,
  TotalReembolsos    DECIMAL(12,2) NOT NULL DEFAULT 0,
  ReembolsosEfectivo DECIMAL(12,2) NOT NULL DEFAULT 0,       -- Se restan del efectivo esperado
  Arqueo             VARCHAR(600) NULL,                      -- JSON: billetes y monedas contados
  Observaciones      VARCHAR(500) NULL,
  CONSTRAINT chk_cierre_responsable CHECK (ID_Cajero IS NOT NULL OR ID_Admin IS NOT NULL),
  CONSTRAINT fk_cierre_cajero FOREIGN KEY (ID_Cajero) REFERENCES CAJERO (ID_Cajero)        ON DELETE RESTRICT,
  CONSTRAINT fk_cierre_admin  FOREIGN KEY (ID_Admin)  REFERENCES ADMINISTRADOR (ID_Admin)  ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE VENTA (
  ID_Venta       INT AUTO_INCREMENT PRIMARY KEY,
  NumeroFactura  VARCHAR(20) NULL UNIQUE,                    -- Folio T-AAAA-000001 (se asigna al guardar)
  FechaHoraCobro DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  Subtotal       DECIMAL(10,2) NOT NULL,                     -- Suma a precio normal
  Descuento      DECIMAL(10,2) NOT NULL DEFAULT 0,           -- Descuentos de membresía
  ImporteTotal   DECIMAL(10,2) NOT NULL,                     -- Lo que paga el cliente
  MetodoPago     ENUM('Efectivo','Transferencia','Tarjeta') NOT NULL,
  MontoRecibido  DECIMAL(10,2) NULL,                         -- Solo efectivo
  Cambio         DECIMAL(10,2) NULL,                         -- Solo efectivo
  ID_Cliente     INT NULL,                                   -- NULL = «Cliente 0»
  ID_Cajero      INT NULL,                                   -- Quién cobró (cajero o dueño)
  ID_Admin       INT NULL,
  CobradoPor     VARCHAR(120) NOT NULL,
  ID_Corte       INT NULL,                                   -- NULL mientras la caja no se cierra
  CONSTRAINT chk_venta_importes CHECK (Subtotal >= 0 AND Descuento >= 0 AND ImporteTotal = Subtotal - Descuento),
  CONSTRAINT fk_venta_cliente FOREIGN KEY (ID_Cliente) REFERENCES CLIENTE (ID_Cliente)       ON DELETE RESTRICT,
  CONSTRAINT fk_venta_cajero  FOREIGN KEY (ID_Cajero)  REFERENCES CAJERO (ID_Cajero)         ON DELETE RESTRICT,
  CONSTRAINT fk_venta_admin   FOREIGN KEY (ID_Admin)   REFERENCES ADMINISTRADOR (ID_Admin)   ON DELETE RESTRICT,
  CONSTRAINT fk_venta_corte   FOREIGN KEY (ID_Corte)   REFERENCES CIERRE_CAJA (ID_Corte)     ON DELETE RESTRICT,
  INDEX ix_venta_fecha (FechaHoraCobro),
  INDEX ix_venta_corte (ID_Corte)
) ENGINE=InnoDB;

CREATE TABLE DETALLE_VENTA (
  ID_Detalle     INT AUTO_INCREMENT PRIMARY KEY,
  ID_Venta       INT NOT NULL,
  TipoItem       ENUM('Servicio','Producto','Membresía') NOT NULL,
  NombreItem     VARCHAR(100) NOT NULL,                      -- Copia histórica del catálogo
  PrecioUnitario DECIMAL(10,2) NOT NULL,                     -- Precio normal
  Cantidad       INT NOT NULL DEFAULT 1,
  Descuento      DECIMAL(10,2) NOT NULL DEFAULT 0,           -- Descuento total del renglón
  Importe        DECIMAL(10,2) NOT NULL,                     -- PrecioUnitario × Cantidad − Descuento
  Beneficio      VARCHAR(255) NULL,                          -- Ej. «Premier · Barba: gratis (1 de 2 del mes)»
  UsaBeneficio   BOOLEAN NOT NULL DEFAULT FALSE,             -- Se aplicó un beneficio de membresía
  ID_Beneficio   INT NULL,                                   -- Beneficio usado (cuenta para el límite de usos)
  ID_Descuento   INT NULL,                                   -- Descuento (promoción) aplicado
  ID_Servicio    INT NULL,
  ID_Producto    INT NULL,
  ID_Membresia   INT NULL,
  ID_Barbero     INT NULL,                                   -- Quién atendió el servicio
  ID_Cita        INT NULL,                                   -- Cita atendida que se está cobrando
  VenceMembresia DATE NULL,                                  -- Nuevo vencimiento (renglones de membresía)
  CONSTRAINT chk_detalle_cantidad CHECK (Cantidad >= 1),
  CONSTRAINT fk_detalle_venta     FOREIGN KEY (ID_Venta)     REFERENCES VENTA (ID_Venta)         ON DELETE CASCADE,
  CONSTRAINT fk_detalle_servicio  FOREIGN KEY (ID_Servicio)  REFERENCES SERVICIO (ID_Servicio)   ON DELETE RESTRICT,
  CONSTRAINT fk_detalle_producto  FOREIGN KEY (ID_Producto)  REFERENCES PRODUCTO (ID_Producto)   ON DELETE RESTRICT,
  CONSTRAINT fk_detalle_membresia FOREIGN KEY (ID_Membresia) REFERENCES MEMBRESIA (ID_Membresia) ON DELETE RESTRICT,
  CONSTRAINT fk_detalle_barbero   FOREIGN KEY (ID_Barbero)   REFERENCES BARBERO (ID_Barbero)     ON DELETE RESTRICT,
  INDEX ix_detalle_beneficio (ID_Beneficio)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Citas
-- -----------------------------------------------------------------------------
CREATE TABLE CITA (
  ID_Cita       INT AUTO_INCREMENT PRIMARY KEY,
  FechaHora     DATETIME NOT NULL,
  DuracionMin   INT NOT NULL DEFAULT 30,                     -- Copia de SERVICIO.DuracionMin
  Estado        ENUM('Agendada','EnEspera','EnAtencion','Atendida','Cancelada','NoAsistio') NOT NULL DEFAULT 'Agendada',
  Origen        ENUM('WhatsApp','Caja','App','SinCita') NOT NULL,
  ID_Cliente    INT NOT NULL,
  ID_Barbero    INT NOT NULL,
  ID_Servicio   INT NOT NULL,
  ID_Venta      INT NULL,                                    -- Venta que cobró esta cita (NULL = pendiente de pago)
  Notificada    BOOLEAN NOT NULL DEFAULT FALSE,              -- Confirmación enviada por WhatsApp
  FechaRegistro DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cita_cliente  FOREIGN KEY (ID_Cliente)  REFERENCES CLIENTE  (ID_Cliente)  ON DELETE RESTRICT,
  CONSTRAINT fk_cita_barbero  FOREIGN KEY (ID_Barbero)  REFERENCES BARBERO  (ID_Barbero)  ON DELETE RESTRICT,
  CONSTRAINT fk_cita_servicio FOREIGN KEY (ID_Servicio) REFERENCES SERVICIO (ID_Servicio) ON DELETE RESTRICT,
  CONSTRAINT fk_cita_venta    FOREIGN KEY (ID_Venta)    REFERENCES VENTA    (ID_Venta)    ON DELETE SET NULL,
  INDEX ix_cita_barbero_fecha (ID_Barbero, FechaHora),
  INDEX ix_cita_cliente (ID_Cliente, Estado)
) ENGINE=InnoDB;
-- La FK de DETALLE_VENTA a CITA se agrega aquí porque CITA se crea después.
ALTER TABLE DETALLE_VENTA
  ADD CONSTRAINT fk_detalle_cita FOREIGN KEY (ID_Cita) REFERENCES CITA (ID_Cita) ON DELETE SET NULL;

-- -----------------------------------------------------------------------------
-- Avisos para barberos y bitácora de WhatsApp
-- -----------------------------------------------------------------------------
-- Reembolsos (devoluciones de dinero de una venta, total o parcial).
-- El reembolso entra en el corte de caja del turno en que se hace.
-- -----------------------------------------------------------------------------
CREATE TABLE REEMBOLSO (
  ID_Reembolso      INT AUTO_INCREMENT PRIMARY KEY,
  ID_Venta          INT NOT NULL,
  Fecha             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  Monto             DECIMAL(10,2) NOT NULL,
  MetodoDevolucion  ENUM('Efectivo','Transferencia','Tarjeta') NOT NULL,
  Motivo            VARCHAR(255) NOT NULL,
  RegresaInventario BOOLEAN NOT NULL DEFAULT FALSE,           -- Los productos volvieron a existencias
  RealizadoPor      VARCHAR(120) NOT NULL,
  ID_Corte          INT NULL,                                 -- NULL mientras la caja no se cierra
  CONSTRAINT chk_reembolso_monto CHECK (Monto > 0),
  CONSTRAINT fk_reembolso_venta FOREIGN KEY (ID_Venta) REFERENCES VENTA (ID_Venta)       ON DELETE RESTRICT,
  CONSTRAINT fk_reembolso_corte FOREIGN KEY (ID_Corte) REFERENCES CIERRE_CAJA (ID_Corte) ON DELETE RESTRICT,
  INDEX ix_reembolso_fecha (Fecha),
  INDEX ix_reembolso_corte (ID_Corte)
) ENGINE=InnoDB;

CREATE TABLE REEMBOLSO_DETALLE (
  ID_ReembolsoDetalle INT AUTO_INCREMENT PRIMARY KEY,
  ID_Reembolso        INT NOT NULL,
  ID_Detalle          INT NOT NULL,                           -- Renglón de la venta
  Cantidad            INT NOT NULL,
  Importe             DECIMAL(10,2) NOT NULL,
  CONSTRAINT chk_reembolsodet_cantidad CHECK (Cantidad > 0),
  CONSTRAINT fk_reembolsodet_reembolso FOREIGN KEY (ID_Reembolso) REFERENCES REEMBOLSO (ID_Reembolso)   ON DELETE CASCADE,
  CONSTRAINT fk_reembolsodet_detalle   FOREIGN KEY (ID_Detalle)   REFERENCES DETALLE_VENTA (ID_Detalle) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
CREATE TABLE AVISO (
  ID_Aviso   INT AUTO_INCREMENT PRIMARY KEY,
  ID_Barbero INT NOT NULL,
  Tipo       VARCHAR(50)  NOT NULL,                          -- 'Nueva cita', 'Cita cancelada', 'Cambio de horario'
  Mensaje    VARCHAR(255) NOT NULL,
  Fecha      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  Leido      BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT fk_aviso_barbero FOREIGN KEY (ID_Barbero) REFERENCES BARBERO (ID_Barbero) ON DELETE CASCADE,
  INDEX ix_aviso_barbero (ID_Barbero, Leido)
) ENGINE=InnoDB;

CREATE TABLE MENSAJE_WHATSAPP (
  ID_Mensaje INT AUTO_INCREMENT PRIMARY KEY,
  Fecha      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  Telefono   VARCHAR(20)  NOT NULL,
  Tipo       ENUM('Cita','Ticket','Prueba') NOT NULL,
  Estado     ENUM('Enviado','Error') NOT NULL,
  Detalle    VARCHAR(500) NULL,
  ID_Cita    INT NULL,
  ID_Venta   INT NULL
) ENGINE=InnoDB;

-- Conversaciones del bot de WhatsApp (mensajes recibidos y respuestas).
CREATE TABLE WHATSAPP_CHAT (
  ID_Chat   INT AUTO_INCREMENT PRIMARY KEY,
  Fecha     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  Telefono  VARCHAR(20)   NOT NULL,
  Nombre    VARCHAR(100)  NULL,
  Entrante  BOOLEAN       NOT NULL,                           -- TRUE = lo escribió el cliente
  Texto     VARCHAR(1500) NOT NULL,
  Tema      VARCHAR(30)   NULL,                               -- Qué entendió el bot (servicios, horario…)
  Estado    VARCHAR(200)  NULL,                               -- 'Enviado' o el error al responder
  INDEX ix_chat_fecha (Fecha)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Registro inicial obligatorio (no es un dato de ejemplo)
-- -----------------------------------------------------------------------------
INSERT INTO ESTABLECIMIENTO (ID_Local, NombreEstablecimiento, MensajeTicket, EstadoServicio)
VALUES (1, 'Engreídos Barbershop', '¡Gracias por su preferencia!', 'Activo');

-- Opcional (recomendado): usuario exclusivo para el servidor en lugar de root.
--   CREATE USER 'engreidos'@'localhost' IDENTIFIED BY 'cambia-esta-contraseña';
--   GRANT SELECT, INSERT, UPDATE, DELETE ON engreidos.* TO 'engreidos'@'localhost';
