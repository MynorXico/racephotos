import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Inject,
  OnDestroy,
  OnInit,
  ViewChild,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatStepperModule, MatStepper } from '@angular/material/stepper';
import { Store } from '@ngrx/store';
import { Actions, ofType } from '@ngrx/effects';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { toSignal } from '@angular/core/rxjs-interop';

import { PurchasesActions } from '../../../store/purchases/purchases.actions';
import {
  selectActivePhotoId,
  selectMaskedEmail,
  selectPurchaseLoading,
  selectPurchaseError,
  selectPaymentRef,
  selectTotalAmount,
  selectCurrency,
  selectBankDetails,
} from '../../../store/purchases/purchases.selectors';
import { EmailStepComponent } from './email-step/email-step.component';
import { BankDetailsStepComponent } from './bank-details-step/bank-details-step.component';
import { ConfirmationStepComponent } from './confirmation-step/confirmation-step.component';

export interface PurchaseStepperDialogData {
  photoId: string;
}

@Component({
  selector: 'app-purchase-stepper',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatStepperModule,
    EmailStepComponent,
    BankDetailsStepComponent,
    ConfirmationStepComponent,
  ],
  templateUrl: './purchase-stepper.component.html',
  styleUrl: './purchase-stepper.component.scss',
})
export class PurchaseStepperComponent implements OnInit, OnDestroy {
  @ViewChild('stepper') stepper!: MatStepper;

  private readonly store = inject(Store);
  private readonly actions$ = inject(Actions);
  private readonly dialogRef = inject<MatDialogRef<PurchaseStepperComponent>>(MatDialogRef);
  private readonly cdr = inject(ChangeDetectorRef);

  readonly loading = toSignal(this.store.select(selectPurchaseLoading), { initialValue: false });
  readonly error = toSignal(this.store.select(selectPurchaseError), { initialValue: null });
  readonly maskedEmail = toSignal(this.store.select(selectMaskedEmail), { initialValue: null });
  readonly activePhotoId = toSignal(this.store.select(selectActivePhotoId), { initialValue: null });
  readonly paymentRef = toSignal(this.store.select(selectPaymentRef), { initialValue: null });
  readonly totalAmount = toSignal(this.store.select(selectTotalAmount), { initialValue: null });
  readonly currency = toSignal(this.store.select(selectCurrency), { initialValue: null });
  readonly bankDetails = toSignal(this.store.select(selectBankDetails), { initialValue: null });

  private readonly destroy$ = new Subject<void>();

  constructor(@Inject(MAT_DIALOG_DATA) public readonly data: PurchaseStepperDialogData) {}

  ngOnInit(): void {
    // MatStepper (linear mode) blocks next() unless the current step is marked
    // completed — set it before calling next(), then trigger OnPush re-render.
    // steps.get() avoids the array allocation of toArray()[index].
    const advanceStepper = () => {
      if (this.stepper) {
        const current = this.stepper.steps.get(this.stepper.selectedIndex);
        if (current) current.completed = true;
        this.stepper.next();
        this.cdr.markForCheck();
      }
    };

    // Advance to step 2 when the email submission succeeds.
    this.actions$
      .pipe(ofType(PurchasesActions.submitEmailSuccess), takeUntil(this.destroy$))
      .subscribe(advanceStepper);

    // Advance to step 3 when the runner confirms the transfer.
    this.actions$
      .pipe(ofType(PurchasesActions.confirmTransfer), takeUntil(this.destroy$))
      .subscribe(advanceStepper);

    // Close the dialog when resetPurchase is dispatched.
    this.actions$
      .pipe(ofType(PurchasesActions.resetPurchase), takeUntil(this.destroy$))
      .subscribe(() => this.dialogRef.close());

    // Wire backdrop clicks to resetPurchase.
    this.dialogRef
      .backdropClick()
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.store.dispatch(PurchasesActions.resetPurchase()));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onEmailConfirmed(runnerEmail: string): void {
    const photoId = this.activePhotoId() ?? this.data.photoId;
    this.store.dispatch(PurchasesActions.submitEmail({ photoId, runnerEmail }));
  }

  onErrorDismissed(): void {
    // Re-dispatch initiatePurchase to clear error state without losing photoId.
    const photoId = this.activePhotoId() ?? this.data.photoId;
    this.store.dispatch(PurchasesActions.initiatePurchase({ photoId }));
  }

  onTransferConfirmed(): void {
    this.store.dispatch(PurchasesActions.confirmTransfer());
  }

  onDone(): void {
    this.store.dispatch(PurchasesActions.resetPurchase());
  }

  onClose(): void {
    this.store.dispatch(PurchasesActions.resetPurchase());
  }
}
