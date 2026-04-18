import { Component, inject, OnInit } from '@angular/core';
import { AsyncPipe, DatePipe } from '@angular/common';
import { Store } from '@ngrx/store';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';

import { ApprovalsActions, PendingPurchase } from '../../../../store/approvals/approvals.actions';
import {
  selectActionError,
  selectActionLoading,
  selectApprovalsError,
  selectApprovalsLoading,
  selectPendingPurchases,
} from '../../../../store/approvals/approvals.selectors';
import {
  ConfirmationDialogComponent,
  ConfirmationDialogData,
} from '../../../../shared/confirmation-dialog/confirmation-dialog.component';

@Component({
  selector: 'app-approvals-tab',
  standalone: true,
  imports: [
    AsyncPipe,
    DatePipe,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTableModule,
  ],
  templateUrl: './approvals-tab.component.html',
  styleUrl: './approvals-tab.component.scss',
})
export class ApprovalsTabComponent implements OnInit {
  private readonly store = inject(Store);
  private readonly dialog = inject(MatDialog);
  private readonly breakpointObserver = inject(BreakpointObserver);

  readonly pendingPurchases$ = this.store.select(selectPendingPurchases);
  readonly loading$ = this.store.select(selectApprovalsLoading);
  readonly error$ = this.store.select(selectApprovalsError);

  readonly isMobile = toSignal(
    this.breakpointObserver
      .observe([Breakpoints.XSmall, Breakpoints.Small])
      .pipe(map((result) => result.matches)),
    { initialValue: false },
  );

  readonly displayedColumns = ['photo', 'event', 'runner', 'paymentRef', 'claimedAt', 'actions'];

  readonly skeletonRows = [1, 2, 3];

  ngOnInit(): void {
    this.store.dispatch(ApprovalsActions.loadPendingPurchases());
  }

  isActionLoading(purchaseId: string): boolean {
    let loading = false;
    this.store
      .select(selectActionLoading(purchaseId))
      .subscribe((v) => (loading = v))
      .unsubscribe();
    return loading;
  }

  getActionError(purchaseId: string): string | null {
    let error: string | null = null;
    this.store
      .select(selectActionError(purchaseId))
      .subscribe((v) => (error = v))
      .unsubscribe();
    return error;
  }

  onRetry(): void {
    this.store.dispatch(ApprovalsActions.loadPendingPurchases());
  }

  onApprove(purchase: PendingPurchase): void {
    const ref = this.dialog.open(ConfirmationDialogComponent, {
      data: {
        title: 'Approve this purchase?',
        message: `The runner will receive a download link by email. Payment reference: ${purchase.paymentRef}`,
        confirmLabel: 'Approve',
        cancelLabel: 'Cancel',
        confirmVariant: 'primary',
      } satisfies ConfirmationDialogData,
      width: '400px',
      maxWidth: '100vw',
    });
    ref.afterClosed().subscribe((confirmed: boolean | undefined) => {
      if (confirmed) {
        this.store.dispatch(ApprovalsActions.approvePurchase({ purchaseId: purchase.purchaseId }));
      }
    });
  }

  onReject(purchase: PendingPurchase): void {
    const ref = this.dialog.open(ConfirmationDialogComponent, {
      data: {
        title: 'Reject this purchase?',
        message:
          'The purchase claim will be marked as rejected. No email is sent to the runner.',
        confirmLabel: 'Reject',
        cancelLabel: 'Cancel',
        confirmVariant: 'warn',
      } satisfies ConfirmationDialogData,
      width: '400px',
      maxWidth: '100vw',
    });
    ref.afterClosed().subscribe((confirmed: boolean | undefined) => {
      if (confirmed) {
        this.store.dispatch(ApprovalsActions.rejectPurchase({ purchaseId: purchase.purchaseId }));
      }
    });
  }
}
