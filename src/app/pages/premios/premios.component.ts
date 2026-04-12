import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Sorteo } from '../../core/services/sorteos.service';
import { resolveImageUrl } from '../../core/services/api-url';
import { LoadingIndicatorComponent } from '../../shared/loading-indicator/loading-indicator.component';

@Component({
  selector: 'app-premios',
  standalone: true,
  imports: [CommonModule, LoadingIndicatorComponent],
  templateUrl: './premios.component.html',
  styleUrls: ['./premios.component.scss']
})
export class PremiosComponent {
  @Input() mayoresRealizados: (Sorteo & {
    ganador_nombre?: string;
    ganador_cedula?: string;
    ganador_email?: string;
    ganador_telefono?: string;
  })[] = [];
  @Input() loading = false;

  readonly premioSkeletonSlots = [0, 1, 2];

  /** Sorteos expandidos (solo imagen visible por defecto, clic despliega info). */
  expandedIds = new Set<number>();

  toggleExpand(s: Sorteo): void {
    if (this.expandedIds.has(s.id)) {
      this.expandedIds.delete(s.id);
    } else {
      this.expandedIds.add(s.id);
    }
  }

  isExpanded(s: Sorteo): boolean {
    return this.expandedIds.has(s.id);
  }

  onCardKeydown(e: KeyboardEvent, s: Sorteo): void {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      this.toggleExpand(s);
    }
  }

  get sorteos(): (Sorteo & { ganador_nombre?: string; ganador_cedula?: string; ganador_email?: string; ganador_telefono?: string })[] {
    if (!this.mayoresRealizados) {
      return [];
    }

    // Ordenar por fecha descendente (más reciente primero) y limitar a los últimos 3
    return [...this.mayoresRealizados]
      .filter(s => !!s.fecha)
      .sort((a, b) => {
        const aDate = new Date(a.fecha as string).getTime();
        const bDate = new Date(b.fecha as string).getTime();
        return bDate - aDate;
      })
      .slice(0, 3);
  }

  /**
   * Formatea una fecha ISO "YYYY-MM-DD" (o con hora) de forma segura para Colombia.
   * Al agregar T12:00:00 se evita el bug de timezone donde new Date("2026-03-15")
   * se interpreta como UTC y muestra un día menos en zonas UTC-N.
   */
  formatDate(fecha: string): string {
    if (!fecha) return '';
    try {
      const normalized = /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? `${fecha}T12:00:00` : fecha;
      return new Date(normalized).toLocaleDateString('es-CO', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });
    } catch {
      return fecha;
    }
  }

  onImgError(event: Event): void {
    const img = event.target as HTMLImageElement;
    if (img) img.src = 'assets/img/premio-mayor.jpg';
  }

  /** URL de imagen para mostrar (corrige localhost en despliegue). */
  imageSrc(imagenUrl: string | null | undefined): string {
    return resolveImageUrl(imagenUrl) || 'assets/img/premio-mayor.jpg';
  }
}
