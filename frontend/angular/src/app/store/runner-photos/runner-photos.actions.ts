import { createActionGroup, emptyProps, props } from '@ngrx/store';

export interface RunnerPhoto {
  photoId: string;
  watermarkedUrl: string;
  capturedAt: string | null;
}

export const RunnerPhotosActions = createActionGroup({
  source: 'Runner Photos',
  events: {
    /** Runner submits the bib number search form. */
    'Search By Bib': props<{ eventId: string; bibNumber: string }>(),
    /** API returned matching photos. */
    'Search By Bib Success': props<{ photos: RunnerPhoto[] }>(),
    /** API returned an error. */
    'Search By Bib Failure': props<{ error: string }>(),
    /** Runner clicks a photo card — opens the detail overlay. */
    'Select Photo': props<{ photoId: string }>(),
    /** Runner closes the detail overlay. */
    'Deselect Photo': emptyProps(),
    /** Component destroyed — reset search state. */
    'Clear Results': emptyProps(),
  },
});
