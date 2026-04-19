import type { Meta, StoryObj } from '@storybook/angular';
import { applicationConfig } from '@storybook/angular';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideMockStore } from '@ngrx/store/testing';

import { ReviewQueueComponent } from './review-queue.component';
import { initialReviewQueueState } from '../../../../store/review-queue/review-queue.reducer';
import { ReviewPhoto } from '../../../../store/review-queue/review-queue.actions';

const mockPhotos: ReviewPhoto[] = [
  {
    id: 'photo-1',
    status: 'review_required',
    thumbnailUrl: null,
    bibNumbers: ['101', '202'],
    uploadedAt: '2026-04-01T10:00:00Z',
    errorReason: null,
  },
  {
    id: 'photo-2',
    status: 'error',
    thumbnailUrl: null,
    bibNumbers: [],
    uploadedAt: '2026-04-01T09:30:00Z',
    errorReason: 'Rekognition timeout',
  },
  {
    id: 'photo-3',
    status: 'review_required',
    thumbnailUrl: null,
    bibNumbers: [],
    uploadedAt: '2026-04-01T09:00:00Z',
    errorReason: null,
  },
  {
    id: 'photo-4',
    status: 'review_required',
    thumbnailUrl: null,
    bibNumbers: ['505'],
    uploadedAt: '2026-04-01T08:30:00Z',
    errorReason: null,
  },
  {
    id: 'photo-5',
    status: 'error',
    thumbnailUrl: null,
    bibNumbers: [],
    uploadedAt: '2026-04-01T08:00:00Z',
    errorReason: 'S3 read timeout',
  },
  {
    id: 'photo-6',
    status: 'review_required',
    thumbnailUrl: null,
    bibNumbers: ['303', '404'],
    uploadedAt: '2026-04-01T07:30:00Z',
    errorReason: null,
  },
];

const mockEvent = { id: 'event-1', name: 'Test Race', date: '2026-04-01', status: 'active' };

const meta: Meta<ReviewQueueComponent> = {
  title: 'Photographer/Dashboard/ReviewQueue',
  component: ReviewQueueComponent,
  decorators: [
    applicationConfig({
      providers: [provideAnimationsAsync()],
    }),
  ],
};

export default meta;
type Story = StoryObj<ReviewQueueComponent>;

export const Loading: Story = {
  decorators: [
    applicationConfig({
      providers: [
        provideAnimationsAsync(),
        provideMockStore({
          initialState: {
            reviewQueue: { ...initialReviewQueueState, loading: true },
            events: { selectedEvent: mockEvent },
          },
        }),
      ],
    }),
  ],
};

export const LoadedWithItems: Story = {
  decorators: [
    applicationConfig({
      providers: [
        provideAnimationsAsync(),
        provideMockStore({
          initialState: {
            reviewQueue: {
              ...initialReviewQueueState,
              photos: mockPhotos,
              loading: false,
            },
            events: { selectedEvent: mockEvent },
          },
        }),
      ],
    }),
  ],
};

export const Empty: Story = {
  decorators: [
    applicationConfig({
      providers: [
        provideAnimationsAsync(),
        provideMockStore({
          initialState: {
            reviewQueue: { ...initialReviewQueueState, loading: false, photos: [] },
            events: { selectedEvent: mockEvent },
          },
        }),
      ],
    }),
  ],
};
