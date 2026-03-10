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
