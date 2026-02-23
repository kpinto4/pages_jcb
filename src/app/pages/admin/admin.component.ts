import { Component, OnInit, OnDestroy } from '@angular/core';
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
export class AdminComponent implements OnInit, OnDestroy {

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
    premio_descripcion: '',
    imagen_url: ''
  };
  imagenFile: File | null = null;
  guardandoSorteo = false;
  realizandoId: number | null = null;

  editSorteoId: number | null = null;
  editForm: { nombre: string; fecha: string; premio_descripcion: string; numeros_beneficiados: string; imagen_url: string } = { nombre: '', fecha: '', premio_descripcion: '', numeros_beneficiados: '', imagen_url: '' };
  guardandoEditId: number | null = null;

  config = {
    precioStikerDollars: 50,
    currency: 'cop'
  };
  guardandoConfig = false;
  configGuardada = false;
  resettingStikers = false;

  ganadorActual: SorteoGanadorResponse | null = null;

  /** Flujo realizar con número de lotería: sorteo elegido, número ingresado, resultado de consultar */
  sorteoParaRealizar: Sorteo | null = null;
  numeroGanadorInput = '';
  consultandoGanador = false;
  ganadorConsultado: SorteoGanadorResponse['ganador'] | null = null;
  stikerGanadorConsultado: string | null = null;
  errorRealizar = '';
  showExtenderFecha = false;

  confirmandoId: string | null = null;

  beneficios: BeneficioAnticipado[] = [];
  revisandoBeneficios = false;
  private beneficiosPollingId: ReturnType<typeof setInterval> | null = null;
  private readonly BENEFICIOS_POLL_MS = 10000;

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
      this.cargarConfig();
    }
  }

  ngOnDestroy(): void {
    this.stopBeneficiosPolling();
  }

  selectTab(t: 'stats' | 'orders' | 'sorteos' | 'beneficios' | 'config'): void {
    if (this.tab === 'beneficios' && t !== 'beneficios') this.stopBeneficiosPolling();
    this.tab = t;
    if (t === 'beneficios') {
      this.cargarBeneficios();
      this.startBeneficiosPolling();
    }
  }

  private startBeneficiosPolling(): void {
    this.stopBeneficiosPolling();
    this.beneficiosPollingId = setInterval(() => {
      if (this.tab === 'beneficios') this.cargarBeneficios();
    }, this.BENEFICIOS_POLL_MS);
  }

  private stopBeneficiosPolling(): void {
    if (this.beneficiosPollingId != null) {
      clearInterval(this.beneficiosPollingId);
      this.beneficiosPollingId = null;
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
          if (this.tab === 'beneficios') {
            this.cargarBeneficios();
            this.startBeneficiosPolling();
          }
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

  /** Sorteos en estado programado (activos), ordenados: premio mayor primero, luego anticipados. */
  get sorteosActivos(): Sorteo[] {
    const activos = this.sorteos.filter((s) => s.estado === 'programado');
    return activos.sort((a, b) => {
      if (a.tipo === 'mayor' && b.tipo !== 'mayor') return -1;
      if (a.tipo !== 'mayor' && b.tipo === 'mayor') return 1;
      if (a.tipo === 'mayor' && b.tipo === 'mayor') return a.id - b.id;
      return (a.sorteo_mayor_id ?? 0) - (b.sorteo_mayor_id ?? 0) || a.id - b.id;
    });
  }

  /** Sorteos terminados agrupados: un ítem por premio mayor realizado con sus anticipados. */
  get terminadosAgrupados(): { mayor: Sorteo; anticipados: Sorteo[] }[] {
    const mayores = this.sorteos.filter((s) => s.tipo === 'mayor' && s.estado === 'realizado');
    return mayores
      .sort((a, b) => (new Date(b.fecha).getTime() - new Date(a.fecha).getTime()))
      .map((mayor) => ({
        mayor,
        anticipados: this.sorteos.filter((s) => s.sorteo_mayor_id === mayor.id)
      }));
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

  revisarBeneficios(): void {
    this.revisandoBeneficios = true;
    this.adminService.revisarBeneficios().subscribe({
      next: (r) => {
        this.revisandoBeneficios = false;
        if (r?.ok) {
          this.cargarBeneficios();
          if (r.nuevasCoincidencias > 0) {
            this.error = '';
            alert(`Se encontraron ${r.nuevasCoincidencias} nueva(s) coincidencia(s) con números bendecidos.`);
          }
        }
      },
      error: (err) => {
        this.revisandoBeneficios = false;
        if (err?.status === 401) this.on401();
      }
    });
  }

  onImagenFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) {
      this.imagenFile = input.files[0];
      this.nuevoSorteo.imagen_url = ''; // clear URL if file selected
    }
  }

  crearSorteo(): void {
    if (!this.nuevoSorteo.nombre.trim() || !this.nuevoSorteo.fecha.trim()) {
      this.error = 'Nombre y fecha son obligatorios.';
      return;
    }
    const imagenUrl = this.nuevoSorteo.imagen_url?.trim();
    if (!imagenUrl && !this.imagenFile) {
      this.error = 'Es obligatoria la imagen del premio (URL o subir archivo) para el hero.';
      return;
    }
    this.error = '';
    this.guardandoSorteo = true;

    const doCreate = (url: string) => {
      this.adminService.createSorteo({
        nombre: this.nuevoSorteo.nombre.trim(),
        fecha: this.nuevoSorteo.fecha.trim(),
        descripcion: this.nuevoSorteo.descripcion.trim() || undefined,
        tipo: 'mayor',
        premio_descripcion: this.nuevoSorteo.premio_descripcion.trim() || undefined,
        imagen_url: url
      }).subscribe({
        next: (s) => {
          if (s) {
            this.cargarSorteos();
            this.nuevoSorteo = { nombre: '', fecha: '', descripcion: '', premio_descripcion: '', imagen_url: '' };
            this.imagenFile = null;
          }
          this.guardandoSorteo = false;
        },
        error: (err) => {
          if (err?.status === 401) this.on401();
          else this.error = err?.error?.error || 'Error al crear el sorteo.';
          this.guardandoSorteo = false;
        }
      });
    };

    // Si hay URL, usarla (más fiable en producción/Vercel). Si no, intentar subir el archivo.
    if (imagenUrl) {
      doCreate(imagenUrl);
    } else if (this.imagenFile) {
      this.adminService.uploadImage(this.imagenFile).subscribe({
        next: (res) => {
          if (res?.url) doCreate(res.url);
          else {
            this.error = 'No se pudo subir la imagen. Usa la URL de la imagen (sube la imagen a Imgur o similar y pega el enlace).';
            this.guardandoSorteo = false;
          }
        },
        error: () => {
          this.error = 'Error al subir la imagen. Usa la URL de la imagen (sube la imagen a Imgur o similar y pega el enlace).';
          this.guardandoSorteo = false;
        }
      });
    }
  }

  editarSorteo(s: Sorteo): void {
    this.editSorteoId = s.id;
    this.editForm = {
      nombre: s.nombre,
      fecha: s.fecha,
      premio_descripcion: s.premio_descripcion || '',
      numeros_beneficiados: s.numeros_beneficiados || '',
      imagen_url: s.imagen_url || ''
    };
  }

  guardarEdicionSorteo(): void {
    if (this.editSorteoId == null) return;
    this.guardandoEditId = this.editSorteoId;
    const body = {
      nombre: this.editForm.nombre.trim(),
      fecha: this.editForm.fecha.trim(),
      premio_descripcion: this.editForm.premio_descripcion.trim() || undefined,
      numeros_beneficiados: this.editForm.numeros_beneficiados.trim() || undefined,
      imagen_url: this.editForm.imagen_url.trim() || undefined
    };
    this.adminService.updateSorteo(this.editSorteoId, body).subscribe({
      next: (updated) => {
        if (updated) {
          this.sorteos = this.sorteos.map((x) => (x.id === updated.id ? updated : x));
        }
        this.cancelarEdicion();
        this.guardandoEditId = null;
      },
      error: (err) => {
        if (err?.status === 401) this.on401();
        this.guardandoEditId = null;
      }
    });
  }

  cancelarEdicion(): void {
    this.editSorteoId = null;
    this.editForm = { nombre: '', fecha: '', premio_descripcion: '', numeros_beneficiados: '', imagen_url: '' };
  }

  reiniciarStikerSlots(): void {
    if (!confirm('Se borrarán todos los stikers actuales y se crearán 5000 nuevos (10000 números). Las ventas ya hechas siguen en el sistema pero la grilla de Comprar Stikers mostrará los nuevos. ¿Continuar?')) return;
    this.resettingStikers = true;
    this.adminService.resetStikerSlots().subscribe({
      next: (res) => {
        this.resettingStikers = false;
        if (res?.ok) this.error = ''; else this.error = 'No se pudo reiniciar.';
      },
      error: (err) => {
        if (err?.status === 401) this.on401();
        this.resettingStikers = false;
      }
    });
  }

  abrirRealizarSorteo(s: Sorteo): void {
    const tipo = (s.tipo || '').toLowerCase();
    if (s.estado === 'realizado' || tipo !== 'mayor') return;
    this.sorteoParaRealizar = s;
    this.numeroGanadorInput = '';
    this.ganadorConsultado = null;
    this.stikerGanadorConsultado = null;
    this.errorRealizar = '';
    this.showExtenderFecha = false;
    setTimeout(() => {
      const el = document.getElementById('panel-realizar-sorteo');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);
  }

  cerrarRealizarSorteo(): void {
    this.sorteoParaRealizar = null;
    this.numeroGanadorInput = '';
    this.ganadorConsultado = null;
    this.stikerGanadorConsultado = null;
    this.errorRealizar = '';
    this.showExtenderFecha = false;
    this.ganadorActual = null;
  }

  verGanador(): void {
    const num = this.numeroGanadorInput.trim().replace(/\D/g, '').slice(0, 4);
    if (!this.sorteoParaRealizar || !num) {
      this.errorRealizar = 'Ingresa el número ganador de 4 cifras (ej. 1234).';
      return;
    }
    this.errorRealizar = '';
    this.consultandoGanador = true;
    this.stikerGanadorConsultado = null;
    this.adminService.consultarGanador(this.sorteoParaRealizar.id, num).subscribe({
      next: (res) => {
        this.consultandoGanador = false;
        this.ganadorConsultado = res?.ganador ?? null;
        this.stikerGanadorConsultado = res?.stiker_ganador ?? null;
        if (!this.ganadorConsultado) {
          this.errorRealizar = res?.existe_sin_pagar
            ? 'Hay una venta con ese número pero la orden no está marcada como pagada. Confirma el pago en Stripe o espera el webhook.'
            : 'No hay comprador con un stiker que contenga ese número. Puedes extender la fecha del sorteo para dar más posibilidades.';
          this.showExtenderFecha = !res?.existe_sin_pagar;
        }
      },
      error: (err) => {
        this.consultandoGanador = false;
        if (err?.status === 401) this.on401();
        this.errorRealizar = err?.error?.error || 'Error al consultar.';
      }
    });
  }

  confirmarRealizarSorteo(): void {
    const num = this.numeroGanadorInput.trim().replace(/\D/g, '').slice(0, 4);
    if (!this.sorteoParaRealizar || !num) {
      this.errorRealizar = 'Ingresa el número ganador de 4 cifras.';
      return;
    }
    this.errorRealizar = '';
    this.realizandoId = this.sorteoParaRealizar.id;
    this.adminService.realizarSorteo(this.sorteoParaRealizar.id, num).subscribe({
      next: (res) => {
        this.ganadorActual = res ?? null;
        this.realizandoId = null;
        this.cerrarRealizarSorteo();
        this.cargarSorteos();
      },
      error: (err) => {
        this.realizandoId = null;
        if (err?.status === 401) this.on401();
        if (err?.error?.code === 'no_ganador') {
          this.errorRealizar = err?.error?.error || 'No hay ganador con ese número.';
          this.showExtenderFecha = true;
        } else {
          this.errorRealizar = err?.error?.error || 'Error al realizar el sorteo.';
        }
      }
    });
  }

  extenderFechaSorteo(): void {
    if (this.sorteoParaRealizar) {
      this.editarSorteo(this.sorteoParaRealizar);
      this.cerrarRealizarSorteo();
      this.error = 'Actualiza la fecha del sorteo más abajo y guarda. Luego podrás realizar el sorteo cuando haya ganador.';
    }
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
