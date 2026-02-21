# Cómo funciona todo: Backend y Frontend

Guía del proyecto **Juego de la Ciudad Bonita**: qué hace cada parte y cómo se conectan el servidor y la aplicación web.

---

## 1. Resumen del proyecto

- **Frontend:** aplicación Angular (SPA) que muestra la web del juego: inicio, premios, compra de stikers, verificación de stikers y panel de administración.
- **Backend:** servidor Node.js + Express que guarda datos en SQLite, crea pagos con Stripe y protege las rutas de admin con login (JWT).
- **Comunicación:** el frontend llama al backend por HTTP (la URL se configura en `src/environments/environment.ts`; en desarrollo suele ser `http://localhost:3000`).

---

## 2. Backend

### 2.1 Tecnologías

- **Node.js** + **Express**
- **SQLite** (better-sqlite3), archivo `server/data.db`
- **Stripe** (pagos)
- **JWT** (jsonwebtoken) para el login del admin
- Variables de entorno en `server/.env` (ver `server/.env.example`)

### 2.2 Base de datos (SQLite)

Archivo: `server/data.db` (se crea al iniciar si no existe).

| Tabla | Uso |
|-------|-----|
| **orders** | Cada compra: cedula, nombre, email, telefono, total_cents, currency, status (pending/paid), stripe_session_id. |
| **order_items** | Números comprados por orden: order_id, numero_a, numero_b. |
| **stiker_slots** | Catálogo de stikers (numero_a, numero_b). Si `order_id` es NULL está libre; si tiene valor está vendido/reservado. |
| **sorteos** | Sorteos: nombre, fecha, descripcion, tipo (anticipado/mayor), estado (programado/realizado), premio_descripcion, numero_ganador_a/b. |
| **config** | Clave-valor: precio_stiker_cents, currency, etc. |

Al arrancar el servidor se ejecutan migraciones y seeds (por ejemplo 300 stikers y sorteos por defecto si las tablas están vacías).

### 2.3 Rutas del backend

**Públicas (sin login):**

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/stikers` | Lista stikers con numeroA, numeroB, estado (libre/ocupado). |
| GET | `/api/verificar-stikers?cedula=XXX` | Stikers asociados a una cédula. |
| GET | `/api/config` | Precio por stiker (centavos) y moneda para la tienda. |
| GET | `/api/sorteos` | Lista de sorteos (para la sección Premios). |
| GET | `/api/sorteos/:id` | Detalle de un sorteo. |
| POST | `/api/create-checkout-session` | Crea sesión Stripe Checkout, reserva stikers y crea orden en pending. Body: amount, customerEmail, selectedStikers, metadata, successUrl, cancelUrl. |
| GET | `/api/session/:sessionId` | Detalles de una sesión de pago completada. |
| POST | `/api/webhooks/stripe` | Webhook Stripe: al recibir `checkout.session.completed` marca la orden como paid. |
| GET | `/api/health` | Estado del servidor. |
| POST | `/api/admin/login` | Login admin: body `{ "password": "..." }`. Si coincide con ADMIN_PASSWORD devuelve `{ "token": "JWT..." }`. |

**Protegidas (requieren `Authorization: Bearer <token>`):**

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/admin/config` | Lee config (precio, moneda). |
| PATCH | `/api/admin/config` | Actualiza config (precioStikerCents, currency). |
| GET | `/api/admin/orders` | Lista últimas órdenes. |
| GET | `/api/admin/stats` | Estadísticas: órdenes pagadas, stikers vendidos, ingresos. |
| POST | `/api/admin/sorteos` | Crea sorteo (nombre, fecha, descripcion, tipo, premio_descripcion). |
| PATCH | `/api/admin/sorteos/:id` | Edita sorteo. |
| POST | `/api/admin/sorteos/:id/realizar` | Realiza sorteo: elige un ganador al azar entre stikers vendidos y marca sorteo como realizado. |

El middleware de admin comprueba el JWT en todas las rutas bajo `/api/admin` excepto `POST /api/admin/login`. Si el token falta o es inválido/expirado responde 401.

### 2.4 Flujos importantes en el backend

- **Compra:** El frontend envía a `POST /api/create-checkout-session` los stikers elegidos y datos del cliente. El backend comprueba que esos stikers estén libres, crea la orden (pending), inserta en `order_items`, actualiza `stiker_slots` con el `order_id`, crea la sesión en Stripe y devuelve la URL. Cuando el usuario paga, Stripe redirige a la web y opcionalmente llama al webhook; el webhook pone la orden en `paid`.
- **Verificar stiker:** `GET /api/verificar-stikers?cedula=XXX` busca órdenes por cédula y para cada una los ítems en `order_items`; devuelve lista de stikers con codigo, numero1, numero2, pagado (según status de la orden).
- **Sorteos:** Los sorteos se listan con `GET /api/sorteos`. Al “realizar” un sorteo (`POST .../realizar`) se elige al azar un ítem entre los de órdenes pagadas y se guarda como ganador en ese sorteo.

### 2.5 Archivos del backend

| Archivo | Función |
|---------|---------|
| `server/index.js` | Express: CORS, login, middleware admin, todas las rutas (stikers, verificar-stikers, config, checkout, session, webhook, admin). |
| `server/db.js` | Conexión SQLite, creación de tablas, migraciones, seeds (stikers, sorteos, config). |
| `server/.env` | Variables: PORT, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, ADMIN_PASSWORD, JWT_SECRET, SQLITE_PATH. |
| `server/package.json` | Dependencias: express, cors, stripe, better-sqlite3, jsonwebtoken, dotenv. |

---

## 3. Frontend

### 3.1 Tecnologías

- **Angular 19** (standalone components)
- **SCSS** para estilos
- **HttpClient** para llamar al backend
- Variables de entorno en `src/environments/environment.ts` y `environment.prod.ts` (por ejemplo `paymentApiUrl`)

### 3.2 Estructura de la app

```
src/app/
├── app.component.ts/html     → Shell: navbar + <router-outlet> + footer
├── app.config.ts              → provideRouter, provideHttpClient, interceptor admin
├── app.routes.ts               → Rutas: '', 'comprar-stikers', 'verificar-stiker', 'admin'
├── core/
│   ├── interceptors/
│   │   └── admin-auth.interceptor.ts  → Añade Bearer token a peticiones /api/admin; en 401 hace logout
│   └── services/
│       ├── payment.service.ts  → getConfig, getStikers, getStikersPorCedula, getSorteos, createCheckoutSession, getSessionDetails, healthCheck
│       ├── admin.service.ts     → getStats, getOrders, getSorteos, createSorteo, realizarSorteo, getConfig, updateConfig
│       └── admin-auth.service.ts → login(password), logout(), getToken(), isLoggedIn(); token en sessionStorage
├── shared/
│   ├── navbar/                 → Logo, enlaces (Inicio, Verificar stiker, Comprar stiker), menú hamburguesa en móvil
│   └── footer/                 → Logo, enlaces, contacto, copyright
└── pages/
    ├── home/                   → Hero (contador, progreso, botón comprar), Premios, Cómo participar
    ├── hero-rifa/              → Bloque hero con imagen, título, CTA y countdown
    ├── premios/                → Lista de sorteos desde GET /api/sorteos (o tarjetas estáticas si no hay backend)
    ├── como-participar/        → Pasos: elegir stikers, pagar, esperar sorteo
    ├── comprar-stikers/        → Flujo en 4 pasos: selección, datos, pago (Stripe o simulación), confirmación
    ├── verificar-boleta/       → Formulario cédula → GET /api/verificar-stikers → lista de stikers
    └── admin/                  → Login (contraseña) y panel: Estadísticas, Ventas, Sorteos, Configuración
```

### 3.3 Rutas (Frontend)

| Ruta | Componente | Descripción |
|------|------------|-------------|
| `/` | HomeComponent | Inicio: hero, premios, cómo participar. |
| `/comprar-stikers` | ComprarStikersComponent | Compra de stikers en 4 pasos; redirección a Stripe o simulación. |
| `/verificar-stiker` | VerificarStikerComponent | Consulta de stikers por cédula. |
| `/admin` | AdminComponent | Login y panel admin (stats, ventas, sorteos, config). |

Todas las rutas comparten el mismo layout: navbar arriba y footer abajo (definidos en `app.component.html`).

### 3.4 Servicios y uso del backend

- **PaymentService** (`core/services/payment.service.ts`):  
  Usa `environment.paymentApiUrl` para todas las llamadas “públicas”: `getConfig()`, `getStikers()`, `getStikersPorCedula()`, `getSorteos()`, `createCheckoutSession()`, `getSessionDetails()`, `healthCheck()`. No envían token.

- **AdminService** (`core/services/admin.service.ts`):  
  Llama solo rutas bajo `/api/admin` (config, orders, stats, sorteos CRUD, realizar). El **interceptor** añade automáticamente `Authorization: Bearer <token>` a estas peticiones. Si la respuesta es 401, el interceptor llama a `AdminAuthService.logout()`.

- **AdminAuthService** (`core/services/admin-auth.service.ts`):  
  `login(password)` → POST `/api/admin/login`; si la respuesta trae `token`, lo guarda en `sessionStorage`. `logout()` borra el token. `getToken()` e `isLoggedIn()` se usan para mostrar u ocultar el panel y para que el interceptor envíe el Bearer.

### 3.5 Flujos principales en el frontend

**Comprar stikers**

1. Al cargar la página se llama a `getConfig()` y `getStikers()` (precio y lista de números).
2. El usuario elige stikers, pasa al paso 2 (datos) y luego al paso 3 (pago).
3. En “Pagar con tarjeta (Stripe)” se llama a `createCheckoutSession()` con total, email, selectedStikers y metadata; el backend devuelve la URL de Stripe y el frontend hace `window.location.href = url`.
4. Tras pagar, Stripe redirige a `/comprar-stikers?success=true&session_id=...`. El componente lee los query params, llama a `getSessionDetails(sessionId)` y muestra la pantalla de éxito. Si el usuario cancela, vuelve con `?canceled=true` y se muestra el mensaje correspondiente.

**Verificar stiker**

1. El usuario escribe la cédula y envía el formulario.
2. Se llama a `getStikersPorCedula(cedula)`.
3. Se muestran los stikers (código, números, Pagado/Pendiente).

**Admin**

1. Al entrar en `/admin`, si no hay token se muestra la pantalla de login (contraseña).
2. Al enviar la contraseña se llama a `AdminAuthService.login(password)` → POST `/api/admin/login`. Si devuelve token, se guarda y se muestra el panel; se cargan stats, orders, sorteos y config.
3. Cualquier petición a `/api/admin` lleva el Bearer token por el interceptor. Si el backend responde 401, el interceptor hace logout y el componente puede volver a mostrar el login.
4. “Cerrar sesión” llama a `logout()` y oculta el panel.

### 3.6 Variables de entorno (Frontend)

- **Desarrollo:** `src/environments/environment.ts` → `paymentApiUrl: 'http://localhost:3000'`.
- **Producción:** `src/environments/environment.prod.ts` → `paymentApiUrl` con la URL real del backend.  
El build de producción sustituye el archivo de environment mediante `fileReplacements` en `angular.json`.

---

## 4. Cómo encaja todo

1. El usuario usa solo el frontend (Angular) en el navegador.
2. Las acciones que requieren datos o pagos hacen peticiones HTTP al backend (Express) usando `paymentApiUrl`.
3. El backend lee y escribe en SQLite, habla con Stripe para el cobro y opcionalmente con el webhook para marcar órdenes como pagadas.
4. El admin está protegido: solo quien conoce `ADMIN_PASSWORD` puede obtener un JWT; el resto de rutas `/api/admin` exigen ese token y el frontend lo envía con el interceptor y lo guarda en sesión hasta cerrar sesión o 401.

Para poner todo en marcha: configurar `server/.env` (Stripe, ADMIN_PASSWORD, etc.), ejecutar el servidor en el puerto configurado (por ejemplo 3000) y la app Angular con `ng serve` (por ejemplo en 4200), con `paymentApiUrl` apuntando a ese servidor.
