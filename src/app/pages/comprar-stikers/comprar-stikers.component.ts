import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';

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
export class ComprarStikersComponent {

  step = 1;
  procesandoPago = false;

  precioStiker = 50;

  busqueda = '';
  cantidadAleatoria = 1;

  stikers: Stiker[] = [];

  cliente = {
    nombre: '',
    cedula: '',
    telefono: '',
    email: ''
  };

  constructor() {
    this.generarStikers();
  }

  generarStikers() {
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

  toggleStiker(stiker: Stiker) {
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

  seleccionarAleatorios() {
    this.limpiarSeleccion();
    const libres = this.stikers.filter(s => s.estado === 'libre');

    libres
      .sort(() => 0.5 - Math.random())
      .slice(0, this.cantidadAleatoria)
      .forEach(s => s.estado = 'seleccionado');
  }

  limpiarSeleccion() {
    this.stikers.forEach(s => {
      if (s.estado === 'seleccionado') s.estado = 'libre';
    });
  }

  get total(): number {
    return this.seleccionados.length * this.precioStiker;
  }

  nextStep() {
    this.step++;
  }

  prevStep() {
    this.step--;
  }

  simularPago() {
    this.procesandoPago = true;

    setTimeout(() => {
      this.procesandoPago = false;
      this.step = 4;
    }, 2500);
  }
}
