-- Ejecuta este script en Supabase (SQL Editor) para crear las tablas.
-- Supabase: https://supabase.com → tu proyecto → SQL Editor

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  stripe_session_id TEXT UNIQUE,
  cedula TEXT NOT NULL,
  nombre TEXT NOT NULL,
  email TEXT NOT NULL,
  telefono TEXT,
  total_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  status TEXT NOT NULL DEFAULT 'pending',
  sorteo_mayor_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  numero_a TEXT NOT NULL,
  numero_b TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stiker_slots (
  id SERIAL PRIMARY KEY,
  numero_a TEXT NOT NULL,
  numero_b TEXT NOT NULL,
  order_id TEXT REFERENCES orders(id),
  UNIQUE(numero_a, numero_b)
);

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

CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

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

CREATE INDEX IF NOT EXISTS idx_orders_cedula ON orders(cedula);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_stiker_slots_order ON stiker_slots(order_id);
CREATE INDEX IF NOT EXISTS idx_sorteos_fecha ON sorteos(fecha);
CREATE INDEX IF NOT EXISTS idx_sorteos_estado ON sorteos(estado);
CREATE INDEX IF NOT EXISTS idx_beneficios_sorteo ON beneficios_anticipados(sorteo_id);
CREATE INDEX IF NOT EXISTS idx_beneficios_order ON beneficios_anticipados(order_id);

-- Config inicial
INSERT INTO config (key, value) VALUES ('precio_stiker_cents', '5000'), ('currency', 'cop')
ON CONFLICT (key) DO NOTHING;
