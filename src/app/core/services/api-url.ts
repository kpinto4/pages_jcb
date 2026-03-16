import { environment } from '../../../environments/environment';

const BACKEND_PORT = 3012;

/**
 * URL base del backend API. Nunca devuelve vacío en el navegador para evitar que las peticiones vayan al mismo origen (front).
 * Puertos: Frontend 3015 | Backend 3012.
 */
export function getApiUrl(): string {
  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol;
    const host = window.location.hostname;
    const isLocal = host === 'localhost' || host === '127.0.0.1';
    if (!isLocal) {
      return `${protocol}//${host}:${BACKEND_PORT}`;
    }
    return environment.paymentApiUrl || `${protocol}//${host}:${BACKEND_PORT}`;
  }
  return environment.paymentApiUrl || '';
}

/**
 * Convierte URLs de imágenes con localhost o rutas /uploads/ a la URL del API actual (para despliegue).
 * Cualquier URL que contenga localhost o 127.0.0.1 se reescribe al host del API configurado.
 */
export function resolveImageUrl(url: string | null | undefined): string {
  if (!url || !url.trim()) return '';
  const u = url.trim();
  const base = getApiUrl();
  if (u.startsWith('/uploads') || u.startsWith('/')) return base ? base + (u.startsWith('/') ? u : '/' + u) : u;
  if (/localhost|127\.0\.0\.1/i.test(u)) {
    const path = u.replace(/^https?:\/\/[^/]+/, '') || '/uploads/';
    return base ? base + path : u;
  }
  return u;
}

