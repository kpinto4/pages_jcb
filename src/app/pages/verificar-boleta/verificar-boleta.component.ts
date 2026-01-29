import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-verificar-boleta',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './verificar-boleta.component.html',
  styleUrls: ['./verificar-boleta.component.scss']
})
export class VerificarBoletaComponent {

  cedula = '';
  boletas: any[] = [];

  buscarBoletas(event: Event) {
    event.preventDefault();

    // SIMULACIÓN
    this.boletas = [
      {
        codigo: 'STK-0234',
        numero1: 1234,
        numero2: 5678,
        pagado: true
      },
      {
        codigo: 'STK-0235',
        numero1: 2234,
        numero2: 6678,
        pagado: false
      }
    ];
  }
}
