-- Ejecuta este script en Supabase (SQL Editor) para crear las tablas.
-- Supabase: https://supabase.com → tu proyecto → SQL Editor
--
-- Para bases de datos existentes, al final del archivo hay sentencias ALTER TABLE
-- que añaden las columnas nuevas sin perder datos.

-- ─────────────────────────────────────────────────────────
-- TABLA: orders
-- Registra cada intento de compra de stikers.
--   status: 'pending' (checkout abierto), 'paid' (pago confirmado), 'expired' (abandonado)
--   payment_reference: ID de transacción del proveedor (Wompi o Stripe session id)
--   stripe_session_id: mantenido por compatibilidad; usar payment_reference para nuevas integraciones
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  stripe_session_id TEXT UNIQUE,
  payment_reference TEXT,
  cedula TEXT NOT NULL,
  nombre TEXT NOT NULL,
  email TEXT NOT NULL,
  telefono TEXT,
  total_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'cop',
  status TEXT NOT NULL DEFAULT 'pending',
  sorteo_mayor_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────
-- TABLA: order_items
-- Un ítem por cada stiker comprado en una orden.
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  numero_a TEXT NOT NULL,
  numero_b TEXT NOT NULL
);

-- ─────────────────────────────────────────────────────────
-- TABLA: stiker_slots
-- 5000 pares de números disponibles por campaña.
-- order_id: el slot está "reservado" cuando se asigna, y "vendido" cuando la orden queda 'paid'.
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stiker_slots (
  id SERIAL PRIMARY KEY,
  numero_a TEXT NOT NULL,
  numero_b TEXT NOT NULL,
  order_id TEXT REFERENCES orders(id),
  UNIQUE(numero_a, numero_b)
);

-- ─────────────────────────────────────────────────────────
-- TABLA: sorteos
-- Cada sorteo puede ser tipo 'mayor' o 'anticipado'.
-- Los anticipados pertenecen a un mayor via sorteo_mayor_id.
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sorteos (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  fecha TEXT NOT NULL,
  descripcion TEXT,
  tipo TEXT NOT NULL DEFAULT 'anticipado',
  estado TEXT NOT NULL DEFAULT 'programado',
  premio_descripcion TEXT,
  imagen_url TEXT,
  sorteo_mayor_id INTEGER REFERENCES sorteos(id),
  numero_ganador_a TEXT,
  numero_ganador_b TEXT,
  ganador_nombre TEXT,
  ganador_cedula TEXT,
  ganador_email TEXT,
  ganador_telefono TEXT,
  numeros_beneficiados TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────
-- TABLA: config
-- Parámetros del negocio (clave/valor).
--   precio_stiker_cents: precio por stiker en centavos de la moneda configurada.
--     Para COP: 500000 = $5.000 COP (= 5000 × 100 centavos).
--   currency: 'cop', 'usd', 'eur', etc.
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ─────────────────────────────────────────────────────────
-- TABLA: beneficios_anticipados
-- Registra qué clientes ganaron cada sorteo anticipado.
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS beneficios_anticipados (
  id SERIAL PRIMARY KEY,
  sorteo_id INTEGER NOT NULL REFERENCES sorteos(id),
  order_id TEXT NOT NULL REFERENCES orders(id),
  numero_a TEXT NOT NULL,
  numero_b TEXT NOT NULL,
  cedula TEXT,
  nombre TEXT,
  email TEXT,
  telefono TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────
-- ÍNDICES
-- ─────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_orders_cedula ON orders(cedula);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_stiker_slots_order ON stiker_slots(order_id);
CREATE INDEX IF NOT EXISTS idx_sorteos_fecha ON sorteos(fecha);
CREATE INDEX IF NOT EXISTS idx_sorteos_estado ON sorteos(estado);
CREATE INDEX IF NOT EXISTS idx_beneficios_sorteo ON beneficios_anticipados(sorteo_id);
CREATE INDEX IF NOT EXISTS idx_beneficios_order ON beneficios_anticipados(order_id);

-- ─────────────────────────────────────────────────────────
-- CONFIG INICIAL
-- precio_stiker_cents = 500000 → $5.000 COP por stiker
-- ─────────────────────────────────────────────────────────
INSERT INTO config (key, value) VALUES ('precio_stiker_cents', '500000'), ('currency', 'cop')
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────────────
-- MIGRACIONES PARA BASES DE DATOS EXISTENTES
-- Ejecutar solo si la DB ya existe y no tiene estas columnas.
-- ─────────────────────────────────────────────────────────

-- Añadir columna payment_reference si no existe (almacena ID de transacción Wompi/Stripe)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_reference TEXT;

-- Cambiar default de currency a 'cop' (si la columna fue creada con default 'usd')
ALTER TABLE orders ALTER COLUMN currency SET DEFAULT 'cop';

-- Añadir índice en orders.created_at si no existe (para limpiar pendientes expirados)
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);

-- Índices compuestos para acelerar consultas frecuentes (inicio, sorteos, stikers)
CREATE INDEX IF NOT EXISTS idx_sorteos_tipo_estado_fecha ON sorteos(tipo, estado, fecha);
CREATE INDEX IF NOT EXISTS idx_sorteos_mayor_estado ON sorteos(sorteo_mayor_id, estado);

-- Reglas de anticipados por campaña (Premio Mayor). Sin reglas = desbloqueo inmediato (comportamiento anterior).
CREATE TABLE IF NOT EXISTS anticipados_reglas (
  id SERIAL PRIMARY KEY,
  sorteo_mayor_id INTEGER NOT NULL REFERENCES sorteos(id) ON DELETE CASCADE,
  porcentaje INTEGER NOT NULL,
  cantidad INTEGER NOT NULL DEFAULT 1,
  UNIQUE(sorteo_mayor_id, porcentaje)
);
CREATE INDEX IF NOT EXISTS idx_anticipados_reglas_mayor ON anticipados_reglas(sorteo_mayor_id);

-- beneficios_anticipados: desbloqueado = false = pendiente (no mostrar en home, admin sí lo ve). true = desbloqueado (mostrar, entregar premio).
ALTER TABLE beneficios_anticipados ADD COLUMN IF NOT EXISTS desbloqueado BOOLEAN DEFAULT true;
