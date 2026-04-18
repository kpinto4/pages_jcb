import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { getApiUrl } from './api-url';
import { environment } from '../../../environments/environment';

/** Enlaces públicos (WhatsApp y redes) desde `/api/config` o `environment` como respaldo. */
export interface SitePublicLinks {
  whatsappDudasUrl: string;
  whatsappComunidadUrl: string;
  socialFacebookUrl: string;
  socialInstagramUrl: string;
  socialTiktokUrl: string;
}

function trim(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function mergeLinks(api: Record<string, unknown> | null): SitePublicLinks {
  const pick = (apiKey: keyof SitePublicLinks): string => {
    const fromApi = api ? trim(api[apiKey as string]) : '';
    if (fromApi) return fromApi;
    return trim((environment as Record<string, unknown>)[apiKey as string]);
  };
  return {
    whatsappDudasUrl: pick('whatsappDudasUrl'),
    whatsappComunidadUrl: pick('whatsappComunidadUrl'),
    socialFacebookUrl: pick('socialFacebookUrl'),
    socialInstagramUrl: pick('socialInstagramUrl'),
    socialTiktokUrl: pick('socialTiktokUrl')
  };
}

@Injectable({ providedIn: 'root' })
export class SiteLinksService {
  private readonly subject = new BehaviorSubject<SitePublicLinks>(mergeLinks(null));

  /** Emite al menos una vez (environment); se actualiza al recibir `/api/config`. */
  readonly links$: Observable<SitePublicLinks> = this.subject.asObservable();

  constructor(private readonly http: HttpClient) {
    const api = getApiUrl();
    if (!api) return;
    this.http.get<Record<string, unknown>>(`${api}/api/config`).subscribe({
      next: (body) => this.subject.next(mergeLinks(body)),
      error: () => {
        /* se mantiene el valor inicial desde environment */
      }
    });
  }
}
