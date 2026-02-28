import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, catchError, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';

const TOKEN_KEY = 'admin_token';

export interface LoginError {
  status: number;
  message: string;
}

@Injectable({
  providedIn: 'root'
})
export class AdminAuthService {
  private readonly apiUrl = environment.paymentApiUrl;

  constructor(private http: HttpClient) {}

  getToken(): string | null {
    if (typeof sessionStorage === 'undefined') return null;
    return sessionStorage.getItem(TOKEN_KEY);
  }

  isLoggedIn(): boolean {
    return !!this.getToken();
  }

  login(password: string): Observable<{ token: string }> {
    const base = this.apiUrl || '';
    return this.http.post<{ token: string }>(`${base}/api/admin/login`, { password }).pipe(
      tap((res) => {
        if (res?.token) {
          sessionStorage.setItem(TOKEN_KEY, res.token);
        }
      }),
      catchError((err) => {
        const message = err?.error?.error || err?.message || 'Error al conectar con el servidor.';
        return throwError(() => ({ status: err?.status, message }));
      })
    );
  }

  logout(): void {
    sessionStorage.removeItem(TOKEN_KEY);
  }
}
