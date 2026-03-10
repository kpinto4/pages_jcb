# API en /api (sin puerto 3012 en las URLs)

El backend se expone en la ruta **/api**. Las imágenes están en **server/public/uploads/** y se sirven como **/api/uploads/...**.

## Backend (.env)

```env
# URL pública del API (sin :3012). Ejemplo: https://inversionesjcb.online/api
PUBLIC_API_URL=https://inversionesjcb.online/api
```

Al subir una imagen, el backend devuelve (y se guarda en BD) esa base + `/uploads/nombre.jpg`.

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
