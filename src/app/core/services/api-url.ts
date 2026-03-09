import { environment } from '../../../environments/environment';

const BACKEND_PORT = 3000;

/**
 * URL base del backend API.
 * - Producción (mismo origen): vacío → llamadas relativas /api/*
 * - Desarrollo local: localhost:3000
 */
export function getApiUrl(): string {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    const isLocal = host === 'localhost' || host === '127.0.0.1';
    if (!isLocal) {
      return environment.paymentApiUrl ?? '';
    }
    return environment.paymentApiUrl || `http://localhost:${BACKEND_PORT}`;
  }
  return environment.paymentApiUrl || '';
}

/**
 * Convierte URLs de imágenes al API actual. Usa el protocolo de la página (https/http) para evitar
 * bloqueo por contenido mixto cuando la app está en HTTPS y la imagen en HTTP.
 */
export function resolveImageUrl(url: string | null | undefined): string {
  if (!url || !url.trim()) return '';
  const u = url.trim();
  const base = getApiUrl();
  let finalUrl = u;
  if (u.startsWith('/uploads') || u.startsWith('/')) {
    finalUrl = base ? base + (u.startsWith('/') ? u : '/' + u) : u;
  } else if (/localhost|127\.0\.0\.1/i.test(u)) {
    const path = u.replace(/^https?:\/\/[^/]+/, '') || '/uploads/';
    finalUrl = base ? base + path : u;
  } else if (base && u.includes(getApiHost())) {
    // Misma API: forzar protocolo de la página (evita mixed content si la app es HTTPS)
    try {
      const pageProtocol = typeof window !== 'undefined' ? window.location.protocol : 'https:';
      finalUrl = u.replace(/^https?:\/\//, pageProtocol + '//');
    } catch {
      finalUrl = u;
    }
  }
  return finalUrl;
}

/** Host del API sin protocolo (ej. n1.voriamtechnologies.com:3012). */
function getApiHost(): string {
  const base = getApiUrl();
  try {
    return base ? new URL(base).host : '';
  } catch {
    return base.replace(/^https?:\/\//, '').split('/')[0] || '';
  }
}
