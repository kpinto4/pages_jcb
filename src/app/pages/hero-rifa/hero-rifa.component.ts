import { Component, OnInit, OnDestroy } from '@angular/core';
import { RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { SorteosService, Sorteo, ProgresoResponse } from '../../core/services/sorteos.service';

@Component({
  selector: 'app-hero-rifa',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './hero-rifa.component.html',
  styleUrls: ['./hero-rifa.component.scss']
})
export class HeroRifaComponent implements OnInit, OnDestroy {

  // Contador
  days = 0;
  hours = 0;
  minutes = 0;
  seconds = 0;

  // Stikers
  soldStikers = 0;
  totalStikers = 0;

  // Sorteo principal (premio mayor)
  principal: Sorteo | null = null;
  heroImageUrl = 'assets/img/premio-mayor.jpg';

  private countdownIntervalId: any;

  constructor(private sorteosService: SorteosService) {}

  ngOnInit(): void {
    this.loadHomeData();
    this.loadProgreso();
  }

  ngOnDestroy(): void {
    if (this.countdownIntervalId) {
      clearInterval(this.countdownIntervalId);
    }
  }

  get progressPercent(): number {
    if (!this.totalStikers) return 0;
    return (this.soldStikers / this.totalStikers) * 100;
  }

  private loadHomeData(): void {
    this.sorteosService.getHomeData().subscribe((data) => {
      if (!data) return;
      this.principal = data.principal ?? null;
      if (!this.principal) return;
      if (this.principal.imagen_url) {
        this.heroImageUrl = this.principal.imagen_url;
      }
      this.startCountdownFromDate(this.principal.fecha);
    });
  }

  private loadProgreso(): void {
    this.sorteosService.getProgreso().subscribe((data: ProgresoResponse | null) => {
      if (!data) {
        return;
      }
      this.soldStikers = data.totalStikersSold;
      this.totalStikers = data.totalStikers;
    });
  }

  private startCountdownFromDate(dateIso: string): void {
    if (this.countdownIntervalId) {
      clearInterval(this.countdownIntervalId);
    }
    const targetDate = new Date(dateIso).getTime();
    if (!targetDate) return;

    this.updateCountdown(targetDate);
    this.countdownIntervalId = setInterval(() => {
      this.updateCountdown(targetDate);
    }, 1000);
  }

  private updateCountdown(targetTime: number): void {
    const now = new Date().getTime();
    const diff = targetTime - now;

    const safeDiff = Math.max(0, diff);
    this.days = Math.floor(safeDiff / (1000 * 60 * 60 * 24));
    this.hours = Math.floor((safeDiff / (1000 * 60 * 60)) % 24);
    this.minutes = Math.floor((safeDiff / (1000 * 60)) % 60);
    this.seconds = Math.floor((safeDiff / 1000) % 60);
  }
}
