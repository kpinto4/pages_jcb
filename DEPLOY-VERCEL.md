# Desplegar en Vercel

## Requisitos

1. **Cuenta en [Supabase](https://supabase.com)** (gratis) para la base de datos.
2. **Cuenta en [Vercel](https://vercel.com)**.
3. Variables de entorno de Stripe y admin (ver más abajo).

## Pasos

### 1. Crear proyecto en Supabase

1. Entra en [supabase.com](https://supabase.com) y crea un proyecto.
2. En **Project Settings → Database** copia la **Connection string** (URI), modo “Transaction” o “Session”.
3. En **SQL Editor** ejecuta el contenido del archivo **`server/schema-supabase.sql`** (crea tablas e índices).

### 2. Subir el código a GitHub

Asegúrate de que el repositorio tenga todos los cambios y esté en GitHub (o GitLab/Bitbucket).

### 3. Importar el proyecto en Vercel

1. En [vercel.com](https://vercel.com) → **Add New → Project**.
2. Importa el repositorio del proyecto.
3. **Framework Preset**: si Vercel lo detecta, deja Angular; si no, elige “Other”.
4. **Root Directory**: raíz del repo (por defecto).
5. **Build Command**: `npm run build`
6. **Output Directory**: `dist/pages_jcb/browser`
7. **Install Command**: `npm run vercel-install` (instala raíz + `server/`)

### 4. Variables de entorno en Vercel

En el proyecto de Vercel → **Settings → Environment Variables** añade:

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `DATABASE_URL` | Connection string de Supabase (URI) | `postgresql://postgres:xxx@db.xxx.supabase.co:5432/postgres` |
| `STRIPE_SECRET_KEY` | Clave secreta de Stripe | `sk_live_...` o `sk_test_...` |
| `STRIPE_WEBHOOK_SECRET` | Secreto del webhook de Stripe | `whsec_...` |
| `ADMIN_PASSWORD` | Contraseña del panel admin | (la que elijas) |
| `JWT_SECRET` | Secreto para JWT (opcional) | (string aleatorio) |

Para el webhook de Stripe, en el Dashboard de Stripe añade un endpoint con la URL:

`https://tu-dominio.vercel.app/api/webhooks/stripe`

y copia el **Signing secret** en `STRIPE_WEBHOOK_SECRET`.

### 5. Desplegar

Haz **Deploy**. En cada push a la rama principal, Vercel volverá a desplegar.

**Importante:** Si añades o cambias variables de entorno después del primer deploy, haz un **nuevo deploy** (Redeploy) para que las funciones serverless las reciban.

---

## Panel de administración (login)

### Qué necesitas

1. **Variable `ADMIN_PASSWORD`** en Vercel (Settings → Environment Variables), con el valor exacto que quieras usar como contraseña del panel. Sin espacios extra al inicio/final.
2. Tras añadir o cambiar `ADMIN_PASSWORD`, **Redeploy** el proyecto para que la función `/api` use la nueva variable.

### Comprobar que la API y el admin están configurados

Abre en el navegador (sustituye por tu URL de Vercel):

- **`https://tu-proyecto.vercel.app/api/health`**

Deberías ver algo como:

```json
{ "ok": true, "adminConfigured": true, "hasDatabase": true }
```

- Si `adminConfigured` es **false**: la variable `ADMIN_PASSWORD` no está definida o el deploy no se hizo después de añadirla. Añádela en Vercel y vuelve a desplegar.
- Si la página no carga o da error: la API no está respondiendo (revisa el deploy o la ruta).

### Si no te deja entrar con la contraseña

1. **Error 503** o mensaje "Admin no configurado": falta `ADMIN_PASSWORD` en Vercel o hace falta **Redeploy**.
2. **Error 401** o "Contraseña incorrecta": la contraseña que escribes no coincide exactamente con `ADMIN_PASSWORD` (mayúsculas/minúsculas, espacios).
3. En el navegador: F12 → pestaña **Red** → intenta entrar al admin y mira la petición a `api/admin/login`. Revisa el **status** (401, 503, 500) y el cuerpo de la respuesta para saber si es problema de variable o de contraseña.

### 6. Dominio

- Por defecto tendrás una URL tipo `tu-proyecto.vercel.app`.
- En **Settings → Domains** puedes añadir tu dominio propio.

## Frontend y API

- La app Angular se sirve en la raíz.
- El backend Express se ejecuta como función serverless en `/api/*`.
- El frontend en producción usa la misma origen, así que las peticiones a la API van a `/api/...` sin configurar otra URL.

## Imagen del premio mayor

En Vercel no hay disco persistente. Al crear un **Premio Mayor** usa la opción **URL de imagen** (pega el enlace de la imagen subida a Supabase Storage, Imgur, Cloudinary, etc.). La subida de archivo desde el admin puede no persistir en serverless; para producción es más seguro usar siempre una URL externa.

## Local con Supabase (opcional)

Para probar en local con la misma base que en Vercel:

1. Crea un `.env` en la carpeta `server/` (o en la raíz, según cómo cargues `dotenv`).
2. Añade `DATABASE_URL` con la connection string de Supabase.
3. Ejecuta el servidor: `cd server && node index.js`.
4. El frontend sigue en `ng serve` y debe apuntar a `http://localhost:3000` (ya configurado en `environment.ts`).

## Resumen de archivos útiles

- **`server/schema-supabase.sql`**: script para crear las tablas en Supabase.
- **`vercel.json`**: configuración de build, rutas y rewrites para Vercel.
- **`api/index.js`**: entrada serverless que usa el Express del backend.
- **`GET /api/health`**: devuelve `ok`, `adminConfigured` y `hasDatabase` para comprobar que la API y las variables de entorno responden.
