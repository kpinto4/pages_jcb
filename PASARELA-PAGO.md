# Guía: Pasarela de pago (Stripe)

Esta guía explica cómo poner en marcha la pasarela de pago del **Juego de la Ciudad Bonita** y qué necesitas para que sea funcional en desarrollo y en producción.

---

## Resumen del flujo

1. El usuario selecciona stikers, introduce sus datos y pulsa **"Pagar con tarjeta (Stripe)"**.
2. El frontend (Angular) envía los datos del pedido al **backend** (Node/Express en la carpeta `server/`).
3. El backend crea una **sesión de Stripe Checkout** y devuelve una URL.
4. El usuario es **redirigido** a la página de pago de Stripe (tarjeta, etc.).
5. Tras pagar, Stripe redirige de vuelta a tu app a `/comprar-stikers?success=true&session_id=...`.
6. La app muestra la página de **éxito** y, opcionalmente, obtiene los detalles de la sesión desde el backend.

---

## Qué necesitas

### 1. Cuenta en Stripe

- Regístrate en [Stripe](https://stripe.com).
- En el [Dashboard](https://dashboard.stripe.com) entra en **Developers → API keys**.
- Usa las claves de **test** para desarrollo:
  - **Secret key** (empieza por `sk_test_...`): solo en el backend, **nunca** en el frontend.
  - **Publishable key** (opcional para este flujo): si más adelante usas Stripe.js en el frontend.

### 2. Backend (servidor Node)

La pasarela depende de un backend que:

- Reciba el pedido desde Angular.
- Cree la sesión de Checkout con la **Secret key** de Stripe.
- Devuelva la URL de pago y, opcionalmente, los detalles de la sesión para la página de éxito.

En este proyecto el backend está en la carpeta **`server/`**.

---

## Implementación paso a paso

### Paso 1: Configurar el backend (servidor de pago)

1. Entra en la carpeta del servidor:
   ```bash
   cd server
   ```

2. Instala dependencias:
   ```bash
   npm install
   ```

3. Crea el archivo de entorno con tu clave secreta de Stripe:
   ```bash
   cp .env.example .env
   ```
   Edita `server/.env` y rellena:
   ```env
   PORT=3000
   <!-- STRIPE_SECRET_KEY -->
   ```
   Sustituye `sk_test_...` por tu **Secret key** de Stripe (modo test).

4. Arranca el servidor:
   ```bash
   npm start
   ```
   Para desarrollo con recarga al cambiar código:
   ```bash
   npm run dev
   ```
   Debe quedar escuchando en `http://localhost:3000`.

### Paso 2: Configurar el frontend (Angular)

1. La URL del backend ya está configurada en **desarrollo** en:
   - `src/environments/environment.ts`  
   - `paymentApiUrl: 'http://localhost:3000'`

2. Para **producción** edita:
   - `src/environments/environment.prod.ts`  
   - y pon la URL real de tu backend, por ejemplo:
     ```ts
     paymentApiUrl: 'https://api.tudominio.com'
     ```

3. Arranca la app Angular:
   ```bash
   ng serve
   ```
   Abre `http://localhost:4200`, ve a **Comprar stikers**, completa los pasos y en el paso de pago usa **"Pagar con tarjeta (Stripe)"**.

### Paso 3: Probar el pago (modo test)

1. Con el backend en `http://localhost:3000` y Angular en `http://localhost:4200`:
   - Selecciona stikers, datos del comprador y en el paso 3 pulsa **"Pagar con tarjeta (Stripe)"**.
   - Deberías ser redirigido a Stripe Checkout.

2. En **test**, Stripe acepta tarjetas de prueba, por ejemplo:
   - Número: `4242 4242 4242 4242`
   - Fecha: cualquier fecha futura
   - CVC: cualquier 3 dígitos
   - Más tarjetas: [Stripe - Tarjetas de prueba](https://stripe.com/docs/testing#cards)

3. Tras completar el pago, Stripe te redirige a tu app y se muestra la página de éxito.

---

## Estructura de archivos relevantes

```
pages_jcb/
├── server/                    # Backend de pago
│   ├── index.js               # Endpoints: crear sesión, obtener sesión, health
│   ├── package.json
│   ├── .env.example
│   └── .env                   # Crea desde .env.example (STRIPE_SECRET_KEY)
├── src/
│   ├── environments/
│   │   ├── environment.ts     # paymentApiUrl desarrollo (localhost:3000)
│   │   └── environment.prod.ts # paymentApiUrl producción
│   └── app/
│       ├── core/services/
│       │   └── payment.service.ts  # Llamadas al backend (createCheckoutSession, getSessionDetails)
│       └── pages/comprar-stikers/
│           ├── comprar-stikers.component.ts  # Flujo de compra e integración con PaymentService
│           └── ...
└── PASARELA-PAGO.md           # Esta guía
```

---

## Endpoints del backend

El backend usa **SQLite** (`server/data.db`) para órdenes, ítems y stikers. Al arrancar crea las tablas y rellena ~300 stikers si la base está vacía.

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET    | `/api/stikers`                | Lista stikers con `numeroA`, `numeroB`, `estado` (libre/ocupado). Opcional: `?limit=200`. |
| GET    | `/api/boletas?cedula=XXX`     | Boletas asociadas a una cédula (para Verificar boleta). |
| POST   | `/api/create-checkout-session` | Crea sesión Stripe; body incluye `selectedStikers` (array de `{ numeroA, numeroB }`), reserva stikers y crea orden en estado `pending`. Devuelve `{ url, sessionId }`. |
| GET    | `/api/session/:sessionId`     | Detalles de una sesión pagada (para la página de éxito). |
| POST   | `/api/webhooks/stripe`        | Webhook Stripe: al recibir `checkout.session.completed` marca la orden como `paid`. Configura `STRIPE_WEBHOOK_SECRET` en `.env`. |
| GET    | `/api/admin/orders`           | Lista últimas órdenes (`?limit=50`). |
| GET    | `/api/admin/stats`            | Estadísticas: total órdenes pagadas, stikers vendidos, ingresos. |
| GET    | `/api/health`                 | Estado del servidor (ok, stripe, db). |

---

## Producción

1. **Backend en un servidor**
   - Despliega la carpeta `server/` en un VPS, Railway, Render, etc.
   - Configura la variable de entorno `STRIPE_SECRET_KEY` con tu clave **live** (`sk_live_...`) en el panel del proveedor.
   - Deja que el backend escuche en el puerto que te asigne el host (a menudo mediante `PORT`).

2. **CORS**
   - El backend usa `cors({ origin: true })`. En producción conviene restringir `origin` a tu dominio frontend, por ejemplo:
     ```js
     cors({ origin: 'https://tudominio.com' })
     ```

3. **Frontend**
   - En `src/environments/environment.prod.ts` pon la URL pública de tu backend en `paymentApiUrl`.
   - Genera el build: `ng build --configuration production`.

4. **Stripe en vivo**
   - En el Dashboard de Stripe cambia a **modo live** y usa las claves `sk_live_...` y `pk_live_...` donde corresponda.
   - Configura **Webhooks** si en el futuro quieres confirmar pagos o actualizar estado en tu base de datos al recibir eventos de Stripe.

---

## Botón "Simular pago (demo)"

Si no tienes el backend encendido o no quieres usar Stripe en ese momento, en el paso de pago puedes usar **"Simular pago (demo)"**. No se hace ninguna llamada a Stripe ni al backend; la app simula el éxito y muestra la pantalla de confirmación. Úsalo solo para pruebas de interfaz.

---

## Solución de problemas

- **"No se pudo conectar con el servidor de pago"**  
  Comprueba que el backend esté corriendo en la URL configurada en `environment.paymentApiUrl` y que no haya firewall bloqueando (por ejemplo, que `http://localhost:3000` sea accesible desde el navegador o desde la app).

- **"STRIPE_SECRET_KEY no configurada"**  
  Crea `server/.env` desde `server/.env.example` y asigna tu clave secreta de Stripe.

- **CORS**  
  Si la petición desde Angular falla por CORS, revisa que el backend permita el origen de tu frontend (en desarrollo, `http://localhost:4200`).

- **Redirect tras el pago**  
  Stripe redirige a las URLs que envías en `successUrl` y `cancelUrl`. El backend las construye con el `origin` que envía el frontend; en local debe ser `http://localhost:4200` para que vuelvas a la misma app.

---

## Resumen rápido

1. Crear cuenta Stripe y copiar **Secret key** (test).
2. En `server/`: `npm install`, crear `.env` con `STRIPE_SECRET_KEY`, ejecutar `npm start`.
3. En la raíz del proyecto: `ng serve`.
4. En la app: Comprar stikers → Paso 3 → **"Pagar con tarjeta (Stripe)"** y usar tarjeta de prueba `4242 4242 4242 4242`.
5. Para producción: desplegar `server/` con clave live, configurar `environment.prod.ts` y CORS.

Con esto la pasarela queda funcional en desarrollo y lista para conectarla a producción cuando tengas backend y dominio definidos.
