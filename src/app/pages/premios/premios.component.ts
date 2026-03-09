import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Sorteo } from '../../core/services/sorteos.service';
import { resolveImageUrl } from '../../core/services/api-url';

@Component({
  selector: 'app-premios',
  standalone: true,
  imports: [CommonModule],
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
    return this.mayoresRealizados || [];
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

  /** Preferir imagen_base64 (evita HTTP/Mixed Content); si no, usar imagen_url reescrita. */
  imageSrc(sorteo: Sorteo): string {
    if (sorteo?.imagen_base64) return sorteo.imagen_base64;
    return resolveImageUrl(sorteo?.imagen_url) || 'assets/img/premio-mayor.jpg';
  }
}
