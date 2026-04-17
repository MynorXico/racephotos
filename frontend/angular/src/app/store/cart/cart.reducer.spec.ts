import { CartActions, PhotoSummary } from './cart.actions';
import { cartFeature, CartState } from './cart.reducer';

const reducer = cartFeature.reducer;

const photoA: PhotoSummary = {
  id: 'photo-a',
  eventId: 'event-1',
  eventName: 'Race 2026',
  watermarkedUrl: 'https://cdn.example.com/a.jpg',
  pricePerPhoto: 75,
  currency: 'GTQ',
};

const photoB: PhotoSummary = {
  id: 'photo-b',
  eventId: 'event-1',
  eventName: 'Race 2026',
  watermarkedUrl: 'https://cdn.example.com/b.jpg',
  pricePerPhoto: 75,
  currency: 'GTQ',
};

const photoOtherEvent: PhotoSummary = {
  id: 'photo-c',
  eventId: 'event-2',
  eventName: 'Other Race',
  watermarkedUrl: 'https://cdn.example.com/c.jpg',
  pricePerPhoto: 50,
  currency: 'USD',
};

const emptyState: CartState = { photoIds: [], eventId: null, photos: [] };

describe('cart reducer', () => {
  it('returns the initial state', () => {
    const state = reducer(undefined, { type: '@@INIT' } as never);
    expect(state).toEqual(emptyState);
  });

  describe('addToCart', () => {
    it('adds a photo to an empty cart', () => {
      const state = reducer(emptyState, CartActions.addToCart({ photo: photoA }));
      expect(state.photoIds).toEqual(['photo-a']);
      expect(state.photos).toEqual([photoA]);
      expect(state.eventId).toBe('event-1');
    });

    it('adds a second photo from the same event', () => {
      const withA = reducer(emptyState, CartActions.addToCart({ photo: photoA }));
      const state = reducer(withA, CartActions.addToCart({ photo: photoB }));
      expect(state.photoIds).toEqual(['photo-a', 'photo-b']);
      expect(state.photos).toHaveSize(2);
      expect(state.eventId).toBe('event-1');
    });

    it('is idempotent — adding the same photo twice keeps cart size at 1', () => {
      const withA = reducer(emptyState, CartActions.addToCart({ photo: photoA }));
      const state = reducer(withA, CartActions.addToCart({ photo: photoA }));
      expect(state.photoIds).toHaveSize(1);
      expect(state.photos).toHaveSize(1);
    });
  });

  describe('removeFromCart', () => {
    it('removes the specified photo', () => {
      const withAB = reducer(
        reducer(emptyState, CartActions.addToCart({ photo: photoA })),
        CartActions.addToCart({ photo: photoB }),
      );
      const state = reducer(withAB, CartActions.removeFromCart({ photoId: 'photo-a' }));
      expect(state.photoIds).toEqual(['photo-b']);
      expect(state.photos).toEqual([photoB]);
    });

    it('preserves eventId when one photo remains', () => {
      const withA = reducer(emptyState, CartActions.addToCart({ photo: photoA }));
      const withAB = reducer(withA, CartActions.addToCart({ photo: photoB }));
      const state = reducer(withAB, CartActions.removeFromCart({ photoId: 'photo-a' }));
      expect(state.eventId).toBe('event-1');
    });

    it('resets eventId to null when the last photo is removed', () => {
      const withA = reducer(emptyState, CartActions.addToCart({ photo: photoA }));
      const state = reducer(withA, CartActions.removeFromCart({ photoId: 'photo-a' }));
      expect(state.photoIds).toHaveSize(0);
      expect(state.eventId).toBeNull();
    });

    it('no-ops when the photo is not in the cart', () => {
      const withA = reducer(emptyState, CartActions.addToCart({ photo: photoA }));
      const state = reducer(withA, CartActions.removeFromCart({ photoId: 'not-there' }));
      expect(state.photoIds).toEqual(['photo-a']);
    });
  });

  describe('clearCart', () => {
    it('resets the cart to empty', () => {
      const withA = reducer(emptyState, CartActions.addToCart({ photo: photoA }));
      const state = reducer(withA, CartActions.clearCart());
      expect(state).toEqual(emptyState);
    });

    it('is a no-op on an empty cart', () => {
      const state = reducer(emptyState, CartActions.clearCart());
      expect(state).toEqual(emptyState);
    });
  });

  describe('replaceCart', () => {
    it('replaces the cart with a single new photo', () => {
      const withA = reducer(emptyState, CartActions.addToCart({ photo: photoA }));
      const state = reducer(withA, CartActions.replaceCart({ photo: photoOtherEvent }));
      expect(state.photoIds).toEqual(['photo-c']);
      expect(state.photos).toEqual([photoOtherEvent]);
      expect(state.eventId).toBe('event-2');
    });

    it('replaces multiple photos', () => {
      const withAB = reducer(
        reducer(emptyState, CartActions.addToCart({ photo: photoA })),
        CartActions.addToCart({ photo: photoB }),
      );
      const state = reducer(withAB, CartActions.replaceCart({ photo: photoOtherEvent }));
      expect(state.photoIds).toHaveSize(1);
      expect(state.eventId).toBe('event-2');
    });
  });
});
