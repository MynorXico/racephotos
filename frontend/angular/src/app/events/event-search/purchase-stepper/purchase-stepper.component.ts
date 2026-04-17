import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
  ViewChild,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatStepperModule, MatStepper } from '@angular/material/stepper';
import { Store } from '@ngrx/store';
import { Actions, ofType } from '@ngrx/effects';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { toSignal } from '@angular/core/rxjs-interop';

import { PurchasesActions } from '../../../store/purchases/purchases.actions';
import { CartActions } from '../../../store/cart/cart.actions';
import {
  selectMaskedEmail,
  selectPurchaseLoading,
  selectPurchaseError,
  selectPaymentRef,
  selectTotalAmount,
  selectCurrency,
  selectBankDetails,
} from '../../../store/purchases/purchases.selectors';
import { selectCartPhotoIds } from '../../../store/cart/cart.selectors';
import { CartReviewStepComponent } from './cart-review-step/cart-review-step.component';
import { EmailStepComponent } from './email-step/email-step.component';
import { BankDetailsStepComponent } from './bank-details-step/bank-details-step.component';
import { ConfirmationStepComponent } from './confirmation-step/confirmation-step.component';

export interface PurchaseStepperDialogData {
  photoIds: string[];
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
    CartReviewStepComponent,
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
  readonly paymentRef = toSignal(this.store.select(selectPaymentRef), { initialValue: null });
  readonly totalAmount = toSignal(this.store.select(selectTotalAmount), { initialValue: null });
  readonly currency = toSignal(this.store.select(selectCurrency), { initialValue: null });
  readonly bankDetails = toSignal(this.store.select(selectBankDetails), { initialValue: null });
  readonly cartPhotoIds = toSignal(this.store.select(selectCartPhotoIds), {
    initialValue: [] as string[],
  });

  private readonly destroy$ = new Subject<void>();

  ngOnInit(): void {
    const advanceStepper = () => {
      if (this.stepper) {
        const current = this.stepper.steps.get(this.stepper.selectedIndex);
        if (current) current.completed = true;
        this.stepper.next();
        this.cdr.markForCheck();
      }
    };

    // Advance to step 2 (bank details) when email submission succeeds.
    // Also clear the cart here — cart is only cleared on successful order.
    this.actions$
      .pipe(ofType(PurchasesActions.submitEmailSuccess), takeUntil(this.destroy$))
      .subscribe(() => {
        this.store.dispatch(CartActions.clearCart());
        advanceStepper();
      });

    // Advance to step 3 (confirmation) when runner confirms transfer.
    this.actions$
      .pipe(ofType(PurchasesActions.confirmTransfer), takeUntil(this.destroy$))
      .subscribe(advanceStepper);

    // Close dialog when resetPurchase is dispatched.
    this.actions$
      .pipe(ofType(PurchasesActions.resetPurchase), takeUntil(this.destroy$))
      .subscribe(() => this.dialogRef.close());

    // Wire backdrop clicks to resetPurchase (cart NOT cleared on backdrop dismiss).
    this.dialogRef
      .backdropClick()
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.store.dispatch(PurchasesActions.resetPurchase()));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** Cart review step emits "continue" — advance to email step. */
  onCartReviewContinue(): void {
    if (this.stepper) {
      const current = this.stepper.steps.get(this.stepper.selectedIndex);
      if (current) current.completed = true;
      this.stepper.next();
      this.cdr.markForCheck();
    }
  }

  /** Cart review step emits "editCart" — close dialog without clearing cart. */
  onEditCart(): void {
    this.dialogRef.close();
  }

  onEmailConfirmed(runnerEmail: string): void {
    const photoIds = this.cartPhotoIds();
    this.store.dispatch(PurchasesActions.submitEmail({ photoIds, runnerEmail }));
  }

  onErrorDismissed(): void {
    const photoIds = this.cartPhotoIds();
    this.store.dispatch(PurchasesActions.initiatePurchase({ photoIds }));
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
