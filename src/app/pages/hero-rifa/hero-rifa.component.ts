import { Component, OnInit } from '@angular/core';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-hero-rifa',
  standalone: true,
  imports: [RouterModule],
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
  soldStikers = 345;
  totalStikers = 1000;

  ngOnInit(): void {
    this.startCountdown();
  }

  get progressPercent(): number {
    return (this.soldStikers / this.totalStikers) * 100;
  }

  startCountdown() {
    const targetDate = new Date('2026-03-01T00:00:00').getTime();

    setInterval(() => {
      const now = new Date().getTime();
      const diff = targetDate - now;

      this.days = Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
      this.hours = Math.max(0, Math.floor((diff / (1000 * 60 * 60)) % 24));
      this.minutes = Math.max(0, Math.floor((diff / (1000 * 60)) % 60));
      this.seconds = Math.max(0, Math.floor((diff / 1000) % 60));
    }, 1000);
  }
}
