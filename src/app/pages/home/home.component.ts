import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PremiosComponent } from '../premios/premios.component';
import { ComoParticiparComponent } from '../como-participar/como-participar.component';
import { HeroRifaComponent } from '../hero-rifa/hero-rifa.component';
import { SorteosService, AnticipadoHome, Sorteo } from '../../core/services/sorteos.service';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    CommonModule,
    HeroRifaComponent,
    PremiosComponent,
    ComoParticiparComponent
  ],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss']
})
export class HomeComponent implements OnInit {
  anticipadosActuales: AnticipadoHome[] = [];
  mayoresRealizados: (Sorteo & { ganador_nombre?: string })[] = [];
  loadingHome = true;

  constructor(private sorteosService: SorteosService) {}

  ngOnInit(): void {
    this.sorteosService.getHomeData().subscribe((data) => {
      this.loadingHome = false;
      if (!data) return;
      this.anticipadosActuales = data.anticipadosActuales ?? [];
      this.mayoresRealizados = data.mayoresRealizados ?? [];
    });
  }
}
