# Despliegue en Voriam Technologies

Guía para desplegar la app en modo producción usando un solo puerto.

## 1. Build de producción

En tu máquina local (o en el servidor):

```bash
npm run build:prod
```

Esto genera el frontend Angular en `dist/pages_jcb/browser/`.

## 2. Comando de inicio (panel Voriam)

En **PUESTA EN MARCHA** → **COMANDO**:

```bash
if [[ -d .git ]] && [[ -n "$AUTOUPDATE" ]]; then git pull; fi
if [[ -f package.json ]]; then npm install; fi
if [[ -f dist/pages_jcb/browser/index.html ]]; then node server/index.js; else npm run build:prod && node server/index.js; fi
```

Define `NODE_ENV=production` en las variables de entorno del panel.

O más simple (si el build ya está en el repo o se ejecuta antes):

```bash
npm install && npm run build:prod && node server/index.js
```

## 3. Variables de entorno en el panel

Configura en el panel de Voriam (no en `.env`):

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `NODE_ENV` | Debe ser `production` en despliegue | `production` |
| `PORT` | Puerto asignado por Voriam (ej. 3012) | `3012` |
| `DATABASE_URL` | URL de Neon PostgreSQL | `postgresql://...` |
| `ADMIN_PASSWORD` | Contraseña del panel /admin | (segura) |
| `JWT_SECRET` | Secreto para JWT | (seguro) |
| `PUBLIC_API_URL` | URL pública del servidor | `https://tudominio.com` |
| `ALLOWED_ORIGIN` | Origen CORS permitido | `https://tudominio.com` |
| `WOMPI_*` | Claves Wompi | ... |
| `WOMPI_SUCCESS_URL` | URL de redirección tras pago | `https://tudominio.com/comprar-stikers?success=true&session_id={CHECKOUT_SESSION_ID}` |

## 4. Puerto

El servidor usa `PORT` (o 3000 por defecto). En Voriam, el panel suele inyectar `PORT` con el valor del puerto asignado. Asegúrate de que coincida con la URL pública (ej. si el puerto asignado es 3012, `PUBLIC_API_URL` debe incluir `:3012`).

## 5. Actualización desde Git

Si usas **Actualización automática** activada:
1. Haz push de los cambios
2. El panel ejecutará `git pull` al iniciar
3. Si el build está en el repo: solo reinicia
4. Si el build no está en el repo: añade `npm run build:prod` al comando de inicio antes de `node server/index.js`
