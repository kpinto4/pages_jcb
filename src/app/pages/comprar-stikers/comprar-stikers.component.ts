import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { PaymentService, SessionDetails } from '../../core/services/payment.service';

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
export class ComprarStikersComponent implements OnInit {

  step = 1;
  procesandoPago = false;
  errorPago = '';
  pagoCancelado = false;

  /** Precio por stiker en centavos (desde backend; fallback 5000 = $50) */
  precioStikerCents = 5000;
  /** Moneda para Stripe */
  currency = 'usd';
  /** Precio por stiker en unidades (para mostrar): precioStikerCents / 100 */
  get precioStiker(): number {
    return this.precioStikerCents / 100;
  }

  busqueda = '';
  cantidadAleatoria = 1;

  stikers: Stiker[] = [];
  cargandoStikers = true;

  cliente = {
    nombre: '',
    cedula: '',
    telefono: '',
    email: ''
  };

  /** Datos mostrados en la pantalla de éxito (vuelta desde Stripe o simulación) */
  successData: {
    customerName?: string;
    customerEmail?: string;
    amountTotal: number;
    stikersDetail?: string;
  } | null = null;

  constructor(
    private paymentService: PaymentService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.paymentService.getConfig().subscribe({
      next: (c) => {
        this.precioStikerCents = c.precioStikerCents ?? 5000;
        this.currency = c.currency ?? 'usd';
      }
    });

    this.cargandoStikers = true;
    this.paymentService.getStikers().subscribe({
      next: (res) => {
        if (res.stikers && res.stikers.length > 0) {
          this.stikers = res.stikers.map(s => ({
            numeroA: s.numeroA,
            numeroB: s.numeroB,
            estado: s.estado as 'libre' | 'ocupado'
          }));
        } else {
          this.generarStikers();
        }
        this.cargandoStikers = false;
      },
      error: () => {
        this.generarStikers();
        this.cargandoStikers = false;
      }
    });

    this.route.queryParams.subscribe((params) => {
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
        this.procesandoPago = true;
        this.paymentService.getSessionDetails(sessionId).subscribe({
          next: (session) => {
            this.procesandoPago = false;
            this.setSuccessFromSession(session);
            this.step = 4;
            this.limpiarQueryParams();
          },
          error: () => {
            this.procesandoPago = false;
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

  generarStikers(): void {
    for (let i = 0; i < 60; i++) {
      this.stikers.push({
        numeroA: this.random4(),
        numeroB: this.random4(),
        estado: Math.random() < 0.3 ? 'ocupado' : 'libre'
      });
    }
  }

  random4(): string {
    return Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  }

  toggleStiker(stiker: Stiker): void {
    if (stiker.estado === 'ocupado') return;
    stiker.estado =
      stiker.estado === 'seleccionado' ? 'libre' : 'seleccionado';
  }

  get stikersFiltrados(): Stiker[] {
    if (!this.busqueda) return this.stikers;
    return this.stikers.filter(s =>
      s.numeroA.includes(this.busqueda) ||
      s.numeroB.includes(this.busqueda)
    );
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

  /** Total en centavos para Stripe */
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

  irAPagar(): void {
    this.errorPago = '';
    this.pagoCancelado = false;

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
        if (res?.url) {
          window.location.href = res.url;
        } else {
          this.procesandoPago = false;
          this.errorPago = 'No se recibió la URL de pago. Revisa la configuración del servidor.';
        }
      },
      error: (err) => {
        this.procesandoPago = false;
        const msg = err?.error?.error || err?.message || 'No se pudo conectar con el servidor de pago.';
        this.errorPago = msg + ' Asegúrate de tener el backend encendido y STRIPE_SECRET_KEY en server/.env.';
      }
    });
  }

  /** Simulación de pago (cuando no hay backend o para pruebas) */
  simularPago(): void {
    this.errorPago = '';
    this.procesandoPago = true;

    setTimeout(() => {
      this.procesandoPago = false;
      this.successData = {
        customerName: this.cliente.nombre || undefined,
        customerEmail: this.cliente.email || undefined,
        amountTotal: this.total,
        stikersDetail: this.seleccionados.map(s => `${s.numeroA} - ${s.numeroB}`).join(', ')
      };
      this.step = 4;
    }, 2000);
  }
}
