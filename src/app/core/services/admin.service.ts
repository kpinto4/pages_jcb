import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, of, throwError } from 'rxjs';
import { getApiUrl } from './api-url';

export interface AdminStats {
  totalOrders: number;
  pendingOrders?: number;
  totalStikersSold: number;
  reservedStikers?: number;
  totalStikers: number;
  pctSold?: number;
  totalRevenueCents: number;
  avgOrderCents?: number;
  ordersToday?: number;
  revenueTodayCents?: number;
  beneficiosCount?: number;
  beneficiosHoy?: number;
  anticipadosActivos?: number;
  campana?: {
    id: number;
    nombre: string;
    fecha: string;
    premio_descripcion: string | null;
    estado: string;
  } | null;
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
  imagen_url?: string | null;
  sorteo_mayor_id?: number | null;
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
  anticipados_percent?: string;
}

export interface DiagnosticoCheck {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

export interface Diagnostico {
  checkedAt: string;
  db: DiagnosticoCheck & { hasDatabaseUrl: boolean };
  wompi: DiagnosticoCheck & { mode?: string };
  smtp: DiagnosticoCheck & { configured: boolean; host: string | null; port: number; user: string | null; secure: string };
  admin: DiagnosticoCheck;
  cors: { allowedOrigin: string | null; note?: string };
  publicApiUrl: string | null;
}

@Injectable({
  providedIn: 'root'
})
export class AdminService {
  private get base(): string {
    return getApiUrl();
  }

  constructor(private http: HttpClient) {}

  getStats(): Observable<AdminStats | null> {
    return this.http.get<AdminStats>(`${this.base}/api/admin/stats`).pipe(
      catchError((err) => (err?.status === 401 ? throwError(() => err) : of(null)))
    );
  }

  getOrders(limit = 50): Observable<{ orders: AdminOrder[] } | null> {
    return this.http.get<{ orders: AdminOrder[] }>(`${this.base}/api/admin/orders`, {
      params: { limit: limit.toString() }
    }).pipe(
      catchError((err) => (err?.status === 401 ? throwError(() => err) : of(null)))
    );
  }

  getBeneficios(): Observable<{ beneficios: BeneficioAnticipado[] } | null> {
    return this.http.get<{ beneficios: BeneficioAnticipado[] }>(`${this.base}/api/admin/beneficios`).pipe(
      catchError((err) => (err?.status === 401 ? throwError(() => err) : of(null)))
    );
  }

  /** Revisa de nuevo todas las órdenes pagadas y registra coincidencias con números bendecidos que no se hubieran detectado. */
  revisarBeneficios(): Observable<{ ok: boolean; ordenesRevisadas: number; nuevasCoincidencias: number } | null> {
    return this.http.post<{ ok: boolean; ordenesRevisadas: number; nuevasCoincidencias: number }>(`${this.base}/api/admin/revisar-beneficios`, {}).pipe(
      catchError((err) => (err?.status === 401 ? throwError(() => err) : of(null)))
    );
  }

  confirmCashOrder(id: string): Observable<AdminOrder | null> {
    return this.http.post<AdminOrder>(`${this.base}/api/admin/orders/${id}/confirm-cash`, {}).pipe(
      catchError((err) => (err?.status === 401 ? throwError(() => err) : of(null)))
    );
  }

  getSorteos(): Observable<{ sorteos: Sorteo[] } | null> {
    return this.http.get<{ sorteos: Sorteo[] }>(`${this.base}/api/admin/sorteos`).pipe(
      catchError((err) => (err?.status === 401 ? throwError(() => err) : of(null)))
    );
  }

  createSorteo(body: { nombre: string; fecha: string; descripcion?: string; tipo?: string; premio_descripcion?: string; imagen_url?: string; numeros_beneficiados?: string }): Observable<Sorteo | null> {
    return this.http.post<Sorteo>(`${this.base}/api/admin/sorteos`, body).pipe(
      catchError((err) => (err?.status === 401 ? throwError(() => err) : throwError(() => err)))
    );
  }

  updateSorteo(id: number, body: Partial<{ nombre: string; fecha: string; descripcion: string; premio_descripcion: string; imagen_url: string; numeros_beneficiados: string }>): Observable<Sorteo | null> {
    return this.http.patch<Sorteo>(`${this.base}/api/admin/sorteos/${id}`, body).pipe(
      catchError((err) => throwError(() => err))
    );
  }

  uploadImage(file: File): Observable<{ url: string } | null> {
    const formData = new FormData();
    formData.append('image', file);
    return this.http.post<{ url: string }>(`${this.base}/api/admin/upload-image`, formData).pipe(
      catchError((err) => (err?.status === 401 ? throwError(() => err) : of(null)))
    );
  }

  getConfig(): Observable<AppConfig | null> {
    return this.http.get<AppConfig>(`${this.base}/api/admin/config`).pipe(
      catchError((err) => (err?.status === 401 ? throwError(() => err) : of(null)))
    );
  }

  updateConfig(body: { precioStikerCents?: number; currency?: string; anticipadosPercent?: string }): Observable<AppConfig | null> {
    return this.http.patch<AppConfig>(`${this.base}/api/admin/config`, body).pipe(
      catchError((err) => (err?.status === 401 ? throwError(() => err) : of(null)))
    );
  }

  resetStikerSlots(): Observable<{ ok: boolean; total: number } | null> {
    return this.http.post<{ ok: boolean; total: number }>(`${this.base}/api/admin/reset-stiker-slots`, {}).pipe(
      catchError((err) => (err?.status === 401 ? throwError(() => err) : of(null)))
    );
  }

  limpiarPendientes(): Observable<{ ok: boolean; expiradas: number; ageMinutes: number } | null> {
    return this.http.post<{ ok: boolean; expiradas: number; ageMinutes: number }>(`${this.base}/api/admin/limpiar-pendientes`, {}).pipe(
      catchError((err) => (err?.status === 401 ? throwError(() => err) : of(null)))
    );
  }

  deleteSorteo(id: number): Observable<{ ok: boolean } | null> {
    return this.http.delete<{ ok: boolean }>(`${this.base}/api/admin/sorteos/${id}`).pipe(
      catchError((err) => (err?.status === 401 ? throwError(() => err) : throwError(() => err)))
    );
  }

  /** Consultar datos del ganador por número de 4 cifras (el que da la lotería local). */
  consultarGanador(
    id: number,
    numero: string
  ): Observable<{ ganador: SorteoGanadorResponse['ganador']; stiker_ganador: string | null; sorteo: { id: number; nombre: string; fecha: string }; existe_sin_pagar?: boolean } | null> {
    const params: Record<string, string> = { numero: numero.replace(/\D/g, '').slice(0, 4) };
    return this.http
      .get<{ ganador: SorteoGanadorResponse['ganador']; stiker_ganador: string | null; sorteo: { id: number; nombre: string; fecha: string }; existe_sin_pagar?: boolean }>(
        `${this.base}/api/admin/sorteos/${id}/consultar-ganador`,
        { params }
      )
      .pipe(
        catchError((err) => (err?.status === 401 ? throwError(() => err) : of(null)))
      );
  }

  /** Prueba en vivo la BD, Wompi, SMTP, admin y CORS del backend actual (sin reiniciar el servidor). */
  getDiagnostico(): Observable<Diagnostico | null> {
    return this.http.get<Diagnostico>(`${this.base}/api/admin/diagnostico`).pipe(
      catchError((err) => (err?.status === 401 ? throwError(() => err) : of(null)))
    );
  }

  realizarSorteo(id: number, numero_ganador: string): Observable<SorteoGanadorResponse | null> {
    return this.http.post<SorteoGanadorResponse>(`${this.base}/api/admin/sorteos/${id}/realizar`, {
      numero_ganador: numero_ganador.replace(/\D/g, '').slice(0, 4)
    }).pipe(
      catchError((err) => (err?.status === 401 ? throwError(() => err) : throwError(() => err)))
    );
  }
}
