import type { Meta, StoryObj } from '@storybook/angular';
import { fn } from '@storybook/test';
import { provideAnimations } from '@angular/platform-browser/animations';

import { EventCardComponent } from './event-card.component';
import { PublicEvent } from '../../../features/photographer/events/event.model';

const baseEvent: PublicEvent = {
  id: 'evt-001',
  name: 'Springfield Spring Marathon',
  date: '2026-05-01',
  location: 'City Park, Springfield',
  createdAt: '2026-04-01T10:00:00Z',
};

const meta: Meta<EventCardComponent> = {
  title: 'Home/EventCard',
  component: EventCardComponent,
  decorators: [
    (storyFn) => {
      const story = storyFn();
      return {
        ...story,
        applicationConfig: {
          providers: [provideAnimations()],
        },
      };
    },
  ],
  render: (args) => ({
    props: args,
    template: `
      <div style="width: 360px; padding: 16px;">
        <app-event-card [event]="event" (cardClick)="cardClick($event)" />
      </div>
    `,
  }),
  args: {
    cardClick: fn(),
  },
  argTypes: {
    event: { control: 'object' },
    cardClick: { action: 'cardClick' },
  },
};

export default meta;
type Story = StoryObj<EventCardComponent>;

/** Default — typical event with realistic data. */
export const Default: Story = {
  args: { event: baseEvent },
};

/** LongEventName — name exceeds two lines, verifies ellipsis clamp. */
export const LongEventName: Story = {
  args: {
    event: {
      ...baseEvent,
      name: 'The 42nd Annual International Springfield City Park Charity Fun Run & Marathon 2026',
    },
  },
};

/** LongLocation — location exceeds one line, verifies single-line ellipsis. */
export const LongLocation: Story = {
  args: {
    event: {
      ...baseEvent,
      location: 'Riverfront Promenade, West Side District, Downtown Springfield, IL, USA',
    },
  },
};

/** PastEvent — date is in the past; no special styling expected in v1. */
export const PastEvent: Story = {
  args: {
    event: {
      ...baseEvent,
      name: 'Winter Race 2025',
      date: '2025-01-15',
      location: 'Lakefront Park',
    },
  },
};
