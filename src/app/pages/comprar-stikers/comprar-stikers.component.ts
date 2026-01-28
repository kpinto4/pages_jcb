import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

interface Stiker {
  id: number;
  numero1: number;
  numero2: number;
  disponible: boolean;
}

@Component({
  selector: 'app-comprar-stikers',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './comprar-stikers.component.html',
  styleUrls: ['./comprar-stikers.component.scss']
})
export class ComprarStikersComponent {

  buscarNumero: number | null = null;
  cantidadAzar = 1;

  stikers: Stiker[] = [
    { id: 1, numero1: 12, numero2: 45, disponible: true },
    { id: 2, numero1: 23, numero2: 78, disponible: false },
    { id: 3, numero1: 34, numero2: 90, disponible: true },
    { id: 4, numero1: 56, numero2: 67, disponible: true },
  ];

  get stikersFiltrados() {
    if (!this.buscarNumero) return this.stikers;

    return this.stikers.filter(
      s => s.numero1 === this.buscarNumero || s.numero2 === this.buscarNumero
    );
  }

  comprarAzar() {
    const disponibles = this.stikers.filter(s => s.disponible);

    if (disponibles.length < this.cantidadAzar) {
      alert('No hay suficientes stikers disponibles');
      return;
    }

    alert(`Reservaste ${this.cantidadAzar} stiker(s) al azar`);
  }

  reservar(stiker: Stiker) {
    stiker.disponible = false;
    alert(`Stiker ${stiker.numero1} - ${stiker.numero2} reservado por 24 horas`);
  }
}
