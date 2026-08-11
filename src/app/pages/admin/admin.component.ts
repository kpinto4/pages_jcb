import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { AdminService, AdminStats, AdminOrder, Sorteo, SorteoGanadorResponse, BeneficioAnticipado, Diagnostico } from '../../core/services/admin.service';
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
  mobileNavOpen = false;

  get tabTitle(): string {
    const titles: Record<typeof this.tab, string> = {
      stats: 'Resumen',
      orders: 'Ventas',
      sorteos: 'Sorteos',
      beneficios: 'Números bendecidos',
      config: 'Configuración'
    };
    return titles[this.tab];
  }

  get tabSubtitle(): string {
    const subs: Record<typeof this.tab, string> = {
      stats: 'Vista general de ventas, campaña y actividad reciente.',
      orders: 'Órdenes pagadas y pendientes de confirmación.',
      sorteos: 'Crear, editar y realizar premios mayores y anticipados.',
      beneficios: 'Ganadores de anticipados listos para contactar.',
      config: 'Precio, cupos de anticipados y mantenimiento.'
    };
    return subs[this.tab];
  }

  get pctSold(): number {
    return this.stats?.pctSold ?? (
      this.stats && this.stats.totalStikers > 0
        ? Math.round((this.stats.totalStikersSold / this.stats.totalStikers) * 10000) / 100
        : 0
    );
  }

  get stikersLibres(): number {
    if (!this.stats) return 0;
    return Math.max(0, this.stats.totalStikers - this.stats.totalStikersSold - (this.stats.reservedStikers ?? 0));
  }

  get ordenesPendientesLista(): AdminOrder[] {
    return this.orders.filter((o) => o.status !== 'paid').slice(0, 5);
  }

  get ventasRecientes(): AdminOrder[] {
    return this.orders.filter((o) => o.status === 'paid').slice(0, 6);
  }

  get beneficiosRecientes(): BeneficioAnticipado[] {
    return this.beneficios.slice(0, 5);
  }

  get cuposAbiertos(): number {
    const pct = this.pctSold;
    return this.config.anticipadosPercent.filter((t) => pct >= t).length;
  }

  get premioMayorActivo(): Sorteo | null {
    return this.sorteosActivos.find((s) => (s.tipo || '').toLowerCase() === 'mayor') ?? null;
  }

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
  eliminandoSorteoId: number | null = null;

  editSorteoId: number | null = null;
  editForm: { nombre: string; fecha: string; premio_descripcion: string; numeros_beneficiados: string; imagen_url: string } = { nombre: '', fecha: '', premio_descripcion: '', numeros_beneficiados: '', imagen_url: '' };
  guardandoEditId: number | null = null;
  /** Archivos de foto seleccionados por sorteo terminado (key = sorteo id) */
  fotoGanadorFiles: { [id: number]: File } = {};

  config = {
    /** Precio por stiker en unidades de la moneda (COP, USD, etc.), no en centavos */
    precioStikerUnidad: 5000,
    currency: 'cop',
    anticipadosPercent: Array.from({ length: 10 }, () => 100)
  };
  guardandoConfig = false;
  configGuardada = false;
  resettingStikers = false;
  limpiandoPendientes = false;
  pendientesLimpiados: number | null = null;

  diagnostico: Diagnostico | null = null;
  diagnosticando = false;
  errorDiagnostico = '';

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
  private readonly destroy$ = new Subject<void>();

  /** Muestra/oculta la configuración avanzada de porcentajes de anticipados. */
  mostrarConfigAnticipados = false;

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
      this.cargarBeneficios();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.stopBeneficiosPolling();
  }

  selectTab(t: 'stats' | 'orders' | 'sorteos' | 'beneficios' | 'config'): void {
    if (this.tab === 'beneficios' && t !== 'beneficios') this.stopBeneficiosPolling();
    this.tab = t;
    this.mobileNavOpen = false;
    if (t === 'stats') {
      this.cargarStats();
      this.cargarOrders();
      this.cargarSorteos();
      this.cargarBeneficios();
    }
    if (t === 'beneficios') {
      this.cargarBeneficios();
      this.startBeneficiosPolling();
    }
    if (t === 'config' && !this.diagnostico) {
      this.ejecutarDiagnostico();
    }
  }

  /** Prueba en vivo BD, Wompi, SMTP, admin y CORS del backend actual (sin reiniciar el servidor). */
  ejecutarDiagnostico(): void {
    this.diagnosticando = true;
    this.errorDiagnostico = '';
    this.adminService.getDiagnostico().pipe(takeUntil(this.destroy$)).subscribe({
      next: (d) => {
        this.diagnosticando = false;
        if (d) {
          this.diagnostico = d;
        } else {
          this.errorDiagnostico = 'No se pudo obtener el diagnóstico del servidor.';
        }
      },
      error: (err) => {
        this.diagnosticando = false;
        if (err?.status === 401) this.on401();
        else this.errorDiagnostico = 'No se pudo obtener el diagnóstico del servidor.';
      }
    });
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
    this.auth.login(this.password).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.loginLoading = false;
        if (res?.token) {
          this.loggedIn = true;
          this.password = '';
          this.cargarStats();
          this.cargarOrders();
          this.cargarSorteos();
          this.cargarConfig();
          this.cargarBeneficios();
          if (this.tab === 'beneficios') {
            this.startBeneficiosPolling();
          }
        }
      },
      error: (err: { status?: number; message?: string }) => {
        this.loginLoading = false;
        this.loginError = err?.message || 'Contraseña incorrecta o backend no disponible.';
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
    this.adminService.getConfig().pipe(takeUntil(this.destroy$)).subscribe({
      next: (c) => {
        if (c?.precio_stiker_cents) {
          // El backend guarda centavos; mostramos en unidades (÷ 100)
          this.config.precioStikerUnidad = parseInt(c.precio_stiker_cents, 10) / 100;
        }
        if (c?.currency) this.config.currency = c.currency;
        if (c?.anticipados_percent) {
          const raw = c.anticipados_percent.split(',').map((p) => p.trim()).filter(Boolean);
          const arr = raw.map((p) => {
            const n = parseInt(p, 10);
            return !isNaN(n) && n > 0 && n <= 100 ? n : 100;
          });
          while (arr.length < 10) arr.push(100);
          this.config.anticipadosPercent = arr.slice(0, 10);
        }
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
      precioStikerCents: Math.round(this.config.precioStikerUnidad * 100),
      currency: this.config.currency,
      anticipadosPercent: this.config.anticipadosPercent.join(',')
    }).pipe(takeUntil(this.destroy$)).subscribe({
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
    this.adminService.getStats().pipe(takeUntil(this.destroy$)).subscribe({
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
    this.adminService.getOrders().pipe(takeUntil(this.destroy$)).subscribe({
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
    this.adminService.confirmCashOrder(o.id).pipe(takeUntil(this.destroy$)).subscribe({
      next: (updated) => {
        if (updated) {
          this.orders = this.orders.map(ord => ord.id === updated.id ? updated : ord);
          this.cargarStats();
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
    this.adminService.getSorteos().pipe(takeUntil(this.destroy$)).subscribe({
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
    this.adminService.getBeneficios().pipe(takeUntil(this.destroy$)).subscribe({
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
    this.adminService.revisarBeneficios().pipe(takeUntil(this.destroy$)).subscribe({
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
      }).pipe(takeUntil(this.destroy$)).subscribe({
        next: (s) => {
          this.guardandoSorteo = false;
          if (s) {
            this.cargarSorteos();
            this.nuevoSorteo = { nombre: '', fecha: '', descripcion: '', premio_descripcion: '', imagen_url: '' };
            this.imagenFile = null;
            this.error = '';
          } else {
            this.error = 'No se pudo crear el sorteo. Revisa la consola (F12) o intenta de nuevo.';
          }
        },
        error: (err) => {
          if (err?.status === 401) this.on401();
          else {
            const e = err?.error;
            const msg = typeof e === 'string' ? e : (e?.error ?? e?.message ?? 'Error al crear el sorteo.');
            this.error = typeof msg === 'string' ? msg : 'Error al crear el sorteo.';
          }
          this.guardandoSorteo = false;
        }
      });
    };

    // Si hay URL, usarla (más fiable en producción/Vercel). Si no, intentar subir el archivo.
    if (imagenUrl) {
      doCreate(imagenUrl);
    } else if (this.imagenFile) {
      this.adminService.uploadImage(this.imagenFile).pipe(takeUntil(this.destroy$)).subscribe({
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
    this.adminService.updateSorteo(this.editSorteoId, body).pipe(takeUntil(this.destroy$)).subscribe({
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
        this.error = err?.error?.error || err?.message || 'No se pudo guardar el sorteo.';
      }
    });
  }

  cancelarEdicion(): void {
    this.editSorteoId = null;
    this.editForm = { nombre: '', fecha: '', premio_descripcion: '', numeros_beneficiados: '', imagen_url: '' };
    this.fotoGanadorFiles = {};
  }

  onFotoFileChange(event: Event, id: number): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      this.fotoGanadorFiles = { ...this.fotoGanadorFiles, [id]: input.files[0] };
    }
  }

  guardarFotoGanador(id: number): void {
    const file = this.fotoGanadorFiles[id];
    if (!file) {
      this.error = 'Selecciona una imagen antes de guardar.';
      return;
    }
    this.guardandoEditId = id;
    this.error = '';

    this.adminService.uploadImage(file).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        if (!res?.url) {
          this.error = 'No se pudo subir la imagen. Intenta de nuevo.';
          this.guardandoEditId = null;
          return;
        }
        this.adminService.updateSorteo(id, { imagen_url: res.url }).pipe(takeUntil(this.destroy$)).subscribe({
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
            this.error = err?.error?.error || err?.message || 'No se pudo guardar la imagen.';
          }
        });
      },
      error: (err) => {
        if (err?.status === 401) this.on401();
        this.guardandoEditId = null;
        this.error = 'Error al subir la imagen. Intenta de nuevo.';
      }
    });
  }

  limpiarPendientes(): void {
    this.limpiandoPendientes = true;
    this.pendientesLimpiados = null;
    this.adminService.limpiarPendientes().pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.limpiandoPendientes = false;
        this.pendientesLimpiados = res?.expiradas ?? 0;
        setTimeout(() => (this.pendientesLimpiados = null), 5000);
      },
      error: (err) => {
        if (err?.status === 401) this.on401();
        this.limpiandoPendientes = false;
        this.error = 'No se pudo limpiar los pendientes.';
      }
    });
  }

  reiniciarStikerSlots(): void {
    if (!confirm('Se borrarán todos los stikers actuales y se crearán 5000 nuevos (10000 números). Las ventas ya hechas siguen en el sistema pero la grilla de Comprar Stikers mostrará los nuevos. ¿Continuar?')) return;
    this.resettingStikers = true;
    this.adminService.resetStikerSlots().pipe(takeUntil(this.destroy$)).subscribe({
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

  eliminarSorteo(s: Sorteo): void {
    if (s.estado === 'realizado') {
      this.error = 'No se puede eliminar un sorteo ya realizado.';
      return;
    }
    const esMayor = (s.tipo || '').toLowerCase() === 'mayor';
    const msg = esMayor
      ? 'Vas a eliminar este Premio Mayor y todos sus anticipados enlazados. Solo se permite si no hay ventas asociadas. ¿Continuar?'
      : 'Vas a eliminar este sorteo. ¿Continuar?';
    if (!confirm(msg)) return;

    this.eliminandoSorteoId = s.id;
    this.adminService.deleteSorteo(s.id).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        if (esMayor) {
          this.sorteos = this.sorteos.filter((x) => x.id !== s.id && x.sorteo_mayor_id !== s.id);
        } else {
          this.sorteos = this.sorteos.filter((x) => x.id !== s.id);
        }
        this.eliminandoSorteoId = null;
        this.error = '';
      },
      error: (err) => {
        if (err?.status === 401) {
          this.on401();
        } else {
          const e = err?.error;
          const msgErr = typeof e === 'string' ? e : (e?.error ?? e?.message ?? 'No se pudo eliminar el sorteo.');
          this.error = typeof msgErr === 'string' ? msgErr : 'No se pudo eliminar el sorteo.';
        }
        this.eliminandoSorteoId = null;
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
    this.adminService.consultarGanador(this.sorteoParaRealizar.id, num).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.consultandoGanador = false;
        this.ganadorConsultado = res?.ganador ?? null;
        this.stikerGanadorConsultado = res?.stiker_ganador ?? null;
        if (!this.ganadorConsultado) {
          this.errorRealizar = res?.existe_sin_pagar
            ? 'Hay una venta con ese número pero la orden no está marcada como pagada. Confirma el pago en Wompi o espera el webhook.'
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
    this.adminService.realizarSorteo(this.sorteoParaRealizar.id, num).pipe(takeUntil(this.destroy$)).subscribe({
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
    const value = cents / 100;
    const mon = (this.config.currency || 'cop').toLowerCase();
    try {
      return new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: mon.toUpperCase(),
        minimumFractionDigits: mon === 'cop' ? 0 : 2,
        maximumFractionDigits: mon === 'cop' ? 0 : 2
      }).format(value);
    } catch {
      return value.toLocaleString('es-CO');
    }
  }

  formatDate(s: string): string {
    if (!s) return '-';
    try {
      // Normalizar "YYYY-MM-DD" para evitar bug UTC off-by-one en zonas horarias negativas
      const normalized = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00` : s;
      return new Date(normalized).toLocaleDateString('es-CO', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });
    } catch {
      return s;
    }
  }

  private normalizePhone(tel: string | null | undefined): string {
    if (!tel) return '';
    let t = tel.toString().replace(/\D/g, '');
    if (!t) return '';
    // Asumimos Colombia (+57). Si ya viene con 57 al inicio y sobra longitud, recortamos a los últimos 10 dígitos.
    if (t.length > 10 && t.startsWith('57')) {
      t = t.slice(t.length - 10);
    }
    if (t.length === 10 && !t.startsWith('57')) {
      t = '57' + t;
    } else if (t.length < 12 && !t.startsWith('57')) {
      t = '57' + t;
    }
    return t;
  }

  private openWhatsApp(tel: string | null | undefined, message: string): void {
    const phone = this.normalizePhone(tel);
    if (!phone) {
      this.error = 'El cliente no tiene un teléfono válido para WhatsApp.';
      return;
    }
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
  }

  contactarPorWhatsappBeneficio(b: BeneficioAnticipado): void {
    const nombre = (b.nombre || 'cliente').trim();
    const sorteoNombre = (b.sorteo_nombre || `Sorteo #${b.sorteo_id}`).trim();
    const mensaje = `Hola ${nombre}, te contactamos de Juego de la Ciudad Bonita. Tu stiker ${b.numero_a} - ${b.numero_b} resultó ganador de un premio anticipado en el sorteo "${sorteoNombre}".`;
    this.openWhatsApp(b.telefono, mensaje);
  }

  contactarPorWhatsappMayor(): void {
    if (!this.ganadorActual || !this.ganadorActual.ganador) return;
    const g = this.ganadorActual.ganador;
    const sorteo = this.ganadorActual.sorteo;
    const nombre = (g.nombre || 'cliente').trim();
    const sorteoNombre = (sorteo?.nombre || 'Premio Mayor').trim();
    const fecha = this.formatDate(sorteo?.fecha || '');
    const numerosCliente = (g.numeros || []).map(n => `${n.numero_a} - ${n.numero_b}`).join(', ');
    const mensaje = `Hola ${nombre}, te contactamos de Juego de la Ciudad Bonita. Tus stikers (${numerosCliente}) resultaron ganadores del Premio Mayor en el sorteo "${sorteoNombre}" realizado el ${fecha}.`;
    this.openWhatsApp(g.telefono, mensaje);
  }

  /** trackBy para *ngFor de sorteos individuales (activos y anticipados dentro de grupos) */
  trackBySorteoId(_: number, s: Sorteo): number {
    return s.id;
  }

  /** trackBy para *ngFor de grupos terminados — evita recrear el DOM cuando el getter devuelve nuevos wrappers */
  trackByGrupoId(_: number, g: { mayor: Sorteo; anticipados: Sorteo[] }): number {
    return g.mayor.id;
  }
}
