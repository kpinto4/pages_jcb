import { Component, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterOutlet, NavigationEnd } from '@angular/router';
import { filter, Subscription } from 'rxjs';
import { NavbarComponent } from './shared/navbar/navbar.component';
import { FooterComponent } from './shared/footer/footer.component';
import { ContactFabComponent } from './shared/contact-fab/contact-fab.component';

@Component({
  selector: 'app-root',
  imports: [CommonModule, RouterOutlet, NavbarComponent, FooterComponent, ContactFabComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnDestroy {
  title = 'Juego de la Ciudad Bonita';

  /** El panel de admin tiene su propio layout (navbar/footer/sidebar); ocultar los del sitio público. */
  isAdminRoute = false;

  private readonly sub: Subscription;

  constructor(private readonly router: Router) {
    this.isAdminRoute = this.router.url.startsWith('/admin');
    this.sub = this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd)).subscribe(() => {
      this.isAdminRoute = this.router.url.startsWith('/admin');
    });
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
  }
}
