import type { Meta, StoryObj } from '@storybook/angular';
import { applicationConfig } from '@storybook/angular';
import { provideRouter } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideMockStore } from '@ngrx/store/testing';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';

import { EventEditComponent } from './event-edit.component';
import { initialEventsState } from '../../../../store/events/events.reducer';
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

const meta: Meta<EventEditComponent> = {
  title: 'Photographer/Events/EventEdit',
  component: EventEditComponent,
  decorators: [
    applicationConfig({
      providers: [
        provideRouter([]),
        provideAnimationsAsync(),
        MatSnackBarModule,
        { provide: ActivatedRoute, useValue: { paramMap: of(new Map([['id', 'evt-1']])) } },
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
type Story = StoryObj<EventEditComponent>;

export const Default: Story = {};

export const Submitting: Story = {
  decorators: [
    applicationConfig({
      providers: [
        provideRouter([]),
        provideAnimationsAsync(),
        MatSnackBarModule,
        { provide: ActivatedRoute, useValue: { paramMap: of(new Map([['id', 'evt-1']])) } },
        provideMockStore({
          initialState: {
            events: { ...initialEventsState, loading: true, selectedEvent: mockEvent },
          },
        }),
      ],
    }),
  ],
};
