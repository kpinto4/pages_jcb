import { environment } from '../../../environments/environment';

/**
 * URL base del backend API.
 * Local: vacío → peticiones a /api vía proxy (ng serve :3015 → backend :3012).
 * Producción: dominio del API.
 */
/** Ruta API absoluta o relativa (local con proxy usa /api/...). */
export function apiEndpoint(path: string): string {
  const base = getApiUrl();
  const p = path.startsWith('/') ? path : `/${path}`;
  return base ? `${base}${p}` : p;
}

export function getApiUrl(): string {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    const isLocal = host === 'localhost' || host === '127.0.0.1';

    // Producción: API en el mismo dominio público del backend.
    if (!isLocal) {
      return environment.paymentApiUrl || 'https://n1.voriamtechnologies.com';
    }

    // Local: mismo origen (ng serve :3015 + proxy.conf.json → backend :3012).
    // Vacío = peticiones a /api/* en el puerto del front.
    if (environment.paymentApiUrl) {
      return environment.paymentApiUrl;
    }
    return '';
  }
  return environment.paymentApiUrl || '';
}

/**
 * Convierte URLs de imágenes con localhost o rutas /uploads/ a la URL del API actual (para despliegue).
 * Cualquier URL que contenga localhost o 127.0.0.1 se reescribe al host del API configurado.
 */
/*
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
*/

export function resolveImageUrl(url: string | null | undefined): string {
  if (!url || !url.trim()) return '';

  let u = url.trim();
  u = u.replace('/api/uploads', '/uploads');

  const base = getApiUrl();
  if (u.startsWith('/uploads') || (u.startsWith('/') && !u.startsWith('//'))) {
    return base ? base + u : u;
  }
  if (/localhost|127\.0\.0\.1/i.test(u)) {
    const path = u.replace(/^https?:\/\/[^/]+/, '') || '/uploads/';
    return base ? base + path : u;
  }
  // Reescribir /uploads/ de otro host al API configurado (ej. dominio con SSL roto)
  const uploadsMatch = u.match(/^(https?:\/\/[^/]+)(\/uploads\/.*)$/i);
  if (uploadsMatch && base) {
    try {
      const baseHost = new URL(base).hostname;
      const srcHost = new URL(u).hostname;
      if (srcHost !== baseHost) {
        return base + uploadsMatch[2];
      }
    } catch {
      /* mantener u */
    }
  }
  return u;
}
