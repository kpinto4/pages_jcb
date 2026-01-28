import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ComoParticiparComponent } from './como-participar.component';

describe('ComoParticiparComponent', () => {
  let component: ComoParticiparComponent;
  let fixture: ComponentFixture<ComoParticiparComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ComoParticiparComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ComoParticiparComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
