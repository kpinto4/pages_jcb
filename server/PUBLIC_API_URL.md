# PUBLIC_API_URL (servidor)

El backend está en la ruta **/api**. Las URLs de las imágenes al **subir** se guardan siempre con `/api/uploads/...` (nunca con `:3012`).

- Si en el **.env** tienes `PUBLIC_API_URL=https://inversionesjcb.online/api`, las nuevas subidas quedarán con esa base.
- Si aún tienes `PUBLIC_API_URL=http://n1.voriamtechnologies.com:3012`, el backend **convierte** esa base a `http://n1.voriamtechnologies.com/api` al generar la URL de cada imagen subida, así que también se guarda en formato correcto.

Recomendado en producción (mismo protocolo que la web):

```env
PUBLIC_API_URL=https://inversionesjcb.online/api
```

o, si la web se abre por n1:

```env
PUBLIC_API_URL=https://n1.voriamtechnologies.com/api
```

---

## Límite de tamaño al subir imágenes (413 / CORS)

Si al subir una imagen en el admin sale **413 Payload Too Large** o un error de **CORS**, suele ser porque **Nginx** (o el proxy) corta la petición antes de llegar al Node y no envía cabeceras CORS.

**Qué debe hacer quien configure el servidor:** en el bloque de Nginx que hace proxy a `/api`, añadir:

```nginx
client_max_body_size 10M;
```

Por ejemplo, dentro del `location /api/`:

```nginx
location /api/ {
    client_max_body_size 10M;
    proxy_pass http://127.0.0.1:3012;
    # ... resto de proxy_set_header, etc.
}
```

Luego recargar Nginx: `sudo nginx -t && sudo systemctl reload nginx`.

El backend Node acepta imágenes de hasta **5 MB**; con `10M` en Nginx hay margen. Si la imagen es muy pesada, el usuario puede usar una URL externa (Imgur, etc.) en el campo "URI de la imagen".

---

## URLs antiguas en la base de datos (Mixed Content)

Si en la tabla `sorteos` la columna `imagen_url` tiene valores como `http://n1.voriamtechnologies.com:3012/uploads/xxx.jpg`, el navegador puede bloquearlas (Mixed Content) o mostrar advertencias. El front reescribe esas URLs a `https://<dominio-actual>/api/uploads/xxx.jpg`, pero para no depender de eso y tener la BD consistente puedes actualizarlas en Neon con:

```sql
UPDATE sorteos
SET imagen_url = 'https://inversionesjcb.online/api/uploads/' || (regexp_match(imagen_url, '/uploads/([^/?#]+)'))[1]
WHERE imagen_url ~ '^https?://[^/]+:3012/uploads/';
```

(Usa `inversionesjcb.online` o `n1.voriamtechnologies.com` según el dominio que use la web.) A partir de ahí, que `PUBLIC_API_URL` en el servidor sea `https://inversionesjcb.online/api` para que las nuevas subidas guarden ya la URL correcta.
