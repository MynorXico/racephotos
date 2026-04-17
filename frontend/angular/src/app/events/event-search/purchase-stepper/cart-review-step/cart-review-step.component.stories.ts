import { Meta, StoryObj, moduleMetadata } from '@storybook/angular';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideMockStore } from '@ngrx/store/testing';

import { CartReviewStepComponent } from './cart-review-step.component';
import { PhotoSummary } from '../../../../store/cart/cart.actions';
import {
  selectCartPhotos,
  selectCartTotal,
  selectCartCurrency,
} from '../../../../store/cart/cart.selectors';

const photoA: PhotoSummary = {
  id: 'photo-a',
  eventId: 'event-1',
  eventName: 'City Marathon 2026',
  watermarkedUrl: 'https://picsum.photos/seed/photo-a/400/300',
  pricePerPhoto: 75,
  currency: 'GTQ',
};

const photoB: PhotoSummary = {
  id: 'photo-b',
  eventId: 'event-1',
  eventName: 'City Marathon 2026',
  watermarkedUrl: 'https://picsum.photos/seed/photo-b/400/300',
  pricePerPhoto: 75,
  currency: 'GTQ',
};

const meta: Meta<CartReviewStepComponent> = {
  title: 'Runner/Purchase Flow/CartReviewStepComponent',
  component: CartReviewStepComponent,
  decorators: [
    moduleMetadata({
      imports: [NoopAnimationsModule, CartReviewStepComponent],
    }),
  ],
};
export default meta;
type Story = StoryObj<CartReviewStepComponent>;

export const SinglePhoto: Story = {
  name: '1 photo in cart',
  decorators: [
    moduleMetadata({
      providers: [
        provideMockStore({
          selectors: [
            { selector: selectCartPhotos, value: [photoA] },
            { selector: selectCartTotal, value: 75 },
            { selector: selectCartCurrency, value: 'GTQ' },
          ],
        }),
      ],
    }),
  ],
};

export const MultiplePhotos: Story = {
  name: '2 photos in cart',
  decorators: [
    moduleMetadata({
      providers: [
        provideMockStore({
          selectors: [
            { selector: selectCartPhotos, value: [photoA, photoB] },
            { selector: selectCartTotal, value: 150 },
            { selector: selectCartCurrency, value: 'GTQ' },
          ],
        }),
      ],
    }),
  ],
};

export const Empty: Story = {
  name: 'Empty cart',
  decorators: [
    moduleMetadata({
      providers: [
        provideMockStore({
          selectors: [
            { selector: selectCartPhotos, value: [] },
            { selector: selectCartTotal, value: 0 },
            { selector: selectCartCurrency, value: null },
          ],
        }),
      ],
    }),
  ],
};
