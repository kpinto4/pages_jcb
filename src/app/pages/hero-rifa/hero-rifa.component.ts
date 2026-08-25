import { Component, OnInit, OnDestroy } from '@angular/core';
import { RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil, finalize } from 'rxjs';
import { SorteosService, Sorteo, ProgresoResponse } from '../../core/services/sorteos.service';
import { resolveImageUrl } from '../../core/services/api-url';
import { LoadingIndicatorComponent } from '../../shared/loading-indicator/loading-indicator.component';

@Component({
  selector: 'app-hero-rifa',
  standalone: true,
  imports: [CommonModule, RouterModule, LoadingIndicatorComponent],
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
  /** true cuando ya pasó la hora de cierre de ventas del sorteo de hoy (hora_sorteo - 1h). */
  ventasCerradas = false;
  /** Evita mostrar “próximamente” antes de que responda el API */
  cargandoHero = true;
  /** Carga de la imagen del premio (spinner hasta load/error) */
  heroImgLoaded = false;
  heroImgFailed = false;

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
    this.cargandoHero = true;
    this.sorteosService
      .getHomeData()
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => {
          this.cargandoHero = false;
        })
      )
      .subscribe({
        next: (data) => {
          if (!data) {
            this.principal = null;
            return;
          }
          this.principal = data.principal ?? null;
          if (!this.principal) return;

          this.ventasCerradas = !!this.principal.ventasCerradas;
          this.heroImgLoaded = false;
          this.heroImgFailed = false;
          if (this.principal.imagen_url) {
            this.heroImageUrl = resolveImageUrl(this.principal.imagen_url) || this.heroImageUrl;
          } else {
            this.heroImageUrl = 'assets/img/premio-mayor.jpg';
          }
          this.startCountdown(this.principal.fecha, this.principal.hora_sorteo);
        },
        error: () => {
          this.principal = null;
        }
      });
  }

  private loadProgreso(): void {
    this.sorteosService.getProgreso().pipe(takeUntil(this.destroy$)).subscribe((data: ProgresoResponse | null) => {
      if (!data) {
        return;
      }
      this.soldStikers = data.totalStikersSold;
      this.totalStikers = data.totalStikers;
    });
  }

  private startCountdown(dateIso: string, horaSorteo?: string | null): void {
    if (this.countdownIntervalId) {
      clearInterval(this.countdownIntervalId);
    }
    // Si hay hora de sorteo, la cuenta regresiva apunta al momento exacto del sorteo (hora Colombia,
    // UTC-5 fijo). Si no, cae a medianoche de la fecha (comportamiento anterior).
    let targetDate: number;
    if (horaSorteo && /^\d{2}:\d{2}$/.test(horaSorteo) && /^\d{4}-\d{2}-\d{2}$/.test(dateIso)) {
      targetDate = new Date(`${dateIso}T${horaSorteo}:00-05:00`).getTime();
    } else {
      // Normalizar "YYYY-MM-DD" a medianoche hora local para evitar bug UTC off-by-one en Colombia
      const normalized = /^\d{4}-\d{2}-\d{2}$/.test(dateIso) ? `${dateIso}T00:00:00` : dateIso;
      targetDate = new Date(normalized).getTime();
    }
    if (!targetDate) return;

    this.updateCountdown(targetDate);
    this.countdownIntervalId = setInterval(() => {
      this.updateCountdown(targetDate);
    }, 1000);
  }

  onHeroImgLoad(): void {
    this.heroImgLoaded = true;
    this.heroImgFailed = false;
  }

  onHeroImgError(): void {
    this.heroImgFailed = true;
    this.heroImgLoaded = true;
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
