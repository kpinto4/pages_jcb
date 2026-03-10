# PUBLIC_API_URL (servidor)

El backend está expuesto en la ruta **/api** (no en el puerto :3012 directo). Para que las URLs de las imágenes que se guardan al subir archivos funcionen bien en el front:

En el **.env del servidor** pon, según el dominio que use la web:

```env
PUBLIC_API_URL=https://inversionesjcb.online/api
```

o, si la web se abre por n1:

```env
PUBLIC_API_URL=https://n1.voriamtechnologies.com/api
```

**No uses** `:3012` en esta variable. Ejemplo de health: `n1.voriamtechnologies.com/api/health`.

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
