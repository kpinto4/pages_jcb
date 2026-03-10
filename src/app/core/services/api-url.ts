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

/** Convierte la URL de imagen a la base actual del API (/api/uploads/...). Si en BD hay URL antigua con :3012, la reescribe. */
export function resolveImageUrl(url: string | null | undefined): string {
  if (!url || !url.trim()) return '';
  const u = url.trim();
  const base = getApiUrl();
  if (!base) return u;
  if (u.startsWith('/uploads') || (u.startsWith('/') && !u.startsWith('//'))) {
    return base.replace(/\/$/, '') + (u.startsWith('/') ? u : '/' + u);
  }
  // URL antigua con :3012 o otro dominio → usar /api/uploads/<filename>
  const match = u.match(/\/uploads\/([^/?#]+)$/i);
  if (match) return base.replace(/\/$/, '') + '/uploads/' + match[1];
  return u;
}
