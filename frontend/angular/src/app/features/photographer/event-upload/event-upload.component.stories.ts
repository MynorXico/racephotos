import type { Meta, StoryObj } from '@storybook/angular';
import { applicationConfig } from '@storybook/angular';
import { provideRouter } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideMockStore } from '@ngrx/store/testing';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';

import { EventUploadComponent } from './event-upload.component';
import { initialPhotoUploadState } from '../../../store/photo-upload/photo-upload.reducer';
import { initialEventsState } from '../../../store/events/events.reducer';
import { AppConfigService } from '../../../core/config/app-config.service';
import { NavigationTitleService } from '../../../core/services/navigation-title.service';
import { Event } from '../events/event.model';
import { FailedFile } from '../../../store/photo-upload/photo-upload.actions';

const mockEvent: Event = {
  id: 'evt-1',
  photographerId: 'user-1',
  name: 'Guatemala City Half Marathon 2026',
  date: '2026-04-06',
  location: 'Guatemala City, GT',
  pricePerPhoto: 39,
  currency: 'GTQ',
  watermarkText: 'Guatemala City Half Marathon 2026 · racephotos.example.com',
  status: 'active',
  visibility: 'public',
  archivedAt: '',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const mockFailedFile = (name: string, errorMessage: string): FailedFile => ({
  file: new File([], name, { type: 'image/jpeg' }),
  errorMessage,
});

function baseProviders(uploadState: object, eventsState?: object) {
  return [
    provideRouter([]),
    provideAnimationsAsync(),
    {
      provide: ActivatedRoute,
      useValue: { paramMap: of(new Map([['id', 'evt-1']])) },
    },
    {
      provide: AppConfigService,
      useValue: { get: () => ({ apiBaseUrl: '' }) },
    },
    {
      provide: NavigationTitleService,
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      useValue: { setTitle: () => {} },
    },
    provideMockStore({
      initialState: {
        events: eventsState ?? { ...initialEventsState, selectedEvent: mockEvent },
        photoUpload: uploadState,
      },
    }),
  ];
}

const meta: Meta<EventUploadComponent> = {
  title: 'Photographer/EventUpload',
  component: EventUploadComponent,
};

export default meta;
type Story = StoryObj<EventUploadComponent>;

/** Drop zone ready — photographer has not yet selected any files. */
export const Idle: Story = {
  decorators: [
    applicationConfig({
      providers: baseProviders(initialPhotoUploadState),
    }),
  ],
};

/** Upload in progress — 37 of 120 photos have been PUT to S3. */
export const Uploading: Story = {
  decorators: [
    applicationConfig({
      providers: baseProviders({
        ...initialPhotoUploadState,
        total: 120,
        uploaded: 37,
        failed: [],
        inProgress: true,
      }),
    }),
  ],
};

/** Session ended with 3 failures — partial-failure panel + failed files list. */
export const PartialFailure: Story = {
  decorators: [
    applicationConfig({
      providers: baseProviders({
        ...initialPhotoUploadState,
        total: 120,
        uploaded: 115,
        failed: [
          mockFailedFile('IMG_1234.jpg', 'Network error: upload timed out'),
          mockFailedFile('IMG_1235.jpg', 'Server error: 503 Service Unavailable'),
          mockFailedFile('IMG_1236.jpg', 'Network error: connection reset'),
        ],
        inProgress: false,
      }),
    }),
  ],
};

/** All 120 photos uploaded successfully. */
export const Complete: Story = {
  decorators: [
    applicationConfig({
      providers: baseProviders({
        ...initialPhotoUploadState,
        total: 120,
        uploaded: 120,
        failed: [],
        inProgress: false,
      }),
    }),
  ],
};

/** Presign API call failed — error banner shown above the drop zone. */
export const PresignError: Story = {
  decorators: [
    applicationConfig({
      providers: baseProviders({
        ...initialPhotoUploadState,
        presignError: 'Could not request upload URLs. 403 Forbidden.',
        inProgress: false,
      }),
    }),
  ],
};
