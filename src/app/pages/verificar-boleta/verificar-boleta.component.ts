import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PaymentService, BoletaFromApi } from '../../core/services/payment.service';

@Component({
  selector: 'app-verificar-boleta',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './verificar-boleta.component.html',
  styleUrls: ['./verificar-boleta.component.scss']
})
export class VerificarBoletaComponent {

  cedula = '';
  boletas: BoletaFromApi[] = [];
  buscando = false;
  error = '';

  constructor(private paymentService: PaymentService) {}

  buscarBoletas(event: Event) {
    event.preventDefault();
    const ced = this.cedula.trim();
    if (!ced) {
      this.error = 'Ingresa tu número de cédula.';
      return;
    }
    this.error = '';
    this.buscando = true;
    this.paymentService.getBoletas(ced).subscribe({
      next: (res) => {
        this.boletas = res.boletas || [];
        this.buscando = false;
        if (this.boletas.length === 0) {
          this.error = 'No se encontraron boletas para esta cédula.';
        }
      },
      error: () => {
        this.buscando = false;
        this.error = 'No se pudo conectar con el servidor. Verifica que el backend esté en marcha.';
      }
    });
  }
}
