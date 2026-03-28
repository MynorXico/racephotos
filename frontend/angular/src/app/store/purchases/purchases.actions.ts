import { createActionGroup, emptyProps, props } from '@ngrx/store';

// Stub — implemented in RS-009 (purchase flow)
export const PurchasesActions = createActionGroup({
  source: 'Purchases',
  events: {
    'Initiate Purchase': props<{ photoId: string }>(),
    'Initiate Purchase Success': props<{ purchaseId: string }>(),
    'Initiate Purchase Failure': props<{ error: string }>(),
    'Load My Purchases': emptyProps(),
    'Load My Purchases Success': props<{ purchases: unknown[] }>(),
    'Load My Purchases Failure': props<{ error: string }>(),
  },
});
