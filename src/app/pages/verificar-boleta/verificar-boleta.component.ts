import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PaymentService, StikerCompradoFromApi } from '../../core/services/payment.service';

@Component({
  selector: 'app-verificar-stiker',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './verificar-boleta.component.html',
  styleUrls: ['./verificar-boleta.component.scss']
})
export class VerificarStikerComponent {

  cedula = '';
  stikers: StikerCompradoFromApi[] = [];
  buscando = false;
  error = '';

  constructor(private paymentService: PaymentService) {}

  buscarStikers(event: Event) {
    event.preventDefault();
    const ced = this.cedula.trim();
    if (!ced) {
      this.error = 'Ingresa tu número de cédula.';
      return;
    }
    this.error = '';
    this.buscando = true;
    this.paymentService.getStikersPorCedula(ced).subscribe({
      next: (res) => {
        this.stikers = res.stikers || [];
        this.buscando = false;
        if (this.stikers.length === 0) {
          this.error = 'No se encontraron stikers para esta cédula.';
        }
      },
      error: () => {
        this.buscando = false;
        this.error = 'No se pudo conectar con el servidor. Verifica que el backend esté en marcha.';
      }
    });
  }
}
