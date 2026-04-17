import { createSelector } from '@ngrx/store';
import { cartFeature } from './cart.reducer';

export const {
  selectCartState,
  selectPhotoIds: selectCartPhotoIds,
  selectEventId: selectCartEventId,
  selectPhotos: selectCartPhotos,
} = cartFeature;

/** Number of photos currently in the cart. */
export const selectCartCount = createSelector(selectCartPhotoIds, (ids) => ids.length);

/** Sum of pricePerPhoto across all cart photos. */
export const selectCartTotal = createSelector(selectCartPhotos, (photos) =>
  photos.reduce((sum, p) => sum + p.pricePerPhoto, 0),
);

/** ISO 4217 currency of the first photo in the cart, or null when empty. */
export const selectCartCurrency = createSelector(selectCartPhotos, (photos) =>
  photos.length > 0 ? photos[0].currency : null,
);

/** True when the cart has reached the 20-photo maximum. */
export const selectCartFull = createSelector(selectCartCount, (count) => count >= 20);

/**
 * Returns a selector that resolves to true when the given photo ID is in the cart.
 * Usage: store.select(selectIsInCart(photo.id))
 */
export const selectIsInCart = (photoId: string) =>
  createSelector(selectCartPhotoIds, (ids) => ids.includes(photoId));
