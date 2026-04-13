import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Clipboard } from '@angular/cdk/clipboard';
import { MatSnackBar } from '@angular/material/snack-bar';

import { BankDetailsStepComponent } from './bank-details-step.component';
import { BankDetails } from '../../../../store/purchases/purchases.actions';

const sampleBank: BankDetails = {
  bankName: 'Example Bank',
  bankAccountNumber: '1234-5678-9012',
  bankAccountHolder: 'John Doe Photography',
  bankInstructions: '',
};

describe('BankDetailsStepComponent', () => {
  let component: BankDetailsStepComponent;
  let fixture: ComponentFixture<BankDetailsStepComponent>;
  let clipboardSpy: jasmine.SpyObj<Clipboard>;
  let snackBarSpy: jasmine.SpyObj<MatSnackBar>;

  beforeEach(async () => {
    clipboardSpy = jasmine.createSpyObj('Clipboard', ['copy']);
    snackBarSpy = jasmine.createSpyObj('MatSnackBar', ['open']);

    await TestBed.configureTestingModule({
      imports: [NoopAnimationsModule, BankDetailsStepComponent],
      providers: [{ provide: Clipboard, useValue: clipboardSpy }],
    })
      // Override at component level so it wins over MatSnackBarModule's module injector.
      .overrideComponent(BankDetailsStepComponent, {
        set: { providers: [{ provide: MatSnackBar, useValue: snackBarSpy }] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(BankDetailsStepComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('paymentRef', 'RS-AB12CD34');
    fixture.componentRef.setInput('totalAmount', 75);
    fixture.componentRef.setInput('currency', 'GTQ');
    fixture.componentRef.setInput('bankDetails', sampleBank);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should display formatted amount', () => {
    const amount = fixture.nativeElement.querySelector('.amount-text') as HTMLElement;
    expect(amount.textContent?.trim()).toBe('GTQ 75.00');
  });

  it('should display payment reference', () => {
    const ref = fixture.nativeElement.querySelector('.ref-value') as HTMLElement;
    expect(ref.textContent?.trim()).toBe('RS-AB12CD34');
  });

  it('should copy payment reference on click and show snack bar', () => {
    component.copyRef();
    expect(clipboardSpy.copy).toHaveBeenCalledWith('RS-AB12CD34');
    expect(snackBarSpy.open).toHaveBeenCalled();
  });

  it('should copy account number on click', () => {
    component.copyAccount();
    expect(clipboardSpy.copy).toHaveBeenCalledWith('1234-5678-9012');
  });

  it('should not show instructions card when bankInstructions is empty', () => {
    const card = fixture.nativeElement.querySelector('.instructions-card');
    expect(card).toBeNull();
  });

  it('should show instructions card when bankInstructions is set', () => {
    fixture.componentRef.setInput('bankDetails', {
      ...sampleBank,
      bankInstructions: 'Add ref in memo field',
    });
    fixture.detectChanges();
    const card = fixture.nativeElement.querySelector('.instructions-card');
    expect(card).toBeTruthy();
  });

  it('should emit transferConfirmed when onConfirm is called', () => {
    spyOn(component.transferConfirmed, 'emit');
    component.onConfirm();
    expect(component.transferConfirmed.emit).toHaveBeenCalled();
  });

  it('formatAmount returns empty string for null inputs', () => {
    expect(component.formatAmount(null, 'USD')).toBe('');
    expect(component.formatAmount(10, null)).toBe('');
  });
});
