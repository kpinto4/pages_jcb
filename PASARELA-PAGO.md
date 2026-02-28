# Guía: Pasarela de pago

Esta guía explica el flujo de pago del **Juego de la Ciudad Bonita**. Actualmente **Stripe está en pausa**; se usará **Wompi** para pagos con tarjeta en Colombia. Mientras tanto, en la pantalla de pago está disponible **"Simular pago (pruebas)"** para probar el flujo sin pasarela real.

---

## Resumen del flujo (cuando la pasarela esté activa)

1. El usuario selecciona stikers, introduce sus datos y pulsa **"Pagar con tarjeta"** (próximamente Wompi).
2. El frontend envía los datos del pedido al **backend** (Node/Express en `server/`).
3. El backend crea la sesión con la pasarela y devuelve una URL (o redirección).
4. Tras pagar, la app muestra la página de **éxito** y los detalles desde el backend.

---

## Qué necesitas (para cuando integres Wompi)

- Cuenta en [Wompi](https://wompi.co) y llaves de **Sandbox** para pruebas.
- En el backend: variables de entorno con las credenciales de Wompi (cuando se implemente).
- El backend en `server/` ya tiene las rutas `POST /api/create-checkout-session` y `GET /api/session/:sessionId`; sin Stripe configurado responden 503 y la app muestra "Simular pago" para pruebas.

---

## Implementación paso a paso

### Paso 1: Backend (servidor de pago)

1. En `server/` configura `.env` con `DATABASE_URL` (PostgreSQL), `ADMIN_PASSWORD`, etc. (ver `server/.env.example`).
2. Opcional: si quieres usar Stripe de nuevo, define `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET` en `.env`. Si no, el botón "Pagar con tarjeta" mostrará mensaje de mantenimiento y podrás usar **"Simular pago (pruebas)"**.
3. Arranca el servidor:
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

3. Arranca la app Angular (`ng serve`). Abre `http://localhost:4200`, ve a **Comprar stikers** y en el paso de pago usa **"Simular pago (pruebas)"** para probar sin pasarela real.

### Probar el pago (ahora y con Wompi)

- **Ahora:** Usa **"Simular pago (pruebas)"** para completar el flujo y ver la pantalla de éxito sin cobro real.
- **Con Wompi (Sandbox):** Cuando integres Wompi, en pruebas podrás usar tarjetas como `4242 4242 4242 4242` (aprobado) o `4111 1111 1111 1111` (declinado). Ver [Wompi - Datos de prueba](https://docs.wompi.co/docs/colombia/datos-de-prueba-en-sandbox/).

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

El backend usa **PostgreSQL** para órdenes, ítems y stikers. El esquema está en `server/schema-supabase.sql`. Si `stiker_slots` está vacía, al crear un Premio Mayor se rellenan 5000 stikers.

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET    | `/api/stikers`                | Lista stikers con `numeroA`, `numeroB`, `estado` (libre/ocupado). Opcional: `?limit=200`. |
| GET    | `/api/verificar-stikers?cedula=XXX`     | Stikers asociados a una cédula (para Verificar stiker). |
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

4. **Pasarela en producción**  
   Cuando integres **Wompi** (u otra pasarela), configura las credenciales en `server/.env` y adapta las rutas de checkout/sesión en el backend si es necesario.

---

## Botón "Simular pago (pruebas)"

En el paso de pago puedes usar **"Simular pago (pruebas)"** para completar el flujo sin pasarela real. No se crea orden en el backend ni se cobra; la app muestra la pantalla de éxito. Úsalo para pruebas de interfaz y flujo mientras la pasarela (Wompi) no esté integrada.

---

## Solución de problemas

- **"No se pudo conectar con el servidor de pago"**  
  Comprueba que el backend esté corriendo en la URL configurada en `environment.paymentApiUrl` y que no haya firewall bloqueando (por ejemplo, que `http://localhost:3000` sea accesible desde el navegador o desde la app).

- **"Pagos con tarjeta en mantenimiento"**  
  El backend no tiene pasarela configurada (Stripe en pausa). Usa **"Simular pago (pruebas)"** o configura Wompi cuando esté integrado.

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
