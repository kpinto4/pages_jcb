import { Component, HostListener, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, NavigationEnd } from '@angular/router';
import { filter, Subscription } from 'rxjs';
import { SiteLinksService } from '../../core/services/site-links.service';

@Component({
  selector: 'app-contact-fab',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './contact-fab.component.html',
  styleUrl: './contact-fab.component.scss'
})
export class ContactFabComponent implements OnDestroy {
  /** Abre el panel de opciones */
  open = false;

  hideOnAdmin = false;

  private readonly sub: Subscription;

  constructor(
    readonly siteLinks: SiteLinksService,
    private readonly router: Router
  ) {
    this.hideOnAdmin = this.router.url.startsWith('/admin');
    this.sub = this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd)).subscribe(() => {
      this.hideOnAdmin = this.router.url.startsWith('/admin');
      if (this.hideOnAdmin) this.open = false;
    });
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open) this.close();
  }

  toggle(): void {
    this.open = !this.open;
  }

  close(): void {
    this.open = false;
  }

  backdropClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('contact-backdrop')) {
      this.close();
    }
  }
}
