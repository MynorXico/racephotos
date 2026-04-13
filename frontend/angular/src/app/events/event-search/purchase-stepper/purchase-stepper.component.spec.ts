import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Subject, EMPTY } from 'rxjs';
import { Action } from '@ngrx/store';
import { Clipboard } from '@angular/cdk/clipboard';
import { MatSnackBar } from '@angular/material/snack-bar';

import { PurchaseStepperComponent } from './purchase-stepper.component';
import { PurchasesActions } from '../../../store/purchases/purchases.actions';
import {
  selectPurchaseLoading,
  selectPurchaseError,
  selectMaskedEmail,
  selectActivePhotoId,
  selectPaymentRef,
  selectTotalAmount,
  selectCurrency,
  selectBankDetails,
} from '../../../store/purchases/purchases.selectors';

describe('PurchaseStepperComponent', () => {
  let component: PurchaseStepperComponent;
  let fixture: ComponentFixture<PurchaseStepperComponent>;
  let store: MockStore;
  let actions$: Subject<Action>;
  let dialogRef: jasmine.SpyObj<MatDialogRef<PurchaseStepperComponent>>;

  beforeEach(async () => {
    actions$ = new Subject<Action>();
    dialogRef = jasmine.createSpyObj('MatDialogRef', ['close', 'backdropClick', 'afterClosed']);
    dialogRef.backdropClick.and.returnValue(EMPTY);
    dialogRef.afterClosed.and.returnValue(EMPTY);

    await TestBed.configureTestingModule({
      imports: [NoopAnimationsModule, PurchaseStepperComponent],
      providers: [
        provideMockStore({
          selectors: [
            { selector: selectPurchaseLoading, value: false },
            { selector: selectPurchaseError, value: null },
            { selector: selectMaskedEmail, value: 'r***@gmail.com' },
            { selector: selectActivePhotoId, value: 'photo-1' },
            { selector: selectPaymentRef, value: 'RS-AB12CD34' },
            { selector: selectTotalAmount, value: 75 },
            { selector: selectCurrency, value: 'GTQ' },
            { selector: selectBankDetails, value: null },
          ],
        }),
        provideMockActions(() => actions$),
        { provide: MAT_DIALOG_DATA, useValue: { photoId: 'photo-1' } },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: Clipboard, useValue: jasmine.createSpyObj('Clipboard', ['copy']) },
        { provide: MatSnackBar, useValue: jasmine.createSpyObj('MatSnackBar', ['open']) },
      ],
    }).compileComponents();

    store = TestBed.inject(MockStore);
    fixture = TestBed.createComponent(PurchaseStepperComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should dispatch submitEmail when email is confirmed', () => {
    const dispatchSpy = spyOn(store, 'dispatch');
    component.onEmailConfirmed('runner@example.com');
    expect(dispatchSpy).toHaveBeenCalledWith(
      PurchasesActions.submitEmail({ photoId: 'photo-1', runnerEmail: 'runner@example.com' }),
    );
  });

  it('should dispatch confirmTransfer when transfer is confirmed', () => {
    const dispatchSpy = spyOn(store, 'dispatch');
    component.onTransferConfirmed();
    expect(dispatchSpy).toHaveBeenCalledWith(PurchasesActions.confirmTransfer());
  });

  it('should dispatch resetPurchase when close is clicked', () => {
    const dispatchSpy = spyOn(store, 'dispatch');
    component.onClose();
    expect(dispatchSpy).toHaveBeenCalledWith(PurchasesActions.resetPurchase());
  });

  it('should dispatch resetPurchase when done is clicked', () => {
    const dispatchSpy = spyOn(store, 'dispatch');
    component.onDone();
    expect(dispatchSpy).toHaveBeenCalledWith(PurchasesActions.resetPurchase());
  });
});
