import { createFeature, createReducer, on } from '@ngrx/store';
import { BankDetails, PurchasesActions } from './purchases.actions';

export interface PurchasesState {
  activePhotoIds: string[] | null;
  runnerEmail: string | null;
  orderId: string | null;
  paymentRef: string | null;
  totalAmount: number | null;
  currency: string | null;
  bankDetails: BankDetails | null;
  loading: boolean;
  error: string | null;
}

const initialState: PurchasesState = {
  activePhotoIds: null,
  runnerEmail: null,
  orderId: null,
  paymentRef: null,
  totalAmount: null,
  currency: null,
  bankDetails: null,
  loading: false,
  error: null,
};

const purchasesReducer = createReducer<PurchasesState>(
  initialState,

  on(PurchasesActions.initiatePurchase, (_state, { photoIds }) => ({
    ...initialState,
    activePhotoIds: photoIds,
  })),

  on(PurchasesActions.submitEmail, (state, { runnerEmail }) => ({
    ...state,
    runnerEmail,
    loading: true,
    error: null,
  })),

  on(
    PurchasesActions.submitEmailSuccess,
    (state, { orderId, paymentRef, totalAmount, currency, bankDetails }) => ({
      ...state,
      loading: false,
      orderId,
      paymentRef,
      totalAmount,
      currency,
      bankDetails,
    }),
  ),

  on(PurchasesActions.submitEmailFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  on(PurchasesActions.resetPurchase, () => initialState),
);

export const purchasesFeature = createFeature({
  name: 'purchases',
  reducer: purchasesReducer,
});
