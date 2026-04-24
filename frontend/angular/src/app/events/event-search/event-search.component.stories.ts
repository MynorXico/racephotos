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

function baseState(
  runnerOverride: object,
  eventsOverride: object,
) {
  return [
    importProvidersFrom(NoopAnimationsModule),
    provideRouter([]),
    provideStore({
      runnerPhotos: (s = runnerOverride) => s,
      events: (s = eventsOverride) => s,
    }),
    provideEffects([]),
    { provide: ActivatedRoute, useValue: mockRoute },
  ];
}

const defaultRunnerState = {
  photos: [],
  searchedBib: null,
  loading: false,
  loadingMore: false,
  error: null,
  loadMoreError: null,
  selectedPhotoId: null,
  nextCursor: null,
  totalCount: 0,
  mode: 'all',
};

const defaultEventsState = {
  events: [],
  selectedEvent: mockEvent,
  loading: false,
  error: null,
  nextCursor: null,
  cursorHistory: [],
};

const meta: Meta<EventSearchComponent> = {
  title: 'Runner/Photo Search/EventSearchComponent',
  component: EventSearchComponent,
  decorators: [
    moduleMetadata({ imports: [EventSearchComponent] }),
  ],
};
export default meta;
type Story = StoryObj<EventSearchComponent>;

export const AllEventBrowse: Story = {
  name: 'All-event browse — loaded with counter',
  decorators: [
    applicationConfig({
      providers: baseState(
        { ...defaultRunnerState, photos, totalCount: 150, nextCursor: 'abc123', mode: 'all' },
        defaultEventsState,
      ),
    }),
  ],
};

export const AllEventBrowseLoadMore: Story = {
  name: 'All-event browse — load more visible',
  decorators: [
    applicationConfig({
      providers: baseState(
        { ...defaultRunnerState, photos, totalCount: 150, nextCursor: 'cursor-next', mode: 'all' },
        defaultEventsState,
      ),
    }),
  ],
};

export const EmptyEventNoPhotos: Story = {
  name: 'Empty state — no indexed photos yet (AC7)',
  decorators: [
    applicationConfig({
      providers: baseState(
        { ...defaultRunnerState, photos: [], totalCount: 0, nextCursor: null, mode: 'all' },
        defaultEventsState,
      ),
    }),
  ],
};

export const LoadingSkeleton: Story = {
  name: 'Loading skeleton cards',
  decorators: [
    applicationConfig({
      providers: baseState(
        { ...defaultRunnerState, loading: true, mode: 'all' },
        defaultEventsState,
      ),
    }),
  ],
};

export const BibResultsWithCounter: Story = {
  name: 'Bib results — showing X of Y counter',
  decorators: [
    applicationConfig({
      providers: baseState(
        { ...defaultRunnerState, photos: photos.slice(0, 3), searchedBib: '101', totalCount: 7, nextCursor: null, mode: 'bib' },
        defaultEventsState,
      ),
    }),
  ],
};

export const BibResultsLoadMore: Story = {
  name: 'Bib results — load more visible',
  decorators: [
    applicationConfig({
      providers: baseState(
        { ...defaultRunnerState, photos, searchedBib: '42', totalCount: 30, nextCursor: 'cursor-bib', mode: 'bib' },
        defaultEventsState,
      ),
    }),
  ],
};

export const NoResultsBib: Story = {
  name: 'No results for bib search',
  decorators: [
    applicationConfig({
      providers: baseState(
        { ...defaultRunnerState, photos: [], searchedBib: '999', totalCount: 0, nextCursor: null, mode: 'bib' },
        defaultEventsState,
      ),
    }),
  ],
};

export const ErrorState: Story = {
  name: 'Error — retry button',
  decorators: [
    applicationConfig({
      providers: baseState(
        { ...defaultRunnerState, error: 'network_error', mode: 'all' },
        defaultEventsState,
      ),
    }),
  ],
};

export const EventLoading: Story = {
  name: 'Event header loading',
  decorators: [
    applicationConfig({
      providers: baseState(
        defaultRunnerState,
        { ...defaultEventsState, selectedEvent: null, loading: true },
      ),
    }),
  ],
};

// Legacy stories kept for backwards compatibility
export const InitialState: Story = {
  name: 'Initial — no search yet',
  decorators: [
    applicationConfig({
      providers: baseState(defaultRunnerState, defaultEventsState),
    }),
  ],
};
