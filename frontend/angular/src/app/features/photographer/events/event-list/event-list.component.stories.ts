import type { Meta, StoryObj } from '@storybook/angular';
import { applicationConfig } from '@storybook/angular';
import { provideRouter } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideMockStore } from '@ngrx/store/testing';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialogModule } from '@angular/material/dialog';

import { EventListComponent } from './event-list.component';
import { initialEventsState } from '../../../../store/events/events.reducer';
import { Event } from '../event.model';

const mockEvent: Event = {
  id: 'evt-1',
  photographerId: 'user-1',
  name: 'Guatemala City Half Marathon 2026',
  date: '2026-04-06',
  location: 'Guatemala City, GT',
  pricePerPhoto: 5,
  currency: 'GTQ',
  watermarkText: 'Guatemala City Half Marathon 2026 · racephotos.example.com',
  status: 'active',
  visibility: 'public',
  archivedAt: '',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const meta: Meta<EventListComponent> = {
  title: 'Photographer/Events/EventList',
  component: EventListComponent,
  decorators: [
    applicationConfig({
      providers: [
        provideRouter([]),
        provideAnimationsAsync(),
        MatSnackBarModule,
        MatDialogModule,
        provideMockStore({ initialState: { events: initialEventsState } }),
      ],
    }),
  ],
};

export default meta;
type Story = StoryObj<EventListComponent>;

export const Loading: Story = {
  decorators: [
    applicationConfig({
      providers: [
        provideRouter([]),
        provideAnimationsAsync(),
        provideMockStore({ initialState: { events: { ...initialEventsState, loading: true } } }),
      ],
    }),
  ],
};

export const Empty: Story = {
  decorators: [
    applicationConfig({
      providers: [
        provideRouter([]),
        provideAnimationsAsync(),
        provideMockStore({ initialState: { events: { ...initialEventsState, loading: false, events: [] } } }),
      ],
    }),
  ],
};

export const Populated: Story = {
  decorators: [
    applicationConfig({
      providers: [
        provideRouter([]),
        provideAnimationsAsync(),
        provideMockStore({
          initialState: {
            events: {
              ...initialEventsState,
              loading: false,
              events: [
                mockEvent,
                { ...mockEvent, id: 'evt-2', name: 'Spring 5K', status: 'archived' as const },
              ],
            },
          },
        }),
      ],
    }),
  ],
};

export const Error: Story = {
  decorators: [
    applicationConfig({
      providers: [
        provideRouter([]),
        provideAnimationsAsync(),
        provideMockStore({
          initialState: {
            events: {
              ...initialEventsState,
              loading: false,
              error: 'Failed to load events',
            },
          },
        }),
      ],
    }),
  ],
};
