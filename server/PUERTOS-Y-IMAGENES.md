# Puertos e imágenes (VORIAM)

- **Front:** 3015  
- **Back:** 3012 (por ahora en HTTP; cuando tengan HTTPS se podrá usar URLs directas si se desea).

Para evitar Mixed Content (página HTTPS pidiendo imágenes a HTTP :3012), el endpoint **GET /api/sorteos/home** incluye las imágenes del **principal** y de **mayoresRealizados** en **base64** dentro del JSON. El front no hace peticiones a `/uploads/` para esas imágenes.

**Recomendación:** Usar imágenes livianas (p. ej. JPEG comprimido, anchos ~800–1200 px) para que la respuesta del home no sea demasiado pesada.
