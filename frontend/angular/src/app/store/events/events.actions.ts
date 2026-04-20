import { createActionGroup, props } from '@ngrx/store';
import {
  CreateEventRequest,
  Event,
  UpdateEventRequest,
} from '../../features/photographer/events/event.model';

export const EventsActions = createActionGroup({
  source: 'Events',
  events: {
    /** Load the photographer's event list, optionally resuming from a cursor. */
    'Load Events': props<{ cursor?: string }>(),
    'Load Events Success': props<{ events: Event[]; nextCursor: string | null }>(),
    'Load Events Failure': props<{ error: string }>(),

    /** Load a single event by ID. */
    'Load Event': props<{ id: string }>(),
    'Load Event Success': props<{ event: Event }>(),
    'Load Event Failure': props<{ error: string }>(),

    /** Create a new event. */
    'Create Event': props<{ event: CreateEventRequest }>(),
    'Create Event Success': props<{ event: Event }>(),
    'Create Event Failure': props<{ error: string }>(),

    /** Update an existing event. */
    'Update Event': props<{ id: string; event: UpdateEventRequest }>(),
    'Update Event Success': props<{ event: Event }>(),
    'Update Event Failure': props<{ error: string }>(),

    /** Archive an event (moves it out of the public listing). */
    'Archive Event': props<{ id: string }>(),
    'Archive Event Success': props<{ event: Event }>(),
    'Archive Event Failure': props<{ error: string }>(),

    /** Navigate to the previous page using the cursor history stack (UX-D1). */
    'Load Events Previous Page': props<Record<string, never>>(),

    /** Set the active event context without triggering an API call. */
    'Select Event': props<{ event: Event }>(),
  },
});
