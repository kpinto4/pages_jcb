import { environment } from '../../../environments/environment';

/**
 * URL base del backend API.
 * Usa environment.apiBaseUrl si está definido; si no, mismo host + environment.backendPort.
 * Las imágenes del home van en base64 en la respuesta del API para evitar Mixed Content.
 */
export function getApiUrl(): string {
  if (typeof window === 'undefined') return '';
  if (environment.apiBaseUrl) return environment.apiBaseUrl.replace(/\/$/, '');
  const host = window.location.hostname;
  const port = environment.backendPort ?? 3012;
  return `http://${host}:${port}`;
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
