import { Component, OnInit } from '@angular/core';

@Component({
  selector: 'app-hero-rifa',
  standalone: true,
  templateUrl: './hero-rifa.component.html',
  styleUrls: ['./hero-rifa.component.scss']
})
export class HeroRifaComponent implements OnInit {

  // Contador
  days = 0;
  hours = 0;
  minutes = 0;
  seconds = 0;

  // Stikers
  totalStikers = 1000;
  stikersVendidos = 420;
  porcentajeVendidos = 0;

  ngOnInit(): void {
    this.calcularProgreso();
    this.iniciarContador();
  }

  calcularProgreso() {
    this.porcentajeVendidos = Math.round(
      (this.stikersVendidos / this.totalStikers) * 100
    );
  }

  iniciarContador() {
    const fechaSorteo = new Date('2026-03-01T20:00:00').getTime();

    setInterval(() => {
      const ahora = new Date().getTime();
      const diferencia = fechaSorteo - ahora;

      this.days = Math.floor(diferencia / (1000 * 60 * 60 * 24));
      this.hours = Math.floor((diferencia / (1000 * 60 * 60)) % 24);
      this.minutes = Math.floor((diferencia / (1000 * 60)) % 60);
      this.seconds = Math.floor((diferencia / 1000) % 60);
    }, 1000);
  }
}
