import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Sorteo } from '../../core/services/sorteos.service';

@Component({
  selector: 'app-premios',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './premios.component.html',
  styleUrls: ['./premios.component.scss']
})
export class PremiosComponent {
  @Input() mayoresRealizados: (Sorteo & { ganador_nombre?: string })[] = [];
  @Input() loading = false;

  get sorteos(): (Sorteo & { ganador_nombre?: string })[] {
    return this.mayoresRealizados || [];
  }

  formatDate(fecha: string): string {
    if (!fecha) return '';
    try {
      return new Date(fecha).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch {
      return fecha;
    }
  }
}
