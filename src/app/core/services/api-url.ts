import { environment } from '../../../environments/environment';

/**
 * URL base del backend API.
 * Puertos: Frontend 3015 | Backend 3012.
 * En producción, si paymentApiUrl está vacía, usa el mismo host con puerto 3012 (backend).
 */
export function getApiUrl(): string {
  if (environment.paymentApiUrl) return environment.paymentApiUrl;
  if (typeof window !== 'undefined' && environment.production) {
    return `${window.location.protocol}//${window.location.hostname}:3012`;
  }
  return '';
}
