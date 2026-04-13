import { createActionGroup, emptyProps, props } from '@ngrx/store';

export interface BankDetails {
  bankName: string;
  bankAccountNumber: string;
  bankAccountHolder: string;
  bankInstructions: string;
}

export interface SubmitEmailSuccessPayload {
  orderId: string;
  paymentRef: string;
  totalAmount: number;
  currency: string;
  bankDetails: BankDetails;
}

export const PurchasesActions = createActionGroup({
  source: 'Purchases',
  events: {
    /** Runner clicks "Purchase this photo" in PhotoDetailComponent. */
    'Initiate Purchase': props<{ photoId: string }>(),
    /** Runner confirms email in step 1 — triggers POST /orders. */
    'Submit Email': props<{ photoId: string; runnerEmail: string }>(),
    /** Effect receives 201/200 from POST /orders. */
    'Submit Email Success': props<SubmitEmailSuccessPayload>(),
    /** Effect receives 4xx/5xx from POST /orders. */
    'Submit Email Failure': props<{ error: string }>(),
    /** Runner clicks "I've made the transfer" in step 2. */
    'Confirm Transfer': emptyProps(),
    /** Dialog closed (any step) — resets all purchase state. */
    'Reset Purchase': emptyProps(),
  },
});
