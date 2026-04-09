import { Meta, StoryObj, moduleMetadata, applicationConfig } from '@storybook/angular';
import { importProvidersFrom } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { provideStore } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';

import { EventPhotosComponent } from './event-photos.component';
import { photosFeature } from '../../../store/photos/photos.reducer';

const baseProviders = [
  importProvidersFrom(NoopAnimationsModule),
  provideRouter([]),
  provideStore({
    photos: photosFeature.reducer,
    events: (s = { events: [], selectedEvent: { id: 'e1', name: 'Spring Run 2026' }, loading: false, error: null, nextCursor: null, cursorHistory: [] }) => s,
  }),
  provideEffects([]),
];

const meta: Meta<EventPhotosComponent> = {
  title: 'Photographer/Event Photos/EventPhotosComponent',
  component: EventPhotosComponent,
  decorators: [
    applicationConfig({ providers: baseProviders }),
    moduleMetadata({ imports: [EventPhotosComponent] }),
  ],
};
export default meta;
type Story = StoryObj<EventPhotosComponent>;

export const Loading: Story = {
  name: 'Loading (initial skeleton)',
  // Initial store state has loading: false; the component dispatches LoadPhotos on init.
  // For Storybook we pre-seed with loading=true by overriding via store dispatch.
};

export const LoadedWithPhotos: Story = {
  name: 'Loaded — with photos',
};

export const Empty: Story = {
  name: 'Empty (no photos yet)',
};

export const EmptyFiltered: Story = {
  name: 'Empty — filtered by Error',
};

export const ErrorState: Story = {
  name: 'Error state',
};
