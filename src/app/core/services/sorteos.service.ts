import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, catchError, shareReplay } from 'rxjs';
import { getApiUrl, apiEndpoint } from './api-url';

export interface Sorteo {
  id: number;
  nombre: string;
  fecha: string;
  descripcion?: string | null;
  tipo: string;
  estado: string;
  premio_descripcion?: string | null;
  imagen_url?: string | null;
  numero_ganador_a?: string | null;
  numero_ganador_b?: string | null;
  numeros_beneficiados?: string | null;
}

export interface AnticipadoHome {
  id: number;
  nombre: string;
  fecha: string;
  premio_descripcion?: string | null;
  numeros_beneficiados?: string | null;
  revelado: boolean;
  numero_revelado: string | null;
}

export interface HomeSorteosResponse {
  principal: Sorteo | null;
  anticipadosActuales: AnticipadoHome[];
  mayoresRealizados: (Sorteo & { ganador_nombre?: string; ganador_cedula?: string; ganador_email?: string; ganador_telefono?: string })[];
}

export interface ProgresoResponse {
  totalStikersSold: number;
  totalStikers: number;
}

@Injectable({
  providedIn: 'root'
})
export class SorteosService {
  constructor(private http: HttpClient) {}

  private get apiUrl(): string {
    return getApiUrl();
  }

  private homeDataCache$: Observable<HomeSorteosResponse | null> | null = null;
  private homeCacheExpiresAt = 0;
  private readonly HOME_CACHE_MS = 60_000;

  getHomeData(): Observable<HomeSorteosResponse | null> {
    const now = Date.now();
    if (!this.homeDataCache$ || now > this.homeCacheExpiresAt) {
      this.homeCacheExpiresAt = now + this.HOME_CACHE_MS;
      this.homeDataCache$ = this.http.get<HomeSorteosResponse>(apiEndpoint('/api/sorteos/home')).pipe(
        catchError(() => of(null)),
        shareReplay({ bufferSize: 1, refCount: true })
      );
    }
    return this.homeDataCache$;
  }

  getProgreso(): Observable<ProgresoResponse | null> {
    return this.http.get<ProgresoResponse>(apiEndpoint('/api/progreso')).pipe(
      catchError(() => of(null))
    );
  }
}

