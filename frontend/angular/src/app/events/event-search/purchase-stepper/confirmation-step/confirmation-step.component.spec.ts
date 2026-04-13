import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

import { ConfirmationStepComponent } from './confirmation-step.component';

describe('ConfirmationStepComponent', () => {
  let component: ConfirmationStepComponent;
  let fixture: ComponentFixture<ConfirmationStepComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NoopAnimationsModule, ConfirmationStepComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ConfirmationStepComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('maskedEmail', 'r***@gmail.com');
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should display masked email', () => {
    const reminder = fixture.nativeElement.querySelector('.email-reminder') as HTMLElement;
    expect(reminder.textContent).toContain('r***@gmail.com');
  });

  it('should not display email reminder when maskedEmail is null', () => {
    fixture.componentRef.setInput('maskedEmail', null);
    fixture.detectChanges();
    const reminder = fixture.nativeElement.querySelector('.email-reminder');
    expect(reminder).toBeNull();
  });

  it('should emit purchaseDone when onDone is called', () => {
    spyOn(component.purchaseDone, 'emit');
    component.onDone();
    expect(component.purchaseDone.emit).toHaveBeenCalled();
  });
});
