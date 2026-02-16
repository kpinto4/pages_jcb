import { Component } from '@angular/core';
import { PremiosComponent } from '../premios/premios.component';
import { ComoParticiparComponent } from '../como-participar/como-participar.component';
import { HeroRifaComponent } from '../hero-rifa/hero-rifa.component';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    HeroRifaComponent,
    PremiosComponent,
    ComoParticiparComponent
  ],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss']
})
export class HomeComponent {}
