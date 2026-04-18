import { createActionGroup, emptyProps, props } from '@ngrx/store';

export interface PendingPurchase {
  purchaseId: string;
  photoId: string;
  eventId: string;
  eventName: string;
  runnerEmail: string; // masked: r***@domain.com
  paymentRef: string;
  claimedAt: string; // ISO 8601
  watermarkedUrl: string; // CloudFront URL of the watermarked thumbnail
}

export const ApprovalsActions = createActionGroup({
  source: 'Approvals',
  events: {
    /** ApprovalsTabComponent.ngOnInit() — fetch pending purchase claims for the photographer. */
    'Load Pending Purchases': emptyProps(),
    /** Effect receives 200 from GET /photographer/me/purchases?status=pending. */
    'Load Pending Purchases Success': props<{ purchases: PendingPurchase[] }>(),
    /** Effect receives non-200 from the list endpoint. */
    'Load Pending Purchases Failure': props<{ error: string }>(),

    /** User confirms Approve in the confirmation dialog. */
    'Approve Purchase': props<{ purchaseId: string }>(),
    /** Effect receives 200 from PUT /purchases/{id}/approve. */
    'Approve Purchase Success': props<{ purchaseId: string }>(),
    /** Effect receives non-200 from the approve endpoint. */
    'Approve Purchase Failure': props<{ purchaseId: string; error: string }>(),

    /** User confirms Reject in the confirmation dialog. */
    'Reject Purchase': props<{ purchaseId: string }>(),
    /** Effect receives 200 from PUT /purchases/{id}/reject. */
    'Reject Purchase Success': props<{ purchaseId: string }>(),
    /** Effect receives non-200 from the reject endpoint. */
    'Reject Purchase Failure': props<{ purchaseId: string; error: string }>(),
  },
});
