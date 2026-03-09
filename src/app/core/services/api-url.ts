const BACKEND_PORT = 3012;

/**
 * URL base del backend API en el servidor.
 * VORIAM: front HTTPS 3015, back HTTP 3012. Siempre usamos el mismo host que la página y puerto 3012 en HTTP.
 * Las imágenes del home van en base64 en la respuesta del API para evitar Mixed Content.
 */
export function getApiUrl(): string {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    return `http://${host}:${BACKEND_PORT}`;
  }
  return '';
}

/**
 * Convierte rutas /uploads/ o relativas a la URL del backend (mismo host, puerto 3012).
 */
export function resolveImageUrl(url: string | null | undefined): string {
  if (!url || !url.trim()) return '';
  const u = url.trim();
  const base = getApiUrl();
  if (!base) return u;
  if (u.startsWith('/uploads') || u.startsWith('/')) return base + (u.startsWith('/') ? u : '/' + u);
  return u;
}
