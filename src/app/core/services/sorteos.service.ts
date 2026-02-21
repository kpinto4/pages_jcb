import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, catchError } from 'rxjs';
import { environment } from '../../../environments/environment';

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
  private readonly apiUrl = environment.paymentApiUrl;

  constructor(private http: HttpClient) {}

  getHomeData(): Observable<HomeSorteosResponse | null> {
    if (!this.apiUrl) return of(null);
    return this.http.get<HomeSorteosResponse>(`${this.apiUrl}/api/sorteos/home`).pipe(
      catchError(() => of(null))
    );
  }

  getProgreso(): Observable<ProgresoResponse | null> {
    if (!this.apiUrl) return of(null);
    return this.http.get<ProgresoResponse>(`${this.apiUrl}/api/progreso`).pipe(
      catchError(() => of(null))
    );
  }
}

