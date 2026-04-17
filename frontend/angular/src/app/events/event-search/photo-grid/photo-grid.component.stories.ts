import { Meta, StoryObj, moduleMetadata } from '@storybook/angular';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideMockStore } from '@ngrx/store/testing';
import { MatDialog } from '@angular/material/dialog';
import { EMPTY } from 'rxjs';

import { RunnerPhotoGridComponent } from './photo-grid.component';
import { RunnerPhoto } from '../../../store/runner-photos/runner-photos.actions';
import {
  selectCartPhotoIds,
  selectCartEventId,
  selectCartCount,
  selectCartFull,
} from '../../../store/cart/cart.selectors';

const makePhotos = (count: number): RunnerPhoto[] =>
  Array.from({ length: count }, (_, i) => ({
    photoId: `photo-${i + 1}`,
    watermarkedUrl: `https://picsum.photos/seed/race${i + 1}/400/300`,
    capturedAt: null,
  }));

const noopDialogSpy = { open: () => ({ afterClosed: () => EMPTY, close: () => {} }) };

const emptyCartSelectors = [
  { selector: selectCartPhotoIds, value: [] },
  { selector: selectCartEventId, value: null },
  { selector: selectCartCount, value: 0 },
  { selector: selectCartFull, value: false },
];

const meta: Meta<RunnerPhotoGridComponent> = {
  title: 'Runner/Photo Search/RunnerPhotoGridComponent',
  component: RunnerPhotoGridComponent,
  decorators: [
    moduleMetadata({
      imports: [NoopAnimationsModule, RunnerPhotoGridComponent],
      providers: [
        provideMockStore({ selectors: emptyCartSelectors }),
        { provide: MatDialog, useValue: noopDialogSpy },
      ],
    }),
  ],
  args: {
    photos: makePhotos(6),
    pricePerPhoto: 12.99,
    currency: 'USD',
    eventId: 'event-1',
    eventName: 'City Marathon 2026',
    searchedBib: '101',
  },
};
export default meta;
type Story = StoryObj<RunnerPhotoGridComponent>;

export const NoSelection: Story = {
  name: 'No selection (toolbar hidden)',
};

export const OneSelected: Story = {
  name: '1 photo selected (toolbar shown)',
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
  name: '20 photos selected (max)',
  decorators: [
    moduleMetadata({
      providers: [
        provideMockStore({
          selectors: [
            { selector: selectCartPhotoIds, value: makePhotos(20).map((p) => p.photoId) },
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
