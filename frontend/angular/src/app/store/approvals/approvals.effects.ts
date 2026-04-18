import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';
import { catchError, map, mergeMap, switchMap, tap } from 'rxjs/operators';

import { AppConfigService } from '../../core/config/app-config.service';
import { ApprovalsActions, PendingPurchase } from './approvals.actions';

@Injectable()
export class ApprovalsEffects {
  private readonly actions$ = inject(Actions);
  private readonly http = inject(HttpClient);
  private readonly configService = inject(AppConfigService);
  private readonly snackBar = inject(MatSnackBar);

  private get apiBase(): string {
    return this.configService.get().apiBaseUrl;
  }

  /** GET /photographer/me/purchases?status=pending — load pending claims.
   * switchMap cancels any in-flight load request when a new one arrives
   * (e.g. rapid retries), preventing stale responses from overwriting fresh data. */
  loadPendingPurchases$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ApprovalsActions.loadPendingPurchases),
      switchMap(() =>
        this.http
          .get<PendingPurchase[]>(
            `${this.apiBase}/photographer/me/purchases?status=pending`,
          )
          .pipe(
            map((purchases) =>
              ApprovalsActions.loadPendingPurchasesSuccess({ purchases }),
            ),
            catchError((err: HttpErrorResponse) =>
              of(
                ApprovalsActions.loadPendingPurchasesFailure({
                  error:
                    (err.error as { error?: string })?.error ??
                    'Failed to load pending approvals',
                }),
              ),
            ),
          ),
      ),
    ),
  );

  /** PUT /purchases/{id}/approve — approve a purchase claim. */
  approvePurchase$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ApprovalsActions.approvePurchase),
      mergeMap(({ purchaseId }) =>
        this.http
          .put<unknown>(`${this.apiBase}/purchases/${purchaseId}/approve`, {})
          .pipe(
            map(() => ApprovalsActions.approvePurchaseSuccess({ purchaseId })),
            catchError((err: HttpErrorResponse) =>
              of(
                ApprovalsActions.approvePurchaseFailure({
                  purchaseId,
                  error:
                    err.status === 409
                      ? 'Purchase is in a terminal state and cannot be approved.'
                      : ((err.error as { error?: string })?.error ??
                        'Failed to approve purchase'),
                }),
              ),
            ),
          ),
      ),
    ),
  );

  /** Show success snackbar after approve. */
  approvePurchaseSuccess$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(ApprovalsActions.approvePurchaseSuccess),
        tap(() => {
          this.snackBar.open(
            'Purchase approved — download link sent to runner.',
            undefined,
            { duration: 5000 },
          );
        }),
      ),
    { dispatch: false },
  );

  /** PUT /purchases/{id}/reject — reject a purchase claim. */
  rejectPurchase$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ApprovalsActions.rejectPurchase),
      mergeMap(({ purchaseId }) =>
        this.http
          .put<unknown>(`${this.apiBase}/purchases/${purchaseId}/reject`, {})
          .pipe(
            map(() => ApprovalsActions.rejectPurchaseSuccess({ purchaseId })),
            catchError((err: HttpErrorResponse) =>
              of(
                ApprovalsActions.rejectPurchaseFailure({
                  purchaseId,
                  error:
                    err.status === 409
                      ? 'Purchase is in a terminal state and cannot be rejected.'
                      : ((err.error as { error?: string })?.error ??
                        'Failed to reject purchase'),
                }),
              ),
            ),
          ),
      ),
    ),
  );

  /** Show success snackbar after reject. */
  rejectPurchaseSuccess$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(ApprovalsActions.rejectPurchaseSuccess),
        tap(() => {
          this.snackBar.open('Purchase rejected.', undefined, { duration: 4000 });
        }),
      ),
    { dispatch: false },
  );
}
