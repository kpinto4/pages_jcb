import { environment } from '../../../environments/environment';

const BACKEND_PORT = 3012;

/** URL base del backend. En local: localhost:3012; en producción: mismo origen en /api o paymentApiUrl si front y API están en dominios distintos. */
export function getApiUrl(): string {
  if (typeof window === 'undefined') {
    return environment.paymentApiUrl || '';
  }
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') {
    return environment.paymentApiUrl || `http://${host}:${BACKEND_PORT}`;
  }
  // Si el front se sirve desde otro dominio (ej. GitHub Pages), usar la URL del API para peticiones e imágenes
  if (environment.paymentApiUrl) {
    return environment.paymentApiUrl.replace(/\/$/, '');
  }
  return window.location.origin + '/api';
}

/**
 * Convierte la referencia de imagen a URL absoluta del servidor.
 * Usada en el hero (home) y en la sección de premios: la misma imagen del sorteo se muestra en ambos.
 * - Ruta del servidor (/uploads/xxx o uploads/xxx) → se une a la base del API.
 * - Solo nombre de archivo (xxx.jpg) → se trata como subida: base + /uploads/xxx.
 * - URL externa (http...) o antigua con otro dominio → se reescribe a base + /uploads/filename si contiene /uploads/, sino se deja igual.
 */
export function resolveImageUrl(url: string | null | undefined): string {
  if (!url || !url.trim()) return '';
  const u = url.trim();
  const base = getApiUrl();
  if (!base) return u;
  // Ruta relativa del servidor: /uploads/xxx o uploads/xxx
  if (u.startsWith('/uploads') || u.startsWith('uploads/')) {
    const path = u.startsWith('/') ? u : '/' + u;
    return base.replace(/\/$/, '') + path;
  }
  // Solo nombre de archivo (sin barras) = subida en servidor
  if (!u.includes('/') && !u.startsWith('http')) {
    return base.replace(/\/$/, '') + '/uploads/' + u;
  }
  // URL antigua con dominio (ej. https://otro.com/api/uploads/xxx) → reescribir a nuestro servidor
  const match = u.match(/\/uploads\/([^/?#]+)$/i);
  if (match) return base.replace(/\/$/, '') + '/uploads/' + match[1];
  // URL externa (Imgur, etc.) → devolver tal cual
  return u;
}
