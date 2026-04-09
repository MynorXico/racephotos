import { createActionGroup, emptyProps, props } from '@ngrx/store';

// Stub — implemented in RS-009 (runner bib search page)
export const RunnerPhotosActions = createActionGroup({
  source: 'Runner Photos',
  events: {
    'Search By Bib': props<{ eventId: string; bibNumber: string }>(),
    'Search Success': props<{ photos: unknown[] }>(),
    'Search Failure': props<{ error: string }>(),
    'Clear Results': emptyProps(),
  },
});
