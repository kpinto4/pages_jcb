import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-comprar-stikers',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './comprar-stikers.component.html',
  styleUrls: ['./comprar-stikers.component.scss']
})
export class ComprarStikersComponent {

  stikers = [
    { codigo: 'STK-001', n1: 1234, n2: 5678, disponible: true },
    { codigo: 'STK-002', n1: 2234, n2: 6678, disponible: false },
    { codigo: 'STK-003', n1: 3234, n2: 7678, disponible: true }
  ];

  reservar(stiker: any) {
    stiker.disponible = false;
    alert('Stiker reservado por 24 horas');
  }
}
