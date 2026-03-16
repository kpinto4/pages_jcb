-- Ejecuta en Neon SQL Editor para habilitar restricción de anticipados por porcentaje
-- Migración: anticipados_reglas + columna desbloqueado en beneficios_anticipados

CREATE TABLE IF NOT EXISTS anticipados_reglas (
  id SERIAL PRIMARY KEY,
  sorteo_mayor_id INTEGER NOT NULL REFERENCES sorteos(id) ON DELETE CASCADE,
  porcentaje INTEGER NOT NULL,
  cantidad INTEGER NOT NULL DEFAULT 1,
  UNIQUE(sorteo_mayor_id, porcentaje)
);
CREATE INDEX IF NOT EXISTS idx_anticipados_reglas_mayor ON anticipados_reglas(sorteo_mayor_id);

ALTER TABLE beneficios_anticipados ADD COLUMN IF NOT EXISTS desbloqueado BOOLEAN DEFAULT true;
-- Los beneficios existentes quedan desbloqueados (true) por el DEFAULT
