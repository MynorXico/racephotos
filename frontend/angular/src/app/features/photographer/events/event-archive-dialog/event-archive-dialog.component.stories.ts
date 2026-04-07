import type { Meta, StoryObj } from '@storybook/angular';
import { applicationConfig } from '@storybook/angular';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideMockStore } from '@ngrx/store/testing';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';

import { EventArchiveDialogComponent } from './event-archive-dialog.component';
import { initialEventsState } from '../../../../store/events/events.reducer';

const meta: Meta<EventArchiveDialogComponent> = {
  title: 'Photographer/Events/EventArchiveDialog',
  component: EventArchiveDialogComponent,
  decorators: [
    applicationConfig({
      providers: [
        provideAnimationsAsync(),
        provideMockStore({ initialState: { events: initialEventsState } }),
        { provide: MatDialogRef, useValue: { close: (_result?: unknown) => undefined } },
        { provide: MAT_DIALOG_DATA, useValue: { eventId: 'evt-1', eventName: 'Guatemala City Half Marathon 2026' } },
      ],
    }),
  ],
};

export default meta;
type Story = StoryObj<EventArchiveDialogComponent>;

export const Default: Story = {};

export const Loading: Story = {
  decorators: [
    applicationConfig({
      providers: [
        provideAnimationsAsync(),
        provideMockStore({ initialState: { events: { ...initialEventsState, loading: true } } }),
        { provide: MatDialogRef, useValue: { close: (_result?: unknown) => undefined } },
        { provide: MAT_DIALOG_DATA, useValue: { eventId: 'evt-1', eventName: 'Guatemala City Half Marathon 2026' } },
      ],
    }),
  ],
};
