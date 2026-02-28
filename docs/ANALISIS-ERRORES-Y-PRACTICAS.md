# Análisis del proyecto: errores y malas prácticas

Resumen del análisis del código (backend Express + PostgreSQL, frontend Angular) con problemas detectados y recomendaciones.

---

## Errores corregidos

### 1. **Bug en `server/db-pg.js`: INSERT con RETURNING id en tabla sin columna `id`**

- **Problema:** Para todo `INSERT` se añadía `RETURNING id`. La tabla `config` solo tiene columnas `(key, value)` (sin `id`), por lo que al guardar configuración desde el panel admin (`PATCH /api/admin/config`) la consulta fallaba en PostgreSQL.
- **Solución aplicada:** No añadir `RETURNING id` cuando el SQL contiene `ON CONFLICT` (upserts). Así los INSERT de config funcionan y el resto de tablas con `id` siguen devolviendo el id.

---

## Errores o riesgos a corregir

### 2. **Webhook Stripe sin verificación de firma en algunos casos**

- **Dónde:** `server/index.js` — `app.post('/api/webhooks/stripe'`.
- **Problema:** Si `STRIPE_WEBHOOK_SECRET` no está definido pero sí `STRIPE_SECRET_KEY`, se acepta `event = req.body` sin verificar la firma. Cualquier cliente podría enviar eventos falsos.
- **Recomendación:** En producción, no procesar el webhook si no hay `STRIPE_WEBHOOK_SECRET` (devolver 400 o 503 y no ejecutar lógica de pago).

### 3. **Falta de rate limiting**

- **Dónde:** Toda la API, especialmente `POST /api/admin/login`.
- **Problema:** Sin límite de intentos se facilita fuerza bruta en el login y abuso de endpoints públicos.
- **Recomendación:** Añadir rate limiting (p. ej. `express-rate-limit`) en login y, si es posible, en el resto de la API.

### 4. **CORS con `origin: true` en producción**

- **Dónde:** `server/index.js` — `corsOrigin = process.env.ALLOWED_ORIGIN || true`.
- **Problema:** Si `ALLOWED_ORIGIN` no está definido se acepta cualquier origen. En producción es inseguro.
- **Recomendación:** En producción exigir `ALLOWED_ORIGIN` y no usar `true` como fallback.

### 5. **Interfaz `AdminStats` sin `totalStikers`**

- **Dónde:** `src/app/core/services/admin.service.ts` — interfaz `AdminStats`.
- **Problema:** El API devuelve `totalStikers` pero la interfaz solo define `totalOrders`, `totalStikersSold`, `totalRevenueCents`. No es un error de ejecución pero sí de tipado/consistencia.
- **Recomendación:** Añadir `totalStikers?: number` a `AdminStats` si el frontend lo usa.

---

## Malas prácticas y mejoras recomendadas

### 6. **JWT / contraseña admin**

- **Problema:** Si no se define `JWT_SECRET` se usa `'change-me-in-production'`. Aunque en producción se hace `process.exit(1)` si no está definido, en desarrollo el fallback es débil.
- **Recomendación:** Mantener el exit en producción y en desarrollo usar un valor por defecto solo para dev (p. ej. leyendo de una variable `NODE_ENV=development`).

### 7. **Logs con objetos completos**

- **Dónde:** Varios `console.error('...', err)` en el servidor.
- **Problema:** En producción, loguear el objeto `err` puede exponer stacks y datos sensibles.
- **Recomendación:** Loguear solo `err?.message` o un mensaje controlado; guardar el stack solo en entornos de desarrollo o en un logger con niveles.

### 8. **Nombre de variable engañoso en admin**

- **Dónde:** `src/app/pages/admin/admin.component.ts` — `config.precioStikerDollars`.
- **Problema:** La app usa COP; el nombre sugiere dólares.
- **Recomendación:** Renombrar a algo como `precioStikerUnidades` o `precioStikerDisplay` (valor para mostrar, ya sea COP u otra moneda).

### 9. **Uso de `alert()` en el panel admin**

- **Dónde:** `admin.component.ts` — p. ej. tras “Revisar beneficios”.
- **Problema:** `alert()` bloquea la UI y no es accesible.
- **Recomendación:** Mostrar el mensaje en el template (toast o mensaje inline) en lugar de `alert()`.

### 10. **Manejo de errores en servicios Angular**

- **Dónde:** `admin.service.ts` — en varios métodos se hace `of(null)` en catchError. El componente a veces no distingue bien “error de red” de “sin datos”.
- **Recomendación:** Devolver un tipo resultado (p. ej. `{ data, error }`) o propagar el error y mostrarlo en el componente para no ocultar fallos.

### 11. **`runBatch` en `db-pg.js` y regex frágil**

- **Dónde:** `server/db-pg.js` — construcción del SQL para batch insert.
- **Problema:** `sql.replace(/\s+VALUES\s+\([^)]*\).*$/i, '')` puede fallar con VALUES más complejos (paréntesis anidados).
- **Recomendación:** Mantener solo para el caso actual (VALUES con placeholders simples) y añadir un comentario; si en el futuro se generaliza, usar un parser o una API más explícita.

### 12. **Validación de entrada en backend**

- **Problema:** Algunos endpoints confían en que el cliente envía tipos correctos (números, strings). Por ejemplo, `amount` en checkout podría llegar como string.
- **Recomendación:** Validar y normalizar en el servidor (p. ej. `Number(amount)`, comprobar rangos y tipos) o usar un validador (Joi, Zod, etc.).

### 13. **Token de admin en `sessionStorage`**

- **Dónde:** `admin-auth.service.ts` — `sessionStorage.getItem(TOKEN_KEY)`.
- **Problema:** Si se abre el admin en varias pestañas, cada una tiene su propia sesión; al cerrar la pestaña se pierde el token (comportamiento a veces deseado, pero no hay documentación).
- **Recomendación:** Dejar como está si se quiere “sesión por pestaña” o documentarlo; si se prefiere persistencia entre pestañas, considerar `localStorage` (con cuidado ante XSS).

### 14. **Dependencias en root y en `server`**

- **Dónde:** `package.json` raíz incluye `pg`, `stripe`, `express`, etc., aunque el backend real está en `server/`.
- **Problema:** Duplicación y posible confusión sobre dónde se ejecuta el backend.
- **Recomendación:** Dejar en el raíz solo lo necesario para el frontend (Angular) y scripts de workspace; que todas las deps del API estén en `server/package.json`.

---

## Resumen

| Tipo              | Cantidad | Acción principal                          |
|-------------------|----------|-------------------------------------------|
| Bug crítico       | 1        | Corregido (RETURNING id en config)        |
| Riesgos seguridad | 2        | Webhook sin secreto; CORS en producción  |
| Mejoras seguridad | 1       | Rate limiting                             |
| Malas prácticas  | Varias   | Logs, validación, nombres, alert, deps    |

Prioridad sugerida: aplicar las correcciones de seguridad (webhook, CORS, rate limiting) y luego las mejoras de robustez y mantenibilidad (validación, logs, nombres y UX del admin).
