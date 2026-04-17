import { createSelector } from '@ngrx/store';
import { purchasesFeature } from './purchases.reducer';

export const {
  selectPurchasesState,
  selectActivePhotoIds,
  selectRunnerEmail,
  selectOrderId,
  selectPaymentRef,
  selectTotalAmount,
  selectCurrency,
  selectBankDetails,
  selectLoading: selectPurchaseLoading,
  selectError: selectPurchaseError,
} = purchasesFeature;

/**
 * Masks the runner's email so only the first local-part character is visible.
 * Examples: "runner@gmail.com" → "r***@gmail.com"
 *           "ab@example.com"   → "a***@example.com"
 * Returns null when no email is stored.
 */
export const selectMaskedEmail = createSelector(selectRunnerEmail, (email) => {
  if (!email) return null;
  const atIdx = email.indexOf('@');
  if (atIdx <= 0) return email;
  return email[0] + '***' + email.slice(atIdx);
});
