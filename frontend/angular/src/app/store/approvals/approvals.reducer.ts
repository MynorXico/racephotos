import { createFeature, createReducer, on } from '@ngrx/store';
import { ApprovalsActions, PendingPurchase } from './approvals.actions';

export interface ApprovalsState {
  pendingPurchases: PendingPurchase[];
  loading: boolean;
  error: string | null;
  /** Per-row action loading state — keyed by purchaseId. */
  actionLoading: Record<string, boolean>;
  /** Per-row action error — keyed by purchaseId, null when no error. */
  actionError: Record<string, string | null>;
}

export const initialApprovalsState: ApprovalsState = {
  pendingPurchases: [],
  loading: false,
  error: null,
  actionLoading: {},
  actionError: {},
};

export const approvalsFeature = createFeature({
  name: 'approvals',
  reducer: createReducer<ApprovalsState>(
    initialApprovalsState,

    // ── Load Pending Purchases ──────────────────────────────────────────────
    on(ApprovalsActions.loadPendingPurchases, (state) => ({
      ...state,
      loading: true,
      error: null,
    })),

    on(ApprovalsActions.loadPendingPurchasesSuccess, (state, { purchases }) => ({
      ...state,
      loading: false,
      pendingPurchases: purchases,
    })),

    on(ApprovalsActions.loadPendingPurchasesFailure, (state, { error }) => ({
      ...state,
      loading: false,
      error,
    })),

    // ── Approve Purchase ────────────────────────────────────────────────────
    on(ApprovalsActions.approvePurchase, (state, { purchaseId }) => ({
      ...state,
      actionLoading: { ...state.actionLoading, [purchaseId]: true },
      actionError: { ...state.actionError, [purchaseId]: null },
    })),

    on(ApprovalsActions.approvePurchaseSuccess, (state, { purchaseId }) => ({
      ...state,
      pendingPurchases: state.pendingPurchases.filter((p) => p.purchaseId !== purchaseId),
      actionLoading: { ...state.actionLoading, [purchaseId]: false },
      actionError: { ...state.actionError, [purchaseId]: null },
    })),

    on(ApprovalsActions.approvePurchaseFailure, (state, { purchaseId, error }) => ({
      ...state,
      actionLoading: { ...state.actionLoading, [purchaseId]: false },
      actionError: { ...state.actionError, [purchaseId]: error },
    })),

    // ── Reject Purchase ─────────────────────────────────────────────────────
    on(ApprovalsActions.rejectPurchase, (state, { purchaseId }) => ({
      ...state,
      actionLoading: { ...state.actionLoading, [purchaseId]: true },
      actionError: { ...state.actionError, [purchaseId]: null },
    })),

    on(ApprovalsActions.rejectPurchaseSuccess, (state, { purchaseId }) => ({
      ...state,
      pendingPurchases: state.pendingPurchases.filter((p) => p.purchaseId !== purchaseId),
      actionLoading: { ...state.actionLoading, [purchaseId]: false },
      actionError: { ...state.actionError, [purchaseId]: null },
    })),

    on(ApprovalsActions.rejectPurchaseFailure, (state, { purchaseId, error }) => ({
      ...state,
      actionLoading: { ...state.actionLoading, [purchaseId]: false },
      actionError: { ...state.actionError, [purchaseId]: error },
    })),
  ),
});
