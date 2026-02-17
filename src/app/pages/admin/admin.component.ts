import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService, AdminStats, AdminOrder, Sorteo, SorteoGanadorResponse, BeneficioAnticipado } from '../../core/services/admin.service';
import { AdminAuthService } from '../../core/services/admin-auth.service';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin.component.html',
  styleUrl: './admin.component.scss'
})
export class AdminComponent implements OnInit {

  loggedIn = false;
  password = '';
  loginError = '';
  loginLoading = false;

  tab: 'stats' | 'orders' | 'sorteos' | 'beneficios' | 'config' = 'stats';

  stats: AdminStats | null = null;
  orders: AdminOrder[] = [];
  sorteos: Sorteo[] = [];

  loading = false;
  error = '';

  nuevoSorteo = {
    nombre: '',
    fecha: '',
    descripcion: '',
    tipo: 'anticipado',
    premio_descripcion: '',
    numeros_beneficiados: ''
  };
  guardandoSorteo = false;
  realizandoId: number | null = null;

  config = {
    precioStikerDollars: 50,
    currency: 'usd'
  };
  guardandoConfig = false;
  configGuardada = false;

  ganadorActual: SorteoGanadorResponse | null = null;

  confirmandoId: string | null = null;

  beneficios: BeneficioAnticipado[] = [];

  constructor(
    private adminService: AdminService,
    private auth: AdminAuthService
  ) {}

  ngOnInit(): void {
    this.loggedIn = this.auth.isLoggedIn();
    if (this.loggedIn) {
      this.cargarStats();
      this.cargarOrders();
      this.cargarSorteos();
      this.cargarBeneficios();
      this.cargarConfig();
    }
  }

  login(): void {
    this.loginError = '';
    if (!this.password.trim()) {
      this.loginError = 'Ingresa la contraseña.';
      return;
    }
    this.loginLoading = true;
    this.auth.login(this.password).subscribe({
      next: (res) => {
        this.loginLoading = false;
        if (res?.token) {
          this.loggedIn = true;
          this.password = '';
          this.cargarStats();
          this.cargarOrders();
          this.cargarSorteos();
          this.cargarConfig();
        } else {
          this.loginError = 'Contraseña incorrecta o backend no disponible.';
        }
      },
      error: () => {
        this.loginLoading = false;
        this.loginError = 'Contraseña incorrecta o backend no disponible.';
      }
    });
  }

  logout(): void {
    this.auth.logout();
    this.loggedIn = false;
  }

  private on401(): void {
    this.loggedIn = false;
  }

  cargarConfig(): void {
    this.adminService.getConfig().subscribe({
      next: (c) => {
        if (c?.precio_stiker_cents) {
          this.config.precioStikerDollars = parseInt(c.precio_stiker_cents, 10) / 100;
        }
        if (c?.currency) this.config.currency = c.currency;
      },
      error: (err) => {
        if (err?.status === 401) this.on401();
      }
    });
  }

  guardarConfig(): void {
    this.guardandoConfig = true;
    this.configGuardada = false;
    this.adminService.updateConfig({
      precioStikerCents: Math.round(this.config.precioStikerDollars * 100),
      currency: this.config.currency
    }).subscribe({
      next: () => {
        this.guardandoConfig = false;
        this.configGuardada = true;
        setTimeout(() => (this.configGuardada = false), 3000);
      },
      error: (err) => {
        if (err?.status === 401) this.on401();
        this.guardandoConfig = false;
      }
    });
  }

  cargarStats(): void {
    this.loading = true;
    this.adminService.getStats().subscribe({
      next: (s) => {
        this.stats = s;
        this.loading = false;
      },
      error: (err) => {
        if (err?.status === 401) this.on401();
        else this.error = 'No se pudo conectar con el backend.';
        this.loading = false;
      }
    });
  }

  cargarOrders(): void {
    this.adminService.getOrders().subscribe({
      next: (r) => {
        this.orders = r?.orders ?? [];
      },
      error: (err) => {
        if (err?.status === 401) this.on401();
      }
    });
  }

  confirmarEfectivo(o: AdminOrder): void {
    if (o.status === 'paid') return;
    this.confirmandoId = o.id;
    this.adminService.confirmCashOrder(o.id).subscribe({
      next: (updated) => {
        if (updated) {
          this.orders = this.orders.map(ord => ord.id === updated.id ? updated : ord);
        }
        this.confirmandoId = null;
      },
      error: (err) => {
        if (err?.status === 401) this.on401();
        this.confirmandoId = null;
      }
    });
  }

  cargarSorteos(): void {
    this.adminService.getSorteos().subscribe({
      next: (r) => {
        this.sorteos = r?.sorteos ?? [];
      },
      error: (err) => {
        if (err?.status === 401) this.on401();
      }
    });
  }

  cargarBeneficios(): void {
    this.adminService.getBeneficios().subscribe({
      next: (r) => {
        this.beneficios = r?.beneficios ?? [];
      },
      error: (err) => {
        if (err?.status === 401) this.on401();
      }
    });
  }

  crearSorteo(): void {
    if (!this.nuevoSorteo.nombre.trim() || !this.nuevoSorteo.fecha.trim()) {
      this.error = 'Nombre y fecha son obligatorios.';
      return;
    }
    this.error = '';
    this.guardandoSorteo = true;
    this.adminService.createSorteo({
      nombre: this.nuevoSorteo.nombre.trim(),
      fecha: this.nuevoSorteo.fecha.trim(),
      descripcion: this.nuevoSorteo.descripcion.trim() || undefined,
      tipo: this.nuevoSorteo.tipo,
      premio_descripcion: this.nuevoSorteo.premio_descripcion.trim() || undefined
    }).subscribe({
      next: (s) => {
        if (s) {
          this.sorteos = [...this.sorteos, s];
          this.nuevoSorteo = { nombre: '', fecha: '', descripcion: '', tipo: 'anticipado', premio_descripcion: '', numeros_beneficiados: '' };
        }
        this.guardandoSorteo = false;
      },
      error: (err) => {
        if (err?.status === 401) this.on401();
        else this.error = 'Error al crear el sorteo.';
        this.guardandoSorteo = false;
      }
    });
  }

  realizarSorteo(s: Sorteo): void {
    if (s.estado === 'realizado') return;
    this.ganadorActual = null;
    this.realizandoId = s.id;
    this.adminService.realizarSorteo(s.id).subscribe({
      next: (res) => {
        if (res?.sorteo) {
          this.sorteos = this.sorteos.map(x => x.id === res.sorteo.id ? res.sorteo : x);
        }
        this.ganadorActual = res ?? null;
        this.realizandoId = null;
      },
      error: (err) => {
        if (err?.status === 401) this.on401();
        this.realizandoId = null;
      }
    });
  }

  formatCents(cents: number): string {
    return (cents / 100).toFixed(2);
  }

  formatDate(s: string): string {
    if (!s) return '-';
    try {
      return new Date(s).toLocaleDateString('es');
    } catch {
      return s;
    }
  }
}
