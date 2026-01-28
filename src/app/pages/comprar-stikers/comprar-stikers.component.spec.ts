import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ComprarStikersComponent } from './comprar-stikers.component';

describe('ComprarStikersComponent', () => {
  let component: ComprarStikersComponent;
  let fixture: ComponentFixture<ComprarStikersComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ComprarStikersComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ComprarStikersComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
