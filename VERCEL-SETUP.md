# Checklist: que todo funcione en Vercel (incluido el panel de admin)

Sigue este orden al crear un **nuevo** proyecto en Vercel.

---

## 1. Base de datos (Supabase)

- [ ] Proyecto creado en [Supabase](https://supabase.com).
- [ ] En **Project Settings → Database** copias la **Connection string** (URI).
- [ ] En **SQL Editor** ejecutas todo el contenido de **`server/schema-supabase.sql`**.

---

## 2. Proyecto en Vercel

- [ ] **Add New → Project** e importas el repo de GitHub.
- [ ] **Build Command:** `npm run build`
- [ ] **Output Directory:** `dist/pages_jcb/browser`
- [ ] **Install Command:** `npm run vercel-install`

No hagas el primer Deploy todavía si quieres configurar antes las variables.

---

## 3. Variables de entorno (obligatorias para el admin)

En **Settings → Environment Variables** del proyecto en Vercel añade al menos:

| Variable           | Obligatoria | Uso |
|--------------------|-------------|-----|
| `DATABASE_URL`     | Sí          | Conexión a Supabase (PostgreSQL). |
| `ADMIN_PASSWORD`   | Sí          | Contraseña del panel de administración. **La que pongas aquí es la que debes escribir en el login.** |
| `JWT_SECRET`       | Recomendada | Secreto para las sesiones del admin (si no la pones, se usa `ADMIN_PASSWORD`). |
| `STRIPE_SECRET_KEY`| Opcional    | Pagos con Stripe. |
| `STRIPE_WEBHOOK_SECRET` | Opcional | Webhooks de Stripe. |

- Escribe `ADMIN_PASSWORD` **exactamente** como quieras que sea la contraseña (sin espacios extra).
- Para **Production**, **Preview** y **Development** puedes marcar los tres si quieres que funcione en todos los entornos.

---

## 4. Deploy

- [ ] **Deploy** (o **Redeploy** si ya desplegaste antes de poner las variables).
- Cada vez que **cambies** una variable de entorno, hay que hacer **Redeploy** para que la API use el nuevo valor.

---

## 5. Comprobar que el admin está configurado

Abre en el navegador (cambia por tu URL):

**`https://TU-PROYECTO.vercel.app/api/health`**

Tienes que ver algo como:

```json
{ "ok": true, "adminConfigured": true, "hasDatabase": true }
```

- **`adminConfigured: true`** → la API tiene `ADMIN_PASSWORD` y el login del panel debería funcionar.
- **`adminConfigured: false`** → no está definida `ADMIN_PASSWORD` o no has hecho Redeploy después de añadirla.

---

## 6. Entrar al panel de admin

- URL: **`https://TU-PROYECTO.vercel.app/admin`**
- Contraseña: **la misma** que pusiste en `ADMIN_PASSWORD`.

Si no te deja entrar:

- **503 / “Admin no configurado”** → Falta `ADMIN_PASSWORD` en Vercel o falta **Redeploy**.
- **401 / “Contraseña incorrecta”** → La contraseña no coincide (revisa mayúsculas, minúsculas y espacios).
- Abre F12 → **Red** → intenta login y mira la petición a `api/admin/login` (status y respuesta).

---

## Resumen

1. Supabase creado y `schema-supabase.sql` ejecutado.
2. Proyecto Vercel con **Build / Output / Install** correctos.
3. Variables **`DATABASE_URL`** y **`ADMIN_PASSWORD`** (y opcionalmente `JWT_SECRET`) en Vercel.
4. **Deploy** (y **Redeploy** cada vez que cambies variables).
5. Comprobar **`/api/health`** y que `adminConfigured` sea `true`.
6. Entrar a **`/admin`** con la contraseña de `ADMIN_PASSWORD`.

Documentación detallada: **`DEPLOY-VERCEL.md`**.
