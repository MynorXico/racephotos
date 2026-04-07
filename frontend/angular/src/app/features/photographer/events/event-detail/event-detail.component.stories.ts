import type { Meta, StoryObj } from '@storybook/angular';
import { applicationConfig } from '@storybook/angular';
import { provideRouter } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideMockStore } from '@ngrx/store/testing';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialogModule } from '@angular/material/dialog';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';

import { EventDetailComponent } from './event-detail.component';
import { initialEventsState } from '../../../../store/events/events.reducer';
import { AppConfigService } from '../../../../core/config/app-config.service';
import { Event } from '../event.model';

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

const meta: Meta<EventDetailComponent> = {
  title: 'Photographer/Events/EventDetail',
  component: EventDetailComponent,
  decorators: [
    applicationConfig({
      providers: [
        provideRouter([]),
        provideAnimationsAsync(),
        MatSnackBarModule,
        MatDialogModule,
        { provide: ActivatedRoute, useValue: { paramMap: of(new Map([['id', 'evt-1']])) } },
        { provide: AppConfigService, useValue: { get: () => ({ apiBaseUrl: '', publicBaseUrl: 'https://www.example.com' }) } },
        provideMockStore({
          initialState: {
            events: { ...initialEventsState, selectedEvent: mockEvent },
          },
        }),
      ],
    }),
  ],
};

export default meta;
type Story = StoryObj<EventDetailComponent>;

export const Default: Story = {};

export const Archived: Story = {
  decorators: [
    applicationConfig({
      providers: [
        provideRouter([]),
        provideAnimationsAsync(),
        MatSnackBarModule,
        MatDialogModule,
        { provide: ActivatedRoute, useValue: { paramMap: of(new Map([['id', 'evt-1']])) } },
        { provide: AppConfigService, useValue: { get: () => ({ apiBaseUrl: '', publicBaseUrl: 'https://www.example.com' }) } },
        provideMockStore({
          initialState: {
            events: { ...initialEventsState, selectedEvent: { ...mockEvent, status: 'archived' as const } },
          },
        }),
      ],
    }),
  ],
};

export const Loading: Story = {
  decorators: [
    applicationConfig({
      providers: [
        provideRouter([]),
        provideAnimationsAsync(),
        MatSnackBarModule,
        MatDialogModule,
        { provide: ActivatedRoute, useValue: { paramMap: of(new Map([['id', 'evt-1']])) } },
        { provide: AppConfigService, useValue: { get: () => ({ apiBaseUrl: '', publicBaseUrl: 'https://www.example.com' }) } },
        provideMockStore({
          initialState: {
            events: { ...initialEventsState, loading: true },
          },
        }),
      ],
    }),
  ],
};
