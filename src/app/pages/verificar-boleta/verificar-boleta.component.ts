import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PaymentService, CompraVerificada, VerificacionCedula } from '../../core/services/payment.service';
import { LoadingIndicatorComponent } from '../../shared/loading-indicator/loading-indicator.component';

@Component({
  selector: 'app-verificar-stiker',
  standalone: true,
  imports: [CommonModule, FormsModule, LoadingIndicatorComponent],
  templateUrl: './verificar-boleta.component.html',
  styleUrls: ['./verificar-boleta.component.scss']
})
export class VerificarStikerComponent {

  cedula = '';
  compras: CompraVerificada[] = [];
  sorteo: VerificacionCedula['sorteo'] = null;
  buscando = false;
  error = '';

  readonly etiquetaEstado: Record<CompraVerificada['estado'], string> = {
    pagado: 'Pagado',
    pendiente: 'Pendiente',
    cancelado: 'Cancelado',
    rechazado: 'Rechazado'
  };

  readonly notaEstado: Record<CompraVerificada['estado'], string> = {
    pagado: '',
    pendiente: 'Aún no tenemos confirmación del pago. Tus números se muestran cuando el pago se confirme.',
    cancelado: 'El tiempo para pagar se agotó sin recibir el pago. No se hizo ningún cobro.',
    rechazado: 'El banco rechazó el pago. No se hizo ningún cobro.'
  };

  constructor(private paymentService: PaymentService) {}

  get numerosPagados(): number {
    return this.compras
      .filter((c) => c.estado === 'pagado')
      .reduce((acc, c) => acc + c.cantidadNumeros, 0);
  }

  formatearTotal(c: CompraVerificada): string {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: (c.currency || 'cop').toUpperCase(),
      maximumFractionDigits: 0
    }).format(c.totalCents / 100);
  }

  formatearFecha(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('es-CO', {
      day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota'
    }).format(d);
  }

  buscarStikers(event: Event) {
    event.preventDefault();
    const ced = this.cedula.trim();
    if (!ced) {
      this.error = 'Ingresa tu número de cédula.';
      return;
    }
    this.error = '';
    this.buscando = true;
    this.paymentService.getComprasPorCedula(ced).subscribe({
      next: (res) => {
        this.compras = res.compras || [];
        this.sorteo = res.sorteo || null;
        this.buscando = false;
        if (this.compras.length === 0) {
          this.error = 'No se encontraron compras para esta cédula en el sorteo actual.';
        }
      },
      error: (err) => {
        this.buscando = false;
        this.compras = [];
        this.sorteo = null;
        if (err?.status === 429) {
          this.error = 'Demasiadas consultas. Espera un momento e inténtalo de nuevo.';
          return;
        }
        this.error = 'No se pudo conectar con el servidor. Verifica que el backend esté en marcha.';
      }
    });
  }
}
