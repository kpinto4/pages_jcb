import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, catchError, of } from 'rxjs';
import { environment } from '../../../environments/environment';

const TOKEN_KEY = 'admin_token';

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

  login(password: string): Observable<{ token: string } | null> {
    const base = this.apiUrl || '';
    return this.http.post<{ token: string }>(`${base}/api/admin/login`, { password }).pipe(
      tap((res) => {
        if (res?.token) {
          sessionStorage.setItem(TOKEN_KEY, res.token);
        }
      }),
      catchError(() => of(null))
    );
  }

  logout(): void {
    sessionStorage.removeItem(TOKEN_KEY);
  }
}
