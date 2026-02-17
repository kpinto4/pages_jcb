import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, of, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface AdminStats {
  totalOrders: number;
  totalStikersSold: number;
  totalRevenueCents: number;
}

export interface AdminOrder {
  id: string;
  cedula: string;
  nombre: string;
  email: string;
  total_cents: number;
  currency: string;
  status: string;
  created_at: string;
  items_count: number;
}

export interface Sorteo {
  id: number;
  nombre: string;
  fecha: string;
  descripcion: string | null;
  tipo: string;
  estado: string;
  premio_descripcion: string | null;
  numero_ganador_a: string | null;
  numero_ganador_b: string | null;
  numeros_beneficiados?: string | null;
  created_at: string;
}

export interface SorteoGanadorResponse {
  sorteo: Sorteo;
  ganador: {
    order_id: string;
    cedula: string;
    nombre: string;
    email: string;
    telefono: string | null;
    numeros: Array<{ numero_a: string; numero_b: string }>;
  } | null;
}

export interface BeneficioAnticipado {
  id: number;
  sorteo_id: number;
  sorteo_nombre: string | null;
  order_id: string;
  numero_a: string;
  numero_b: string;
  cedula: string | null;
  nombre: string | null;
  email: string | null;
  telefono: string | null;
  created_at: string;
}

export interface AppConfig {
  precio_stiker_cents?: string;
  currency?: string;
}

@Injectable({
  providedIn: 'root'
})
export class AdminService {
  private readonly apiUrl = environment.paymentApiUrl;

  constructor(private http: HttpClient) {}

  getStats(): Observable<AdminStats | null> {
    if (!this.apiUrl) return of(null);
    return this.http.get<AdminStats>(`${this.apiUrl}/api/admin/stats`).pipe(
      catchError((err) => (err?.status === 401 ? throwError(() => err) : of(null)))
    );
  }

  getOrders(limit = 50): Observable<{ orders: AdminOrder[] } | null> {
    if (!this.apiUrl) return of(null);
    return this.http.get<{ orders: AdminOrder[] }>(`${this.apiUrl}/api/admin/orders`, {
      params: { limit: limit.toString() }
    }).pipe(
      catchError((err) => (err?.status === 401 ? throwError(() => err) : of(null)))
    );
  }

  getBeneficios(): Observable<{ beneficios: BeneficioAnticipado[] } | null> {
    if (!this.apiUrl) return of(null);
    return this.http.get<{ beneficios: BeneficioAnticipado[] }>(`${this.apiUrl}/api/admin/beneficios`).pipe(
      catchError((err) => (err?.status === 401 ? throwError(() => err) : of(null)))
    );
  }

  confirmCashOrder(id: string): Observable<AdminOrder | null> {
    if (!this.apiUrl) return of(null);
    return this.http.post<AdminOrder>(`${this.apiUrl}/api/admin/orders/${id}/confirm-cash`, {}).pipe(
      catchError((err) => (err?.status === 401 ? throwError(() => err) : of(null)))
    );
  }

  getSorteos(): Observable<{ sorteos: Sorteo[] } | null> {
    if (!this.apiUrl) return of(null);
    return this.http.get<{ sorteos: Sorteo[] }>(`${this.apiUrl}/api/sorteos`).pipe(
      catchError((err) => (err?.status === 401 ? throwError(() => err) : of(null)))
    );
  }

  createSorteo(body: { nombre: string; fecha: string; descripcion?: string; tipo?: string; premio_descripcion?: string }): Observable<Sorteo | null> {
    if (!this.apiUrl) return of(null);
    return this.http.post<Sorteo>(`${this.apiUrl}/api/admin/sorteos`, body).pipe(
      catchError((err) => (err?.status === 401 ? throwError(() => err) : of(null)))
    );
  }

  getConfig(): Observable<AppConfig | null> {
    if (!this.apiUrl) return of(null);
    return this.http.get<AppConfig>(`${this.apiUrl}/api/admin/config`).pipe(
      catchError((err) => (err?.status === 401 ? throwError(() => err) : of(null)))
    );
  }

  updateConfig(body: { precioStikerCents?: number; currency?: string }): Observable<AppConfig | null> {
    if (!this.apiUrl) return of(null);
    return this.http.patch<AppConfig>(`${this.apiUrl}/api/admin/config`, body).pipe(
      catchError((err) => (err?.status === 401 ? throwError(() => err) : of(null)))
    );
  }

  realizarSorteo(id: number): Observable<SorteoGanadorResponse | null> {
    if (!this.apiUrl) return of(null);
    return this.http.post<SorteoGanadorResponse>(`${this.apiUrl}/api/admin/sorteos/${id}/realizar`, {}).pipe(
      catchError((err) => (err?.status === 401 ? throwError(() => err) : of(null)))
    );
  }
}
