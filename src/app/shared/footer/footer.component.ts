import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-footer',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './footer.component.html',
  styleUrl: './footer.component.scss'
})
export class FooterComponent {
  year = new Date().getFullYear();

  readonly socialFacebookUrl = (environment.socialFacebookUrl || '').trim();
  readonly socialInstagramUrl = (environment.socialInstagramUrl || '').trim();
  readonly socialTiktokUrl = (environment.socialTiktokUrl || '').trim();

  get hasSocialLinks(): boolean {
    return !!(this.socialFacebookUrl || this.socialInstagramUrl || this.socialTiktokUrl);
  }
}
