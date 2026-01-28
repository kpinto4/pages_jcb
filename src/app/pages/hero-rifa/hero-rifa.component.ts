import { Component, OnInit } from '@angular/core';

@Component({
  selector: 'app-hero-rifa',
  standalone: true,
  templateUrl: './hero-rifa.component.html',
  styleUrls: ['./hero-rifa.component.scss']
})
export class HeroRifaComponent implements OnInit {
  dias = 0;
  horas = 0;
  minutos = 0;
  segundos = 0;

  fechaSorteo = new Date('2026-02-14T00:00:00');

  ngOnInit() {
    this.actualizarContador();
    setInterval(() => this.actualizarContador(), 1000);
  }

  actualizarContador() {
    const ahora = new Date().getTime();
    const distancia = this.fechaSorteo.getTime() - ahora;

    if (distancia < 0) return;

    this.dias = Math.floor(distancia / (1000 * 60 * 60 * 24));
    this.horas = Math.floor((distancia / (1000 * 60 * 60)) % 24);
    this.minutos = Math.floor((distancia / (1000 * 60)) % 60);
    this.segundos = Math.floor((distancia / 1000) % 60);
  }
}
