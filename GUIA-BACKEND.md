# Guía: Cómo funciona el backend

Esta guía explica cómo está hecho el backend del **Juego de la Ciudad Bonita** y, sobre todo, **cómo se guardan los números (stikers) que ya compraron las personas**.

---

## 1. Visión general

El backend es un servidor **Node.js + Express** que:

- Guarda todo en una base de datos **SQLite** (archivo `server/data.db`).
- Ofrece APIs para: listar stikers, verificar stikers por cédula, crear pagos con Stripe y recibir webhooks.
- **Regla importante:** un stiker (par de números) está **vendido** cuando en la base de datos está vinculado a una orden y esa orden puede estar en estado **pending** (reservada, aún no pagó) o **paid** (ya pagó).

---

## 2. Base de datos: las 3 tablas

### `stiker_slots` — Catálogo de todos los stikers

Cada fila es **un stiker**: un par de números de 4 cifras (`numero_a`, `numero_b`).

| Columna    | Descripción |
|-----------|-------------|
| `id`      | Identificador interno. |
| `numero_a`| Primer número (ej. `"1234"`). |
| `numero_b`| Segundo número (ej. `"5678"`). |
| `order_id`| **Si es NULL → el stiker está libre.** Si tiene un valor → está reservado o vendido (asociado a esa orden). |

**Cómo se sabe si un número ya se compró:**  
Si `order_id` **no es NULL**, ese par de números ya está asignado a una compra (reservada o pagada). En la API de stikers se devuelve como `estado: 'ocupado'`.

Al arrancar el servidor, si la tabla está vacía, se crean 300 stikers con pares de números aleatorios.

---

### `orders` — Cada compra (una por intención de pago)

Una fila por compra: datos del comprador y estado del pago.

| Columna            | Descripción |
|--------------------|-------------|
| `id`               | UUID de la orden (ej. `a1b2c3d4-...`). |
| `stripe_session_id`| ID de la sesión de Stripe (cuando existe). |
| `cedula`           | Cédula del comprador (para verificar stikers). |
| `nombre`           | Nombre del comprador. |
| `email`            | Correo. |
| `telefono`         | Teléfono (opcional). |
| `total_cents`       | Total en centavos. |
| `currency`         | Moneda (ej. `usd`). |
| `status`           | **`pending`** = reservado, aún no pagó. **`paid`** = ya pagó (Stripe confirmó). |
| `created_at`       | Fecha de creación. |

Aquí se guardan **las personas** (cedula, nombre, email, etc.) y el estado de la compra. Los **números concretos** que compraron van en `order_items` y en `stiker_slots`.

---

### `order_items` — Qué números tiene cada orden

Cada fila es **un stiker dentro de una compra**: qué par de números pertenece a qué orden.

| Columna   | Descripción |
|-----------|-------------|
| `id`      | Identificador interno. |
| `order_id`| A qué orden pertenece (referencia a `orders.id`). |
| `numero_a`| Primer número de ese stiker. |
| `numero_b`| Segundo número. |

Así, para una orden con 3 stikers hay 3 filas en `order_items` con el mismo `order_id`. Esto es lo que se usa para “qué números compró esta persona” y para mostrar los stikers al verificar por cédula.

---

## 3. Cómo se guardan los números que ya compraron

Resumen en tres ideas:

1. **Catálogo:** `stiker_slots` tiene todos los pares (numero_a, numero_b). Si `order_id` es NULL → libre; si tiene valor → **ese número ya está comprado (o reservado)**.
2. **Quién compró qué:** En `orders` está la persona (cedula, nombre, email…) y en `order_items` están los pares (numero_a, numero_b) de esa orden.
3. **Estado del pago:** En `orders.status`: `pending` = reservado, `paid` = ya pagó. Al verificar stikers se usa este campo para mostrar “Pagado” o “Pendiente”.

Flujo paso a paso:

```
Usuario elige stikers en la web
        ↓
Frontend llama POST /api/create-checkout-session con selectedStikers
        ↓
Backend:
  1. Comprueba que esos (numero_a, numero_b) en stiker_slots tengan order_id NULL.
  2. Crea una fila en orders (status = 'pending').
  3. Crea una fila en order_items por cada stiker (order_id, numero_a, numero_b).
  4. Actualiza stiker_slots: pone order_id = esa orden en cada par elegido.
        ↓
Usuario paga en Stripe
        ↓
Stripe envía webhook checkout.session.completed (o el usuario vuelve a la web)
        ↓
Backend (webhook): UPDATE orders SET status = 'paid' WHERE id = orderId
```

Desde ese momento, esos stikers siguen con `order_id` rellenado y la orden en `paid`, así que **quedan guardados como “números ya comprados”** y dejan de salir como disponibles en `/api/stikers`.

---

## 4. Cómo “Verificar stiker” sabe qué compró una persona

La pantalla **Verificar stiker** pide la **cédula** y llama a:

```
GET /api/verificar-stikers?cedula=1234567890
```

En el backend se hace:

1. Buscar en `orders` todas las órdenes con esa `cedula`.
2. Para cada orden, buscar en `order_items` los pares (numero_a, numero_b).
3. Devolver una “stiker” por cada ítem: código (derivado del order id), numero1/numero2, y si está **pagado** según `orders.status === 'paid'`.

Así, los números que ves en Verificar stiker son exactamente los guardados en `order_items` para las órdenes de esa cédula; el estado “Pagado”/“Pendiente” viene de cómo está guardado el pago en `orders`.

---

## 5. Resumen visual

```
stiker_slots                    orders                      order_items
─────────────────────────────────────────────────────────────────────────
id  numero_a  numero_b  order_id    id (UUID)  cedula  status     order_id  numero_a  numero_b
1   1234      5678      NULL    →   libre       -        -            -         -         -
2   2234      6678      abc-123 →   abc-123  111111   paid        abc-123   2234      6678
3   3001      4002      abc-123 →   (misma orden)                  abc-123   3001      4002
```

- Los números **1234-5678** siguen libres (`order_id` NULL).
- Los números **2234-6678** y **3001-4002** están comprados: tienen `order_id = abc-123` y esa orden está en `orders` con `status = 'paid'` y la cédula de la persona. Por eso aparecen al verificar por cédula y no vuelven a salir como disponibles.

---

## 6. Archivos del backend

| Archivo      | Qué hace |
|-------------|----------|
| `server/db.js`   | Crea la base SQLite, las tablas (`orders`, `order_items`, `stiker_slots`) y el seed de stikers. |
| `server/index.js`| Express: rutas `/api/stikers`, `/api/verificar-stikers`, `/api/create-checkout-session`, `/api/session/...`, `/api/webhooks/stripe`, etc. |
| `server/data.db` | Base SQLite (se crea al iniciar; no subir a git). |

Con esta guía tienes claro cómo el backend guarda y usa los números de las personas que ya compraron: por la relación entre `stiker_slots.order_id`, `orders` y `order_items`.
