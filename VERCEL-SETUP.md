# Checklist: que todo funcione en Vercel (incluido el panel de admin)

Sigue este orden al crear un **nuevo** proyecto en Vercel.

---

## 1. Base de datos (Neon o Supabase)

- [ ] Proyecto creado en [Neon](https://neon.tech) o [Supabase](https://supabase.com).
- [ ] Copia la **Connection string** (usa la URL con **pooler** en Neon: `-pooler` en el host).
- [ ] En el **SQL Editor** ejecuta todo el contenido de **`server/schema-supabase.sql`**.

---

## 2. Desarrollo local (opcional)

Para probar el backend en tu máquina:

- [ ] En la carpeta **`server/`** copia **`server/.env.example`** a **`server/.env`**.
- [ ] Rellena en `server/.env`: `DATABASE_URL` (o déjalo vacío para usar SQLite), `ADMIN_PASSWORD`, y opcionalmente `JWT_SECRET` (cualquier valor; si no, se usa la contraseña admin).
- [ ] No subas `server/.env` a Git (ya está en `.gitignore`).

---

## 3. Proyecto en Vercel

- [ ] **Add New → Project** e importas el repo de GitHub.
- [ ] **Build Command:** `npm run build`
- [ ] **Output Directory:** `dist/pages_jcb/browser`
- [ ] **Install Command:** `npm run vercel-install`

No hagas el primer Deploy todavía si quieres configurar antes las variables.

---

## 4. Variables de entorno (obligatorias para el admin)

En **Settings → Environment Variables** del proyecto en Vercel añade al menos:

| Variable               | Obligatoria | Uso |
|------------------------|-------------|-----|
| `DATABASE_URL`         | Sí          | Conexión a Neon/Supabase (PostgreSQL). En Neon usa la URL con `-pooler`. |
| `ADMIN_PASSWORD`       | Sí          | Contraseña del panel de administración. **La que pongas aquí es la que debes escribir en el login.** |
| `JWT_SECRET`           | Opcional    | Secreto para firmar sesiones. Cualquier valor no vacío; si no se define, se usa `ADMIN_PASSWORD`. Sin restricción de longitud. |
| `BLOB_READ_WRITE_TOKEN`| Para imágenes | Token de Vercel Blob. En el proyecto Vercel: **Storage** → crear Blob Store → copiar el token. Sin esto, la subida de imágenes del premio mayor falla en producción. |
| `STRIPE_SECRET_KEY`    | Opcional    | Pagos con Stripe. |
| `STRIPE_WEBHOOK_SECRET`| Opcional    | Webhooks de Stripe. |

- Escribe `ADMIN_PASSWORD` **exactamente** como quieras que sea la contraseña (sin espacios extra).
- Para **Production**, **Preview** y **Development** puedes marcar los tres si quieres que funcione en todos los entornos.

---

## 5. Deploy

- [ ] **Deploy** (o **Redeploy** si ya desplegaste antes de poner las variables).
- Cada vez que **cambies** una variable de entorno, hay que hacer **Redeploy** para que la API use el nuevo valor.

---

## 6. Comprobar que el admin está configurado

Abre en el navegador (cambia por tu URL):

**`https://TU-PROYECTO.vercel.app/api/health`**

Tienes que ver algo como:

```json
{ "ok": true, "adminConfigured": true, "hasDatabase": true }
```

- **`adminConfigured: true`** → la API tiene `ADMIN_PASSWORD` y el login del panel debería funcionar.
- **`adminConfigured: false`** → no está definida `ADMIN_PASSWORD` o no has hecho Redeploy después de añadirla.

---

## 7. Entrar al panel de admin

- URL: **`https://TU-PROYECTO.vercel.app/admin`**
- Contraseña: **la misma** que pusiste en `ADMIN_PASSWORD`.

Si no te deja entrar:

- **503 / “Admin no configurado”** → Falta `ADMIN_PASSWORD` en Vercel o falta **Redeploy**.
- **401 / “Contraseña incorrecta”** → La contraseña no coincide (revisa mayúsculas, minúsculas y espacios).
- Abre F12 → **Red** → intenta login y mira la petición a `api/admin/login` (status y respuesta).

---

## Resumen

1. Base de datos (Neon/Supabase) creada y `schema-supabase.sql` ejecutado.
2. Local: copiar `server/.env.example` → `server/.env` y rellenar.
3. Proyecto Vercel con **Build / Output / Install** correctos.
4. Variables **`DATABASE_URL`** y **`ADMIN_PASSWORD`** (y opcionalmente `JWT_SECRET`, sin restricción de longitud) en Vercel.
5. **Deploy** (y **Redeploy** cada vez que cambies variables).
6. Comprobar **`/api/health`** y que `adminConfigured` sea `true`.
7. Entrar a **`/admin`** con la contraseña de `ADMIN_PASSWORD`.

Documentación detallada: **`DEPLOY-VERCEL.md`**.
