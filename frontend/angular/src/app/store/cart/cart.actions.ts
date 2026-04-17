import { createActionGroup, emptyProps, props } from '@ngrx/store';

export interface PhotoSummary {
  id: string;
  eventId: string;
  eventName: string;
  watermarkedUrl: string;
  pricePerPhoto: number;
  currency: string;
}

export const CartActions = createActionGroup({
  source: 'Cart',
  events: {
    /** Runner checks a photo checkbox (same event or empty cart). */
    'Add To Cart': props<{ photo: PhotoSummary }>(),
    /** Runner unchecks a photo checkbox. */
    'Remove From Cart': props<{ photoId: string }>(),
    /** Dispatched by PurchaseStepperComponent on submitEmailSuccess. */
    'Clear Cart': emptyProps(),
    /** Runner confirms the cross-event dialog ("Continue"). */
    'Replace Cart': props<{ photo: PhotoSummary }>(),
  },
});
