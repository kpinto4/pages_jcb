# Puertos e imágenes (VORIAM)

- **Front:** 3015 (Angular `ng serve`)
- **Back:** 3012 (Express; `PORT` en `server/.env`)

El puerto del backend debe coincidir con `backendPort` en `src/environments/environment.ts` y `environment.prod.ts`. Si en otro entorno usas otro puerto, define `PORT` en `server/.env` y `backendPort` (o `apiBaseUrl`) en los environments de Angular.

**Local:** Ejecuta `npm run dev` en la raíz (front 3015 + back 3012) o `npm run start` en `server/` con `PORT=3012` en `.env`.

**Producción (servidor):**
- Definir en `server/.env`: `ALLOWED_ORIGIN` (origen del front, ej. `https://tudominio.com`), `ADMIN_PASSWORD`, `JWT_SECRET`, `DATABASE_URL`, y opcionalmente `PUBLIC_API_URL` para imágenes.
- El backend usa **helmet** para cabeceras de seguridad y **CORS** según `ALLOWED_ORIGIN`.

Para evitar Mixed Content (página HTTPS pidiendo imágenes a HTTP :3012), el endpoint **GET /api/sorteos/home** incluye las imágenes del **principal** y de **mayoresRealizados** en **base64** dentro del JSON. El front no hace peticiones a `/uploads/` para esas imágenes.

**Recomendación:** Usar imágenes livianas (p. ej. JPEG comprimido, anchos ~800–1200 px) para que la respuesta del home no sea demasiado pesada.
