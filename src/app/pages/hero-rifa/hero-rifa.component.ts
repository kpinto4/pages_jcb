import { Component, OnInit, OnDestroy } from '@angular/core';
import { RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';
import { SorteosService, Sorteo, ProgresoResponse } from '../../core/services/sorteos.service';
import { resolveImageUrl } from '../../core/services/api-url';

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
  /** true cuando la API falló al cargar (muestra mensaje en el hero). */
  loadError = false;

  private countdownIntervalId: ReturnType<typeof setInterval> | null = null;
  private readonly destroy$ = new Subject<void>();

  constructor(private sorteosService: SorteosService) {}

  ngOnInit(): void {
    this.loadHomeData();
    this.loadProgreso();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.countdownIntervalId) {
      clearInterval(this.countdownIntervalId);
    }
  }

  get progressPercent(): number {
    if (!this.totalStikers) return 0;
    return (this.soldStikers / this.totalStikers) * 100;
  }

  private loadHomeData(): void {
    this.sorteosService.getHomeData().pipe(takeUntil(this.destroy$)).subscribe({
      next: (data) => {
        if (!data) {
          this.loadError = true;
          return;
        }
        this.loadError = false;
        this.principal = data.principal ?? null;
        if (!this.principal) return;
        if (this.principal.imagen_base64) {
          this.heroImageUrl = this.principal.imagen_base64;
        } else if (this.principal.imagen_url) {
          this.heroImageUrl = resolveImageUrl(this.principal.imagen_url) || this.heroImageUrl;
        }
        this.startCountdownFromDate(this.principal.fecha);
      },
      error: () => {
        this.loadError = true;
      }
    });
  }

  private loadProgreso(): void {
    this.sorteosService.getProgreso().pipe(takeUntil(this.destroy$)).subscribe({
      next: (data: ProgresoResponse | null) => {
        if (!data) return;
        this.soldStikers = data.totalStikersSold;
        this.totalStikers = data.totalStikers;
      }
    });
  }

  private startCountdownFromDate(dateIso: string): void {
    if (this.countdownIntervalId) {
      clearInterval(this.countdownIntervalId);
    }
    // Normalizar "YYYY-MM-DD" a medianoche hora local para evitar bug UTC off-by-one en Colombia
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(dateIso) ? `${dateIso}T00:00:00` : dateIso;
    const targetDate = new Date(normalized).getTime();
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
