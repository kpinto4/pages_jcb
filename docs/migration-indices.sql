-- Ejecuta en Neon: SQL Editor → pegar y ejecutar
-- Acelera las consultas de inicio, sorteos y stikers

CREATE INDEX IF NOT EXISTS idx_sorteos_tipo_estado_fecha ON sorteos(tipo, estado, fecha);
CREATE INDEX IF NOT EXISTS idx_sorteos_mayor_estado ON sorteos(sorteo_mayor_id, estado);
