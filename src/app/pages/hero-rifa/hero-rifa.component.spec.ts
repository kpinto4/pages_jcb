import { ComponentFixture, TestBed } from '@angular/core/testing';

import { HeroRifaComponent } from './hero-rifa.component';

describe('HeroRifaComponent', () => {
  let component: HeroRifaComponent;
  let fixture: ComponentFixture<HeroRifaComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HeroRifaComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(HeroRifaComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
