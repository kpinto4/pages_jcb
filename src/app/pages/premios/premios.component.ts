import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

interface PremioAnticipado {
  id: number;
  nombre: string;
  descripcion: string;
  ganador?: string;
}

@Component({
  selector: 'app-premios',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './premios.component.html',
  styleUrls: ['./premios.component.scss']
})
export class PremiosComponent {

  premioMayor = {
    titulo: 'Premio Mayor',
    descripcion: 'Moto 0 KM + bonos sorpresa',
    imagen: 'assets/premio-mayor.jpg'
  };

  anticipados: PremioAnticipado[] = [
    { id: 1, nombre: 'Bono $100.000', descripcion: 'Sorteo anticipado' },
    { id: 2, nombre: 'Audífonos', descripcion: 'Sorteo anticipado' },
    { id: 3, nombre: 'Bono gasolina', descripcion: 'Sorteo anticipado' }
  ];

  sortearAnticipado(premio: PremioAnticipado) {
    premio.ganador = 'Stiker #23 - 78';
    alert(`Ganador: ${premio.ganador}`);
  }

  asignarPremioMayor(numeroGanador: string) {
    alert(`Premio mayor ganado por el stiker ${numeroGanador}`);
  }
}
