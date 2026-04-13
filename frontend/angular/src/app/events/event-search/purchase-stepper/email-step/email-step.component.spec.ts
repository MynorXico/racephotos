import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

import { EmailStepComponent } from './email-step.component';

describe('EmailStepComponent', () => {
  let component: EmailStepComponent;
  let fixture: ComponentFixture<EmailStepComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NoopAnimationsModule, EmailStepComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(EmailStepComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should disable button when email is empty', () => {
    const btn = fixture.nativeElement.querySelector('.confirm-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('should enable button when email is valid', () => {
    component.emailControl.setValue('runner@example.com');
    component.emailControl.markAsDirty();
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('.confirm-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('should show preview card when email is valid and dirty', () => {
    component.emailControl.setValue('runner@example.com');
    component.emailControl.markAsDirty();
    fixture.detectChanges();
    const preview = fixture.nativeElement.querySelector('.preview-card');
    expect(preview).toBeTruthy();
  });

  it('should not show preview when email is invalid', () => {
    component.emailControl.setValue('not-an-email');
    component.emailControl.markAsDirty();
    fixture.detectChanges();
    const preview = fixture.nativeElement.querySelector('.preview-card');
    expect(preview).toBeNull();
  });

  it('should emit emailConfirmed with email on valid submit', () => {
    spyOn(component.emailConfirmed, 'emit');
    component.emailControl.setValue('runner@example.com');
    component.emailControl.markAsDirty();
    component.onConfirm();
    expect(component.emailConfirmed.emit).toHaveBeenCalledWith('runner@example.com');
  });

  it('should not emit emailConfirmed when form is invalid', () => {
    const emitted: string[] = [];
    component.emailConfirmed.subscribe((e) => emitted.push(e));
    component.emailControl.setValue('');
    component.onConfirm();
    expect(emitted).toEqual([]);
  });

  it('should show error card when error input is set', () => {
    fixture.componentRef.setInput('error', 'Something went wrong.');
    fixture.detectChanges();
    const errorCard = fixture.nativeElement.querySelector('.error-card');
    expect(errorCard).toBeTruthy();
  });

  it('should emit errorDismissed when "Try again" is clicked', () => {
    fixture.componentRef.setInput('error', 'Something went wrong.');
    fixture.detectChanges();
    spyOn(component.errorDismissed, 'emit');
    component.onTryAgain();
    expect(component.errorDismissed.emit).toHaveBeenCalled();
  });

  it('should disable email field while loading', () => {
    fixture.componentRef.setInput('loading', true);
    component.ngOnChanges();
    fixture.detectChanges();
    expect(component.emailControl.disabled).toBe(true);
  });
});
