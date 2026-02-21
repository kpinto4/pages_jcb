import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface CreateCheckoutSessionRequest {
  amount: number;           // Total en centavos (ej: 5000 = 50.00 USD)
  currency?: string;        // 'usd', 'eur', 'mxn', etc.
  customerEmail: string;
  customerName?: string;
  lineItems?: Array<{
    name: string;
    description?: string;
    unit_amount: number;   // en centavos
    quantity: number;
    image?: string;
  }>;
  metadata?: Record<string, string>;
  /** Stikers seleccionados (numeroA, numeroB) para reservar en backend */
  selectedStikers?: Array<{ numeroA: string; numeroB: string }>;
}

export interface StikerFromApi {
  numeroA: string;
  numeroB: string;
  estado: 'libre' | 'ocupado';
}

export interface StikerCompradoFromApi {
  codigo: string;
  numero1: string;
  numero2: string;
  pagado: boolean;
}

export interface CreateCheckoutSessionResponse {
  url: string;
  sessionId: string;
}

export interface SessionDetails {
  id: string;
  customer_email: string | null;
  amount_total: number | null;
  currency: string | null;
  metadata: Record<string, string>;
}

@Injectable({
  providedIn: 'root'
})
export class PaymentService {
  private readonly apiUrl = environment.paymentApiUrl;

  constructor(private http: HttpClient) {}

  /**
   * Crea una sesión de pago en el backend y devuelve la URL de Stripe Checkout.
   * Redirige al usuario a esa URL para completar el pago.
   */
  createCheckoutSession(request: CreateCheckoutSessionRequest): Observable<CreateCheckoutSessionResponse> {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const successUrl = `${origin}/comprar-stikers?success=true&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${origin}/comprar-stikers?canceled=true`;

    const body = {
      ...request,
      successUrl,
      cancelUrl
    };

    return this.http.post<CreateCheckoutSessionResponse>(`${this.apiUrl}/api/create-checkout-session`, body).pipe(
      catchError((err) => {
        console.error('Error al crear sesión de pago:', err);
        throw err;
      })
    );
  }

  /**
   * Obtiene los detalles de una sesión completada (para la página de éxito).
   */
  getSessionDetails(sessionId: string): Observable<SessionDetails | null> {
    if (!this.apiUrl) {
      return of(null);
    }
    return this.http.get<SessionDetails>(`${this.apiUrl}/api/session/${sessionId}`).pipe(
      map((data) => data),
      catchError(() => of(null))
    );
  }

  /**
   * Comprueba si el backend de pago está disponible.
   */
  healthCheck(): Observable<{ ok: boolean; stripe: boolean }> {
    if (!this.apiUrl) {
      return of({ ok: false, stripe: false });
    }
    return this.http.get<{ ok: boolean; stripe: boolean }>(`${this.apiUrl}/api/health`).pipe(
      catchError(() => of({ ok: false, stripe: false }))
    );
  }

  /**
   * Configuración pública (precio por stiker, moneda) para la tienda.
   */
  getConfig(): Observable<{ precioStikerCents: number; currency: string }> {
    if (!this.apiUrl) return of({ precioStikerCents: 5000, currency: 'usd' });
    return this.http.get<{ precioStikerCents: number; currency: string }>(`${this.apiUrl}/api/config`).pipe(
      catchError(() => of({ precioStikerCents: 5000, currency: 'usd' }))
    );
  }

  /**
   * Lista de stikers disponibles/ocupados desde el backend.
   */
  getStikers(): Observable<{ stikers: StikerFromApi[] }> {
    if (!this.apiUrl) {
      return of({ stikers: [] });
    }
    return this.http.get<{ stikers: StikerFromApi[] }>(`${this.apiUrl}/api/stikers`, {
      params: { limit: '5000' }
    }).pipe(
      catchError(() => of({ stikers: [] }))
    );
  }

  /**
   * Lista de sorteos (público, para la sección Premios en home).
   */
  getSorteos(): Observable<{ sorteos: Array<{ id: number; nombre: string; fecha: string; descripcion: string | null; tipo: string; estado: string; numero_ganador_a: string | null; numero_ganador_b: string | null }> }> {
    if (!this.apiUrl) return of({ sorteos: [] });
    return this.http.get<{ sorteos: any[] }>(`${this.apiUrl}/api/sorteos`).pipe(
      catchError(() => of({ sorteos: [] }))
    );
  }

  /**
   * Stikers asociados a una cédula (para Verificar stiker).
   */
  getStikersPorCedula(cedula: string): Observable<{ stikers: StikerCompradoFromApi[] }> {
    if (!this.apiUrl) {
      return of({ stikers: [] });
    }
    return this.http.get<{ stikers: StikerCompradoFromApi[] }>(`${this.apiUrl}/api/verificar-stikers`, {
      params: { cedula: cedula.trim() }
    }).pipe(
      catchError(() => of({ stikers: [] }))
    );
  }
}
