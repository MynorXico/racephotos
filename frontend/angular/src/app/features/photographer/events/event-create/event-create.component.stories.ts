import type { Meta, StoryObj } from '@storybook/angular';
import { applicationConfig } from '@storybook/angular';
import { provideRouter } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideMockStore } from '@ngrx/store/testing';
import { MatSnackBarModule } from '@angular/material/snack-bar';

import { EventCreateComponent } from './event-create.component';
import { initialEventsState } from '../../../../store/events/events.reducer';
import { initialPhotographerState } from '../../../../store/photographer/photographer.state';

const meta: Meta<EventCreateComponent> = {
  title: 'Photographer/Events/EventCreate',
  component: EventCreateComponent,
  decorators: [
    applicationConfig({
      providers: [
        provideRouter([]),
        provideAnimationsAsync(),
        MatSnackBarModule,
        provideMockStore({
          initialState: {
            events: initialEventsState,
            photographer: initialPhotographerState,
          },
        }),
      ],
    }),
  ],
};

export default meta;
type Story = StoryObj<EventCreateComponent>;

export const Default: Story = {};

export const Submitting: Story = {
  decorators: [
    applicationConfig({
      providers: [
        provideRouter([]),
        provideAnimationsAsync(),
        provideMockStore({
          initialState: {
            events: { ...initialEventsState, loading: true },
            photographer: initialPhotographerState,
          },
        }),
      ],
    }),
  ],
};
