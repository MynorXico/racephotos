import { createSelector } from '@ngrx/store';
import { approvalsFeature } from './approvals.reducer';

export const {
  selectApprovalsState,
  selectPendingPurchases,
  selectLoading: selectApprovalsLoading,
  selectError: selectApprovalsError,
  selectActionLoading: selectActionLoadingMap,
  selectActionError: selectActionErrorMap,
} = approvalsFeature;

/** Returns true if the approve/reject action is in-flight for the given purchaseId. */
export const selectActionLoading = (purchaseId: string) =>
  createSelector(selectActionLoadingMap, (map) => map[purchaseId] ?? false);

/** Returns the action error string for the given purchaseId, or null if none. */
export const selectActionError = (purchaseId: string) =>
  createSelector(selectActionErrorMap, (map) => map[purchaseId] ?? null);
