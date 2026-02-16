import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PaymentService } from '../../core/services/payment.service';

interface SorteoItem {
  id: number;
  nombre: string;
  fecha: string;
  descripcion: string | null;
  tipo: string;
  estado: string;
  premio_descripcion?: string | null;
  numero_ganador_a: string | null;
  numero_ganador_b: string | null;
}

@Component({
  selector: 'app-premios',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './premios.component.html',
  styleUrls: ['./premios.component.scss']
})
export class PremiosComponent implements OnInit {

  sorteos: SorteoItem[] = [];
  loading = true;

  constructor(private paymentService: PaymentService) {}

  ngOnInit(): void {
    this.paymentService.getSorteos().subscribe({
      next: (res) => {
        this.sorteos = res.sorteos || [];
        this.loading = false;
      },
      error: () => {
        this.loading = false;
      }
    });
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
