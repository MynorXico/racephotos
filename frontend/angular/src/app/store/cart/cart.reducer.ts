import { createFeature, createReducer, on } from '@ngrx/store';
import { CartActions, PhotoSummary } from './cart.actions';

export interface CartState {
  photoIds: string[];
  eventId: string | null;
  photos: PhotoSummary[];
}

const initialState: CartState = {
  photoIds: [],
  eventId: null,
  photos: [],
};

const cartReducer = createReducer<CartState>(
  initialState,

  on(CartActions.addToCart, (state, { photo }) => ({
    photoIds: [...state.photoIds, photo.id],
    eventId: state.eventId ?? photo.eventId,
    photos: [...state.photos, photo],
  })),

  on(CartActions.removeFromCart, (state, { photoId }) => ({
    ...state,
    photoIds: state.photoIds.filter((id) => id !== photoId),
    photos: state.photos.filter((p) => p.id !== photoId),
  })),

  on(CartActions.clearCart, () => initialState),

  on(CartActions.replaceCart, (_state, { photo }) => ({
    photoIds: [photo.id],
    eventId: photo.eventId,
    photos: [photo],
  })),
);

export const cartFeature = createFeature({
  name: 'cart',
  reducer: cartReducer,
});
