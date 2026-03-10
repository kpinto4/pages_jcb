# API en /api (sin puerto 3012 en las URLs)

El backend expone la carpeta de imágenes como **pública** en **/uploads** y **/api/uploads**, con CORS para que el front (Dominio A) pueda cargar imágenes del servidor (Dominio B).

- **En la BD** se guarda solo el **nombre del archivo** (ej. `84e8aab8-79f6-43a8-aaf8-d0359c47d20f.jpg`), nunca rutas locales ni URLs completas.
- **En las respuestas API** (home, sorteos, etc.) el backend devuelve la **URL pública** de la imagen si está definido `PUBLIC_API_URL`; así Angular recibe directamente `https://tu-dominio-api.com/uploads/nombre.jpg`.

## Backend (.env)

```env
# URL pública del API (sin :3012). Ejemplo: https://inversionesicb.online/api
# Si está definida, las respuestas incluirán esta base para imagen_url (evita que el front tenga que adivinar el dominio).
PUBLIC_API_URL=https://inversionesicb.online/api

# Orígenes permitidos para CORS (dominio del front). Ej: https://inversionesicb.online
# Si no se define, se acepta cualquier origen (solo recomendable en desarrollo).
ALLOWED_ORIGIN=https://inversionesicb.online
```

Al subir una imagen, el backend devuelve solo el **nombre del archivo**; el admin lo guarda en el sorteo y, al consultar home/sorteos, la API responde con la URL completa usando `PUBLIC_API_URL`.

## Front (producción)

En producción el front usa **window.location.origin + '/api'**: mismas peticiones y mismas imágenes desde el mismo origen (sin Mixed Content).

## Nginx / proxy

El proxy debe enviar `/api` (y por tanto `/api/uploads/...`) al backend Node (p. ej. `http://127.0.0.1:3012`). En el `location` de `/api`:

```nginx
client_max_body_size 10M;
proxy_pass http://127.0.0.1:3012;
# ... proxy_set_header, etc.
```

Luego: `sudo nginx -t && sudo systemctl reload nginx`.

## URLs antiguas en BD con :3012

Si en la BD hay `imagen_url` con `http://...:3012/uploads/xxx.jpg`, el front las reescribe a `origin + '/api/uploads/xxx.jpg'` al mostrarlas. Opcional: actualizar en Neon para que queden con la base nueva.
