# Migración urgente para Neon

**Ejecuta este SQL en Neon SQL Editor** para solucionar los errores:
- `relation "anticipados_reglas" does not exist`
- `column b.desbloqueado does not exist`

1. Entra a [Neon Console](https://console.neon.tech) → tu proyecto
2. Abre **SQL Editor**
3. Copia y pega el bloque de abajo
4. Ejecuta (**Run**)

```sql
-- Tabla anticipados_reglas
CREATE TABLE IF NOT EXISTS anticipados_reglas (
  id SERIAL PRIMARY KEY,
  sorteo_mayor_id INTEGER NOT NULL REFERENCES sorteos(id) ON DELETE CASCADE,
  porcentaje INTEGER NOT NULL,
  cantidad INTEGER NOT NULL DEFAULT 1,
  UNIQUE(sorteo_mayor_id, porcentaje)
);
CREATE INDEX IF NOT EXISTS idx_anticipados_reglas_mayor ON anticipados_reglas(sorteo_mayor_id);

-- Columna desbloqueado en beneficios_anticipados
ALTER TABLE beneficios_anticipados ADD COLUMN IF NOT EXISTS desbloqueado BOOLEAN DEFAULT true;
```

Después de ejecutarlo, reinicia el backend si hace falta. Los beneficios existentes quedarán desbloqueados (`true`) por el DEFAULT.
