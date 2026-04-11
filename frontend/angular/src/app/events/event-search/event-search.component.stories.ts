import { Meta, StoryObj, moduleMetadata, applicationConfig } from '@storybook/angular';
import { importProvidersFrom } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideRouter, ActivatedRoute, convertToParamMap } from '@angular/router';
import { provideStore } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { of } from 'rxjs';

import { EventSearchComponent } from './event-search.component';

const mockRoute: Partial<ActivatedRoute> = {
  paramMap: of(convertToParamMap({ id: 'event-123' })),
};

const mockEvent = {
  id: 'event-123',
  photographerId: 'photographer-1',
  name: 'Spring Marathon 2026',
  date: '2026-06-01',
  location: 'Test City',
  pricePerPhoto: 12.99,
  currency: 'USD',
  watermarkText: 'RaceShots',
  status: 'active' as const,
  visibility: 'public' as const,
  archivedAt: '',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const photos = Array.from({ length: 6 }, (_, i) => ({
  photoId: `photo-${i + 1}`,
  watermarkedUrl: `https://picsum.photos/seed/race${i + 1}/400/300`,
  capturedAt: null,
}));

function baseProviders(
  runnerPhotosOverride: object,
  eventsOverride: object,
) {
  return [
    importProvidersFrom(NoopAnimationsModule),
    provideRouter([]),
    provideStore({
      runnerPhotos: (s = runnerPhotosOverride) => s,
      events: (s = eventsOverride) => s,
    }),
    provideEffects([]),
    { provide: ActivatedRoute, useValue: mockRoute },
  ];
}

const meta: Meta<EventSearchComponent> = {
  title: 'Runner/Photo Search/EventSearchComponent',
  component: EventSearchComponent,
  decorators: [
    moduleMetadata({ imports: [EventSearchComponent] }),
  ],
};
export default meta;
type Story = StoryObj<EventSearchComponent>;

export const InitialState: Story = {
  name: 'Initial — no search yet',
  decorators: [
    applicationConfig({
      providers: baseProviders(
        { photos: [], searchedBib: null, loading: false, error: null, selectedPhotoId: null },
        { events: [], selectedEvent: mockEvent, loading: false, error: null, nextCursor: null, cursorHistory: [] },
      ),
    }),
  ],
};

export const Loading: Story = {
  name: 'Loading (skeleton cards)',
  decorators: [
    applicationConfig({
      providers: baseProviders(
        { photos: [], searchedBib: '101', loading: true, error: null, selectedPhotoId: null },
        { events: [], selectedEvent: mockEvent, loading: false, error: null, nextCursor: null, cursorHistory: [] },
      ),
    }),
  ],
};

export const WithResults: Story = {
  name: 'Results — 6 photos',
  decorators: [
    applicationConfig({
      providers: baseProviders(
        { photos, searchedBib: '101', loading: false, error: null, selectedPhotoId: null },
        { events: [], selectedEvent: mockEvent, loading: false, error: null, nextCursor: null, cursorHistory: [] },
      ),
    }),
  ],
};

export const NoResults: Story = {
  name: 'No results for bib',
  decorators: [
    applicationConfig({
      providers: baseProviders(
        { photos: [], searchedBib: '999', loading: false, error: null, selectedPhotoId: null },
        { events: [], selectedEvent: mockEvent, loading: false, error: null, nextCursor: null, cursorHistory: [] },
      ),
    }),
  ],
};

export const ErrorState: Story = {
  name: 'Error — retry button',
  decorators: [
    applicationConfig({
      providers: baseProviders(
        { photos: [], searchedBib: '101', loading: false, error: 'network_error', selectedPhotoId: null },
        { events: [], selectedEvent: mockEvent, loading: false, error: null, nextCursor: null, cursorHistory: [] },
      ),
    }),
  ],
};

export const EventLoading: Story = {
  name: 'Event header loading',
  decorators: [
    applicationConfig({
      providers: baseProviders(
        { photos: [], searchedBib: null, loading: false, error: null, selectedPhotoId: null },
        { events: [], selectedEvent: null, loading: true, error: null, nextCursor: null, cursorHistory: [] },
      ),
    }),
  ],
};
