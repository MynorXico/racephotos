import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Clipboard } from '@angular/cdk/clipboard';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import { BankDetails } from '../../../../store/purchases/purchases.actions';

@Component({
  selector: 'app-bank-details-step',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatSnackBarModule,
  ],
  templateUrl: './bank-details-step.component.html',
  styleUrl: './bank-details-step.component.scss',
})
export class BankDetailsStepComponent {
  @Input() paymentRef: string | null = null;
  @Input() totalAmount: number | null = null;
  @Input() currency: string | null = null;
  @Input() bankDetails: BankDetails | null = null;

  /** Emitted when the runner clicks "I've made the transfer". */
  @Output() transferConfirmed = new EventEmitter<void>();

  /** Transient signal — true for 1500ms after copying the payment reference. */
  readonly copiedRef = signal(false);
  /** Transient signal — true for 1500ms after copying the account number. */
  readonly copiedAccount = signal(false);

  constructor(
    private readonly clipboard: Clipboard,
    private readonly snackBar: MatSnackBar,
  ) {}

  copyRef(): void {
    if (!this.paymentRef) return;
    this.clipboard.copy(this.paymentRef);
    this.snackBar.open('Reference copied', undefined, { duration: 2000 });
    this.copiedRef.set(true);
    setTimeout(() => this.copiedRef.set(false), 1500);
  }

  copyAccount(): void {
    if (!this.bankDetails?.bankAccountNumber) return;
    this.clipboard.copy(this.bankDetails.bankAccountNumber);
    this.snackBar.open('Copied', undefined, { duration: 2000 });
    this.copiedAccount.set(true);
    setTimeout(() => this.copiedAccount.set(false), 1500);
  }

  onConfirm(): void {
    this.transferConfirmed.emit();
  }

  formatAmount(amount: number | null, currency: string | null): string {
    if (amount === null || !currency) return '';
    return `${currency} ${amount.toFixed(2)}`;
  }
}
