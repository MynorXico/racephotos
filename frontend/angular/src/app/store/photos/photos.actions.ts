import { createActionGroup, emptyProps, props } from '@ngrx/store';

// Stub — implemented in RS-008 (search page)
export const PhotosActions = createActionGroup({
  source: 'Photos',
  events: {
    'Search By Bib': props<{ eventId: string; bibNumber: string }>(),
    'Search Success': props<{ photos: unknown[] }>(),
    'Search Failure': props<{ error: string }>(),
    'Clear Results': emptyProps(),
  },
});
