-- =============================================================================
-- Engreídos Barbershop · Esquema de base de datos (MySQL 8.0 o superior)
-- -----------------------------------------------------------------------------
-- Basado en el modelo relacional de la sección 3.3 del documento del proyecto
-- (CLIENTE, BARBERO, CAJERO, CITA, PRODUCTO, VENTA, DETALLE_VENTA,
-- CIERRE_CAJA), más ESTABLECIMIENTO y ADMINISTRADOR, y las tablas y columnas
-- que el front end ya utiliza (marcadas con «SUGERIDA»). Ver docs/API.md.
--
-- No incluye datos de ejemplo. Solo se inserta el registro único de
-- ESTABLECIMIENTO, necesario para que el sistema funcione.
--
-- Uso:  mysql -u root -p < docs/esquema.sql
-- =============================================================================

CREATE DATABASE IF NOT EXISTS engreidos
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE engreidos;

-- -----------------------------------------------------------------------------
-- Configuración del negocio (un solo registro)
-- -----------------------------------------------------------------------------
CREATE TABLE ESTABLECIMIENTO (
  ID_Local              INT AUTO_INCREMENT PRIMARY KEY,
  NombreEstablecimiento VARCHAR(100) NOT NULL,
  DatosFiscales         VARCHAR(255) NULL,
  Direccion             VARCHAR(255) NULL,                  -- SUGERIDA (ticket)
  Telefono              VARCHAR(15)  NULL,                  -- SUGERIDA (ticket)
  MensajeTicket         VARCHAR(255) NULL,                  -- SUGERIDA (pie del ticket)
  FondoCaja             DECIMAL(10,2) NOT NULL DEFAULT 0,   -- SUGERIDA (fondo inicial del cierre)
  EstadoServicio        ENUM('Activo','Suspendido') NOT NULL DEFAULT 'Activo',
  MensajeMantenimiento  VARCHAR(255) NULL
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Usuarios del sistema (contraseñas cifradas con bcrypt)
-- -----------------------------------------------------------------------------
CREATE TABLE ADMINISTRADOR (
  ID_Admin   INT AUTO_INCREMENT PRIMARY KEY,
  Nombre     VARCHAR(100) NOT NULL,
  Usuario    VARCHAR(50)  NOT NULL UNIQUE,                  -- SUGERIDA (inicio de sesión)
  Contrasena VARCHAR(255) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE CAJERO (
  ID_Cajero  INT AUTO_INCREMENT PRIMARY KEY,
  Nombre     VARCHAR(100) NOT NULL,
  Usuario    VARCHAR(50)  NOT NULL UNIQUE,                  -- SUGERIDA (inicio de sesión)
  Contrasena VARCHAR(255) NOT NULL,
  Telefono   VARCHAR(15)  NULL
) ENGINE=InnoDB;

CREATE TABLE BARBERO (
  ID_Barbero       INT AUTO_INCREMENT PRIMARY KEY,
  Nombre           VARCHAR(100) NOT NULL,
  Usuario          VARCHAR(50)  NOT NULL UNIQUE,            -- SUGERIDA (inicio de sesión)
  Contrasena       VARCHAR(255) NOT NULL,
  Telefono         VARCHAR(15)  NOT NULL,
  FechaRegistro    DATE NOT NULL DEFAULT (CURRENT_DATE),
  HoraEntrada      TIME NOT NULL,
  HoraSalida       TIME NOT NULL,
  ComidaInicio     TIME NULL,                               -- SUGERIDA
  ComidaFin        TIME NULL,                               -- SUGERIDA
  DiasTrabajo      VARCHAR(20)  NOT NULL,                   -- Ej. 'L,M,X,J,V,S'
  RolesActividades VARCHAR(255) NULL,
  CONSTRAINT chk_barbero_jornada CHECK (HoraSalida > HoraEntrada),
  CONSTRAINT chk_barbero_comida  CHECK (ComidaInicio IS NULL OR (ComidaFin > ComidaInicio
                                        AND ComidaInicio >= HoraEntrada AND ComidaFin <= HoraSalida))
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Catálogos
-- -----------------------------------------------------------------------------
CREATE TABLE SERVICIO (                                     -- SUGERIDA
  ID_Servicio    INT AUTO_INCREMENT PRIMARY KEY,
  NombreServicio VARCHAR(100) NOT NULL,
  Descripcion    VARCHAR(255) NULL,
  Precio         DECIMAL(10,2) NOT NULL,
  DuracionMin    INT NOT NULL DEFAULT 30,
  Activo         BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT chk_servicio_precio CHECK (Precio >= 0)
) ENGINE=InnoDB;

CREATE TABLE MEMBRESIA (                                    -- SUGERIDA
  ID_Membresia       INT AUTO_INCREMENT PRIMARY KEY,
  NombrePlan         VARCHAR(100) NOT NULL,
  Precio             DECIMAL(10,2) NOT NULL,
  DescuentoServicios DECIMAL(5,2)  NOT NULL DEFAULT 0,      -- Porcentaje 0-100
  DuracionDias       INT NOT NULL DEFAULT 30,
  Activo             BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT chk_membresia_descuento CHECK (DescuentoServicios BETWEEN 0 AND 100)
) ENGINE=InnoDB;

CREATE TABLE PRODUCTO (
  ID_Producto    INT AUTO_INCREMENT PRIMARY KEY,
  NombreProducto VARCHAR(100) NOT NULL,
  Precio         DECIMAL(10,2) NOT NULL,
  FotoProducto   VARCHAR(255) NULL,
  Descripcion    VARCHAR(255) NULL,
  Stock          INT NOT NULL DEFAULT 0,
  CONSTRAINT chk_producto_precio CHECK (Precio >= 0),
  CONSTRAINT chk_producto_stock  CHECK (Stock >= 0)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Clientes
-- -----------------------------------------------------------------------------
CREATE TABLE CLIENTE (
  ID_Cliente          INT AUTO_INCREMENT PRIMARY KEY,
  Nombre              VARCHAR(100) NOT NULL,
  Telefono            VARCHAR(15)  NOT NULL UNIQUE,
  FotoCorteReferencia VARCHAR(255) NULL,
  Descripcion         VARCHAR(255) NULL,
  Observaciones       VARCHAR(255) NULL,                    -- SUGERIDA
  EstadoMembresia     ENUM('Activa','Inactiva') NOT NULL DEFAULT 'Inactiva',
  ID_Membresia        INT NULL,                             -- SUGERIDA
  FechaInicio         DATE NULL,
  FaltasConsecutivas  INT NOT NULL DEFAULT 0,
  CONSTRAINT chk_cliente_faltas CHECK (FaltasConsecutivas >= 0),
  CONSTRAINT fk_cliente_membresia FOREIGN KEY (ID_Membresia) REFERENCES MEMBRESIA (ID_Membresia) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE FOTO_CLIENTE (                                 -- SUGERIDA
  ID_Foto    INT AUTO_INCREMENT PRIMARY KEY,
  ID_Cliente INT NOT NULL,
  Url        VARCHAR(255) NOT NULL,
  Titulo     VARCHAR(100) NULL,
  Notas      VARCHAR(255) NULL,
  Fecha      DATE NOT NULL DEFAULT (CURRENT_DATE),
  ID_Barbero INT NULL,
  CONSTRAINT fk_foto_cliente FOREIGN KEY (ID_Cliente) REFERENCES CLIENTE (ID_Cliente) ON DELETE CASCADE,
  CONSTRAINT fk_foto_barbero FOREIGN KEY (ID_Barbero) REFERENCES BARBERO (ID_Barbero) ON DELETE SET NULL
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Citas
-- -----------------------------------------------------------------------------
CREATE TABLE CITA (
  ID_Cita     INT AUTO_INCREMENT PRIMARY KEY,
  FechaHora   DATETIME NOT NULL,
  Estado      ENUM('Agendada','EnEspera','EnAtencion','Atendida','Cancelada','NoAsistio') NOT NULL DEFAULT 'Agendada',
  Origen      ENUM('WhatsApp','Caja','App','SinCita') NOT NULL,
  ID_Cliente  INT NOT NULL,
  ID_Barbero  INT NOT NULL,
  ID_Servicio INT NULL,                                     -- SUGERIDA
  CONSTRAINT uq_cita_barbero_hora UNIQUE (ID_Barbero, FechaHora),
  CONSTRAINT fk_cita_cliente  FOREIGN KEY (ID_Cliente)  REFERENCES CLIENTE  (ID_Cliente)  ON DELETE RESTRICT,
  CONSTRAINT fk_cita_barbero  FOREIGN KEY (ID_Barbero)  REFERENCES BARBERO  (ID_Barbero)  ON DELETE RESTRICT,
  CONSTRAINT fk_cita_servicio FOREIGN KEY (ID_Servicio) REFERENCES SERVICIO (ID_Servicio) ON DELETE SET NULL
) ENGINE=InnoDB;
-- Nota: las citas canceladas conservan su fila; si se desea reagendar el mismo
-- horario, el back end puede mover la cancelada a otra tabla de historial o
-- reemplazar la restricción UNIQUE por una validación en la transacción.

CREATE TABLE AVISO (                                        -- SUGERIDA
  ID_Aviso   INT AUTO_INCREMENT PRIMARY KEY,
  ID_Barbero INT NOT NULL,
  Tipo       VARCHAR(50)  NOT NULL,                         -- Ej. 'Cita cancelada'
  Mensaje    VARCHAR(255) NOT NULL,
  Fecha      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  Leido      BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT fk_aviso_barbero FOREIGN KEY (ID_Barbero) REFERENCES BARBERO (ID_Barbero) ON DELETE CASCADE
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Caja: cierres, ventas y detalle
-- -----------------------------------------------------------------------------
CREATE TABLE CIERRE_CAJA (
  ID_Corte        INT AUTO_INCREMENT PRIMARY KEY,
  FechaCorte      DATE NOT NULL,
  TotalIngresos   DECIMAL(12,2) NOT NULL,
  TotalIVA        DECIMAL(12,2) NOT NULL,
  FondoInicial    DECIMAL(10,2) NOT NULL DEFAULT 0,         -- SUGERIDA
  EfectivoContado DECIMAL(12,2) NOT NULL,
  Diferencia      DECIMAL(12,2) NOT NULL DEFAULT 0,         -- SUGERIDA
  ID_Cajero       INT NOT NULL,
  CONSTRAINT uq_cierre_cajero_dia UNIQUE (ID_Cajero, FechaCorte),
  CONSTRAINT fk_cierre_cajero FOREIGN KEY (ID_Cajero) REFERENCES CAJERO (ID_Cajero) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE VENTA (
  ID_Venta       INT AUTO_INCREMENT PRIMARY KEY,
  NumeroFactura  VARCHAR(20) NOT NULL UNIQUE,
  FechaHoraCobro DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  Subtotal       DECIMAL(10,2) NOT NULL,                    -- SUGERIDA
  Descuento      DECIMAL(10,2) NOT NULL DEFAULT 0,          -- SUGERIDA
  ImporteTotal   DECIMAL(10,2) NOT NULL,
  IVA            DECIMAL(10,2) NOT NULL,
  MetodoPago     ENUM('Efectivo','Transferencia','Tarjeta') NOT NULL,
  MontoRecibido  DECIMAL(10,2) NULL,                        -- SUGERIDA (solo efectivo)
  Cambio         DECIMAL(10,2) NULL,                        -- SUGERIDA (solo efectivo)
  ID_Cliente     INT NULL,                                  -- NULL = público en general
  ID_Cajero      INT NOT NULL,                              -- Quien cobró (el Dueño usa su propio registro de cajero o una columna ID_Admin)
  ID_Corte       INT NULL,                                  -- NULL mientras el turno está abierto
  CONSTRAINT fk_venta_cliente FOREIGN KEY (ID_Cliente) REFERENCES CLIENTE (ID_Cliente)     ON DELETE RESTRICT,
  CONSTRAINT fk_venta_cajero  FOREIGN KEY (ID_Cajero)  REFERENCES CAJERO (ID_Cajero)       ON DELETE RESTRICT,
  CONSTRAINT fk_venta_corte   FOREIGN KEY (ID_Corte)   REFERENCES CIERRE_CAJA (ID_Corte)   ON DELETE RESTRICT,
  INDEX ix_venta_fecha (FechaHoraCobro),
  INDEX ix_venta_pendientes (ID_Cajero, ID_Corte)
) ENGINE=InnoDB;

CREATE TABLE DETALLE_VENTA (
  ID_Detalle     INT AUTO_INCREMENT PRIMARY KEY,
  ID_Venta       INT NOT NULL,
  TipoItem       ENUM('Servicio','Producto','Membresía') NOT NULL,
  NombreItem     VARCHAR(100) NOT NULL,                     -- Copia histórica del catálogo
  PrecioUnitario DECIMAL(10,2) NOT NULL,                    -- Copia histórica del catálogo
  Cantidad       INT NOT NULL DEFAULT 1,
  ID_Barbero     INT NULL,
  ID_Producto    INT NULL,
  CONSTRAINT chk_detalle_cantidad CHECK (Cantidad >= 1),
  CONSTRAINT chk_detalle_producto CHECK (TipoItem <> 'Producto' OR ID_Producto IS NOT NULL),
  CONSTRAINT chk_detalle_servicio CHECK (TipoItem <> 'Servicio' OR ID_Barbero IS NOT NULL),
  CONSTRAINT fk_detalle_venta    FOREIGN KEY (ID_Venta)    REFERENCES VENTA (ID_Venta)       ON DELETE CASCADE,
  CONSTRAINT fk_detalle_barbero  FOREIGN KEY (ID_Barbero)  REFERENCES BARBERO (ID_Barbero)   ON DELETE RESTRICT,
  CONSTRAINT fk_detalle_producto FOREIGN KEY (ID_Producto) REFERENCES PRODUCTO (ID_Producto) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Registro inicial obligatorio (no es un dato de ejemplo)
-- -----------------------------------------------------------------------------
INSERT INTO ESTABLECIMIENTO (NombreEstablecimiento, EstadoServicio)
VALUES ('Engreídos Barbershop', 'Activo');

-- Los usuarios se crean desde el back end para cifrar la contraseña, p. ej.:
--   const hash = await bcrypt.hash(contrasena, 10);
--   INSERT INTO ADMINISTRADOR (Nombre, Usuario, Contrasena) VALUES (?, ?, ?);
