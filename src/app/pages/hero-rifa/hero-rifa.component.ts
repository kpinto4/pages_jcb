import { Component, OnInit } from '@angular/core';

@Component({
  selector: 'app-hero-rifa',
  standalone: true,
  templateUrl: './hero-rifa.component.html',
  styleUrls: ['./hero-rifa.component.scss']
})
export class HeroRifaComponent implements OnInit {

  // Cuenta regresiva
  targetDate = new Date('2026-03-01T00:00:00');
  days = 0;
  hours = 0;
  minutes = 0;
  seconds = 0;

  // Progreso stikers
  total = 1000;
  vendidos = 350;
  porcentaje = 0;

  ngOnInit() {
    this.calcularTiempo();
    setInterval(() => this.calcularTiempo(), 1000);

    this.porcentaje = Math.round((this.vendidos / this.total) * 100);
  }

  calcularTiempo() {
    const now = new Date().getTime();
    const distance = this.targetDate.getTime() - now;

    this.days = Math.floor(distance / (1000 * 60 * 60 * 24));
    this.hours = Math.floor((distance / (1000 * 60 * 60)) % 24);
    this.minutes = Math.floor((distance / (1000 * 60)) % 60);
    this.seconds = Math.floor((distance / 1000) % 60);
  }
}
