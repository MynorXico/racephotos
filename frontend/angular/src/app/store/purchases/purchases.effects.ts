import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import { AppConfigService } from '../../core/config/app-config.service';
import { BankDetails, PurchasesActions } from './purchases.actions';

interface CreateOrderResponse {
  orderId: string;
  paymentRef: string;
  totalAmount: number;
  currency: string;
  bankDetails: BankDetails;
}

@Injectable()
export class PurchasesEffects {
  private readonly actions$ = inject(Actions);
  private readonly http = inject(HttpClient);
  private readonly configService = inject(AppConfigService);

  private get apiBase(): string {
    return this.configService.get().apiBaseUrl;
  }

  /** POST /orders — called when the runner confirms their email in step 1. */
  submitEmail$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PurchasesActions.submitEmail),
      switchMap(({ photoId, runnerEmail }) =>
        this.http
          .post<CreateOrderResponse>(`${this.apiBase}/orders`, {
            photoIds: [photoId],
            runnerEmail,
          })
          .pipe(
            map((res) =>
              PurchasesActions.submitEmailSuccess({
                orderId: res.orderId,
                paymentRef: res.paymentRef,
                totalAmount: res.totalAmount,
                currency: res.currency,
                bankDetails: res.bankDetails,
              }),
            ),
            catchError((err: HttpErrorResponse) =>
              of(
                PurchasesActions.submitEmailFailure({
                  error:
                    (err.error as { error?: string })?.error ??
                    'Something went wrong. Please try again.',
                }),
              ),
            ),
          ),
      ),
    ),
  );
}
