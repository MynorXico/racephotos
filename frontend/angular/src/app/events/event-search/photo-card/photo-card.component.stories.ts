import { Meta, StoryObj, moduleMetadata } from '@storybook/angular';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideMockStore } from '@ngrx/store/testing';
import { MatDialog } from '@angular/material/dialog';
import { EMPTY } from 'rxjs';

import { RunnerPhotoCardComponent } from './photo-card.component';
import { RunnerPhoto } from '../../../store/runner-photos/runner-photos.actions';
import {
  selectCartPhotoIds,
  selectCartEventId,
  selectCartCount,
  selectCartFull,
} from '../../../store/cart/cart.selectors';

const basePhoto: RunnerPhoto = {
  photoId: 'photo-1',
  watermarkedUrl: 'https://picsum.photos/seed/racephotos/400/300',
  capturedAt: '2026-06-01T09:30:00Z',
};

// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = (): void => {};
const noopDialogSpy = { open: () => ({ afterClosed: () => EMPTY, close: noop }) };

const emptyCartSelectors = [
  { selector: selectCartPhotoIds, value: [] },
  { selector: selectCartEventId, value: null },
  { selector: selectCartCount, value: 0 },
  { selector: selectCartFull, value: false },
];

const meta: Meta<RunnerPhotoCardComponent> = {
  title: 'Runner/Photo Search/RunnerPhotoCardComponent',
  component: RunnerPhotoCardComponent,
  decorators: [
    moduleMetadata({
      imports: [NoopAnimationsModule, RunnerPhotoCardComponent],
      providers: [
        provideMockStore({ selectors: emptyCartSelectors }),
        { provide: MatDialog, useValue: noopDialogSpy },
      ],
    }),
  ],
  args: {
    photo: basePhoto,
    pricePerPhoto: 12.99,
    currency: 'USD',
    eventId: 'event-1',
    eventName: 'City Marathon 2026',
    searchedBib: '101',
  },
};
export default meta;
type Story = StoryObj<RunnerPhotoCardComponent>;

export const Default: Story = {
  name: 'Default (unchecked)',
};

export const Selected: Story = {
  name: 'Selected (in cart)',
  decorators: [
    moduleMetadata({
      providers: [
        provideMockStore({
          selectors: [
            { selector: selectCartPhotoIds, value: ['photo-1'] },
            { selector: selectCartEventId, value: 'event-1' },
            { selector: selectCartCount, value: 1 },
            { selector: selectCartFull, value: false },
          ],
        }),
        { provide: MatDialog, useValue: noopDialogSpy },
      ],
    }),
  ],
};

export const MaxReached: Story = {
  name: 'Max reached (checkbox disabled)',
  decorators: [
    moduleMetadata({
      providers: [
        provideMockStore({
          selectors: [
            { selector: selectCartPhotoIds, value: [] },
            { selector: selectCartEventId, value: 'event-1' },
            { selector: selectCartCount, value: 20 },
            { selector: selectCartFull, value: true },
          ],
        }),
        { provide: MatDialog, useValue: noopDialogSpy },
      ],
    }),
  ],
};

export const ImageError: Story = {
  name: 'Image load error',
  args: {
    photo: { ...basePhoto, watermarkedUrl: 'https://broken.example.com/photo.jpg' },
  },
  play: async ({ canvasElement }) => {
    const img = canvasElement.querySelector<HTMLImageElement>('img');
    img?.dispatchEvent(new Event('error'));
  },
};
