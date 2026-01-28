import { Component } from '@angular/core';
import { NavbarComponent } from '../../shared/navbar/navbar.component';
import { PremiosComponent } from '../premios/premios.component';
import { ComoParticiparComponent } from '../como-participar/como-participar.component';
import { ComprarStikersComponent } from '../comprar-stikers/comprar-stikers.component';
import { FooterComponent } from '../../shared/footer/footer.component';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    NavbarComponent,
    PremiosComponent,
    ComoParticiparComponent,
    ComprarStikersComponent,
    FooterComponent
  ],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss']
})
export class HomeComponent {}
