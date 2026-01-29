import { Routes } from '@angular/router';
import { HomeComponent } from './pages/home/home.component';
import { ComprarStikersComponent } from './pages/comprar-stikers/comprar-stikers.component';
import { VerificarBoletaComponent } from './pages/verificar-boleta/verificar-boleta.component';
import { AdminComponent } from './pages/admin/admin.component';

export const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'comprar-stikers', component: ComprarStikersComponent },
  { path: 'verificar-boleta', component: VerificarBoletaComponent },
  { path: 'admin', component: AdminComponent },
];
