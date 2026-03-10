import { environment } from '../../../environments/environment';

const BACKEND_PORT = 3012;

/**
 * URL base del backend API.
 * - En el servidor: el backend está en la ruta /api (ej. n1.voriamtechnologies.com/api, inversionesjcb.online/api).
 *   Sin puerto :3012; Nginx/proxy redirige /api al backend.
 * - En desarrollo local: usa el puerto 3012 (environment.paymentApiUrl).
 */
export function getApiUrl(): string {
  if (typeof window === 'undefined') {
    return environment.paymentApiUrl || '';
  }
  const host = window.location.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1';
  if (isLocal) {
    return environment.paymentApiUrl || `http://${host}:${BACKEND_PORT}`;
  }
  return window.location.origin + '/api';
}

/**
 * Convierte rutas /uploads/ o relativas a la URL del backend.
 * En servidor queda en /api/uploads/... (mismo origen, sin Mixed Content).
 * Si la URL guardada en BD tiene :3012 (ruta antigua), se reescribe a /api.
 */
export function resolveImageUrl(url: string | null | undefined): string {
  if (!url || !url.trim()) return '';
  const u = url.trim();
  const base = getApiUrl();
  if (!base) return u;
  if (u.startsWith('/uploads') || u.startsWith('/')) {
    return base + (u.startsWith('/') ? u : '/' + u);
  }
  if (/localhost|127\.0\.0\.1/i.test(u)) {
    const path = u.replace(/^https?:\/\/[^/]+/, '') || '/uploads/';
    return base + path;
  }
  const match = u.match(/^https?:\/\/[^/]+:3012(\/uploads\/[^/?#]+)$/i);
  if (match && typeof window !== 'undefined') {
    return window.location.origin + '/api' + match[1];
  }
  return u;
}
