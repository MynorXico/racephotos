import { createActionGroup, emptyProps, props } from '@ngrx/store';

// Stub — implemented in RS-007 (frontend shell) and RS-008 (search page)
export const EventsActions = createActionGroup({
  source: 'Events',
  events: {
    'Load Events': emptyProps(),
    'Load Events Success': props<{ events: unknown[] }>(),
    'Load Events Failure': props<{ error: string }>(),
  },
});
