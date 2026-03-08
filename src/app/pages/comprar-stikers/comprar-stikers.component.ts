import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { Subject, takeUntil, startWith, forkJoin } from 'rxjs';
import { PaymentService, SessionDetails } from '../../core/services/payment.service';
import { SorteosService } from '../../core/services/sorteos.service';

interface Stiker {
  numeroA: string;
  numeroB: string;
  estado: 'libre' | 'ocupado' | 'seleccionado';
}

@Component({
  selector: 'app-comprar-stikers',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './comprar-stikers.component.html',
  styleUrls: ['./comprar-stikers.component.scss']
})
export class ComprarStikersComponent implements OnInit, OnDestroy {

  private readonly destroy$ = new Subject<void>();
  step = 1;
  procesandoPago = false;
  errorPago = '';
  pagoCancelado = false;

  /** Precio por stiker en centavos (desde backend; fallback 5000 = $50) */
  precioStikerCents = 5000;
  /** Moneda (cop, usd, etc.) */
  currency = 'cop';
  /** Precio por stiker en unidades (para mostrar): precioStikerCents / 100 */
  get precioStiker(): number {
    return this.precioStikerCents / 100;
  }

  busqueda = '';
  cantidadAleatoria = 1;

  readonly PAGE_SIZE = 100;
  currentPage = 1;

  stikers: Stiker[] = [];
  cargandoStikers = true;

  cliente = {
    nombre: '',
    cedula: '',
    telefono: '',
    email: ''
  };

  /** Datos mostrados en la pantalla de éxito (vuelta desde Wompi o simulación) */
  successData: {
    customerName?: string;
    customerEmail?: string;
    amountTotal: number;
    stikersDetail?: string;
  } | null = null;

  /** Mostrar mensaje de pago en verificación cuando el webhook tarda */
  pagoEnVerificacion = false;
  /** True cuando volvemos de Wompi y estamos comprobando el estado del pago (polling) */
  verificandoVueltaPago = false;

  constructor(
    private paymentService: PaymentService,
    private sorteosService: SorteosService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.paymentService.getConfig().pipe(takeUntil(this.destroy$)).subscribe({
      next: (c) => {
        this.precioStikerCents = c.precioStikerCents ?? 5000;
        this.currency = c.currency ?? 'usd';
      }
    });

    this.cargandoStikers = true;
    forkJoin({
      home: this.sorteosService.getHomeData(),
      stikers: this.paymentService.getStikers()
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: ({ home: data, stikers: res }) => {
        if (!data?.principal) {
          this.stikers = [];
        } else if (res?.stikers && res.stikers.length > 0) {
          this.stikers = res.stikers.map(s => ({
            numeroA: s.numeroA,
            numeroB: s.numeroB,
            estado: s.estado as 'libre' | 'ocupado'
          }));
        } else {
          this.stikers = [];
        }
        this.cargandoStikers = false;
      },
      error: () => {
        this.stikers = [];
        this.cargandoStikers = false;
      }
    });

    this.route.queryParams.pipe(
      startWith(this.route.snapshot.queryParams),
      takeUntil(this.destroy$)
    ).subscribe((params) => {
      const success = params['success'] === 'true';
      const sessionId = params['session_id'];
      const canceled = params['canceled'] === 'true';

      if (canceled) {
        this.pagoCancelado = true;
        this.step = 3;
        this.limpiarQueryParams();
        return;
      }

      if (success && sessionId) {
        this.step = 4;
        this.procesandoPago = true;
        this.verificandoVueltaPago = true;
        this.pollSessionUntilPaid(sessionId, 0);
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private static readonly MAX_SESSION_POLL_ATTEMPTS = 15;

  private pollSessionUntilPaid(sessionId: string, attempt: number): void {
    this.paymentService.getSessionDetails(sessionId).pipe(takeUntil(this.destroy$)).subscribe({
      next: (session) => {
        if (session?.status === 'pending') {
          if (attempt < ComprarStikersComponent.MAX_SESSION_POLL_ATTEMPTS) {
            setTimeout(() => this.pollSessionUntilPaid(sessionId, attempt + 1), 2000);
            return;
          }
          // Agotamos intentos: el pago aún no fue confirmado por el webhook
          this.procesandoPago = false;
          this.verificandoVueltaPago = false;
          this.pagoEnVerificacion = true;
          this.step = 4;
          this.limpiarQueryParams();
          return;
        }
        this.procesandoPago = false;
        this.verificandoVueltaPago = false;
        this.pagoEnVerificacion = false;
        this.setSuccessFromSession(session);
        this.step = 4;
        this.limpiarQueryParams();
      },
      error: () => {
        this.procesandoPago = false;
        this.verificandoVueltaPago = false;
        this.pagoEnVerificacion = false;
        this.successData = {
          amountTotal: 0,
          customerEmail: undefined,
          stikersDetail: 'Pago completado. Recibirás la confirmación por correo.'
        };
        this.step = 4;
        this.limpiarQueryParams();
      }
    });
  }

  private setSuccessFromSession(session: SessionDetails | null): void {
    if (!session) {
      this.successData = { amountTotal: 0, stikersDetail: 'Pago completado.' };
      return;
    }
    const amount = session.amount_total != null ? session.amount_total / 100 : 0;
    this.successData = {
      customerName: session.metadata?.['customerName'] || undefined,
      customerEmail: session.customer_email || undefined,
      amountTotal: amount,
      stikersDetail: session.metadata?.['stikersDetail'] || undefined
    };
  }

  private limpiarQueryParams(): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {},
      queryParamsHandling: ''
    });
  }

  toggleStiker(stiker: Stiker): void {
    if (stiker.estado === 'ocupado') return;
    stiker.estado =
      stiker.estado === 'seleccionado' ? 'libre' : 'seleccionado';
  }

  get stikersFiltrados(): Stiker[] {
    if (!this.busqueda.trim()) return this.stikers;
    const q = this.busqueda.trim();
    return this.stikers.filter(s => {
      const a = s.numeroA;
      const b = s.numeroB;
      // Coincidencia exacta en uno de los dos números (ej. buscar 1983 → 1983-xxxx o xxxx-1983)
      if (a === q || b === q) return true;
      // Coincidencia parcial dentro de cada número de 4 cifras
      if (a.includes(q) || b.includes(q)) return true;
      return false;
    });
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.stikersFiltrados.length / this.PAGE_SIZE));
  }

  get stikersEnPagina(): Stiker[] {
    const f = this.stikersFiltrados;
    const start = (this.currentPage - 1) * this.PAGE_SIZE;
    return f.slice(start, start + this.PAGE_SIZE);
  }

  get paginasVisibles(): number[] {
    const total = this.totalPages;
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const p = this.currentPage;
    let from = Math.max(1, p - 3);
    let to = Math.min(total, from + 6);
    if (to - from < 6) from = Math.max(1, to - 6);
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  }

  onBusquedaChange(): void {
    this.currentPage = 1;
  }

  goToPage(page: number): void {
    if (page >= 1 && page <= this.totalPages) this.currentPage = page;
  }

  siguientePagina(): void {
    if (this.currentPage < this.totalPages) this.currentPage++;
  }

  irAUltima(): void {
    this.currentPage = this.totalPages;
  }

  get seleccionados(): Stiker[] {
    return this.stikers.filter(s => s.estado === 'seleccionado');
  }

  seleccionarAleatorios(): void {
    this.limpiarSeleccion();
    const libres = this.stikers.filter(s => s.estado === 'libre');
    libres
      .sort(() => 0.5 - Math.random())
      .slice(0, this.cantidadAleatoria)
      .forEach(s => s.estado = 'seleccionado');
  }

  limpiarSeleccion(): void {
    this.stikers.forEach(s => {
      if (s.estado === 'seleccionado') s.estado = 'libre';
    });
  }

  get total(): number {
    return this.seleccionados.length * this.precioStiker;
  }

  /** Total en centavos para la pasarela (Wompi) */
  get totalCentavos(): number {
    return this.seleccionados.length * this.precioStikerCents;
  }

  nextStep(): void {
    this.errorPago = '';
    this.pagoCancelado = false;
    this.step++;
  }

  prevStep(): void {
    this.errorPago = '';
    this.pagoCancelado = false;
    this.step--;
  }

  /** Formatea un precio en la moneda correcta. El valor ya viene en unidades (no centavos). */
  formatearPrecio(valor: number, moneda: string): string {
    const mon = (moneda || 'cop').toLowerCase();
    try {
      return new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: mon.toUpperCase(),
        minimumFractionDigits: mon === 'cop' ? 0 : 2,
        maximumFractionDigits: mon === 'cop' ? 0 : 2
      }).format(valor);
    } catch {
      return `${valor.toLocaleString('es-CO')} ${mon.toUpperCase()}`;
    }
  }

  irAPagar(): void {
    this.errorPago = '';
    this.pagoCancelado = false;

    if (!this.cliente.cedula?.trim()) {
      this.errorPago = 'El número de cédula es obligatorio para verificar tu compra.';
      return;
    }

    if (!this.cliente.email?.trim()) {
      this.errorPago = 'El correo electrónico es obligatorio para el pago.';
      return;
    }

    if (this.seleccionados.length === 0) {
      this.errorPago = 'No hay stikers seleccionados.';
      return;
    }

    this.procesandoPago = true;

    const stikersDetail = this.seleccionados
      .map(s => `${s.numeroA}-${s.numeroB}`)
      .join(', ');

    const selectedStikers = this.seleccionados.map(s => ({ numeroA: s.numeroA, numeroB: s.numeroB }));

    this.paymentService.createCheckoutSession({
      amount: this.totalCentavos,
      currency: this.currency,
      customerEmail: this.cliente.email.trim(),
      customerName: this.cliente.nombre.trim() || undefined,
      metadata: {
        cedula: this.cliente.cedula.trim() || '',
        telefono: this.cliente.telefono.trim() || '',
        stikersDetail: stikersDetail.slice(0, 500)
      },
      selectedStikers
    }).subscribe({
      next: (res) => {
        if (res?.checkoutUrl) {
          window.location.href = res.checkoutUrl;
        } else {
          this.procesandoPago = false;
          this.errorPago = 'No se recibió la URL de pago. Revisa la configuración del servidor.';
        }
      },
      error: (err) => {
        this.procesandoPago = false;
        const msg = err?.error?.error || err?.message || 'No se pudo conectar con el servidor de pago.';
        this.errorPago = err?.status === 503 ? msg : (msg + ' Asegúrate de tener el backend encendido.');
      }
    });
  }

  /** Simulación de pago: registra la compra en el backend para que aparezca al verificar por cédula. */
  simularPago(): void {
    this.errorPago = '';
    if (this.seleccionados.length === 0) {
      this.errorPago = 'Selecciona al menos un stiker.';
      return;
    }
    if (!this.cliente.cedula?.trim()) {
      this.errorPago = 'El número de cédula es obligatorio para verificar tu compra.';
      return;
    }
    if (!this.cliente.email?.trim()) {
      this.errorPago = 'El correo electrónico es obligatorio.';
      return;
    }

    this.procesandoPago = true;
    const selectedStikers = this.seleccionados.map(s => ({ numeroA: s.numeroA, numeroB: s.numeroB }));
    const stikersDetail = this.seleccionados.map(s => `${s.numeroA}-${s.numeroB}`).join(', ');

    this.paymentService.simulatePayment({
      amount: this.totalCentavos,
      currency: this.currency,
      customerEmail: this.cliente.email.trim(),
      customerName: this.cliente.nombre.trim() || undefined,
      metadata: {
        cedula: this.cliente.cedula.trim() || '',
        telefono: this.cliente.telefono.trim() || '',
        stikersDetail: stikersDetail.slice(0, 500)
      },
      selectedStikers
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.procesandoPago = false;
        this.successData = {
          customerName: this.cliente.nombre || undefined,
          customerEmail: this.cliente.email || undefined,
          amountTotal: this.total,
          stikersDetail: this.seleccionados.map(s => `${s.numeroA} - ${s.numeroB}`).join(', ')
        };
        this.step = 4;
      },
      error: (err) => {
        this.procesandoPago = false;
        this.errorPago = err?.error?.error || err?.message || 'No se pudo registrar la compra. ¿Está el backend encendido?';
      }
    });
  }
}
