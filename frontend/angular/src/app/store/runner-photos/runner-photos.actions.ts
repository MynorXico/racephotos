import { createActionGroup, emptyProps, props } from '@ngrx/store';

export interface RunnerPhoto {
  photoId: string;
  watermarkedUrl: string;
  capturedAt: string | null;
}

export const RunnerPhotosActions = createActionGroup({
  source: 'Runner Photos',
  events: {
    /** Page load or bib clear — fetch first page of all indexed event photos. */
    'Load Event Photos': props<{ eventId: string }>(),
    /** First page of all-event browse loaded. */
    'Load Event Photos Success': props<{ photos: RunnerPhoto[]; nextCursor: string | null; totalCount: number }>(),
    /** All-event browse failed. */
    'Load Event Photos Failure': props<{ error: string }>(),

    /** Runner clicks "Load more" in all-event browse mode. */
    'Load More Event Photos': props<{ eventId: string; cursor: string }>(),
    /** Additional all-event photos appended. */
    'Load More Event Photos Success': props<{ photos: RunnerPhoto[]; nextCursor: string | null }>(),
    /** Load more failed (all-event mode). */
    'Load More Event Photos Failure': props<{ error: string }>(),

    /** Runner submits the bib number search form. */
    'Search By Bib': props<{ eventId: string; bibNumber: string }>(),
    /** API returned matching photos. */
    'Search By Bib Success': props<{ photos: RunnerPhoto[]; nextCursor: string | null; totalCount: number }>(),
    /** API returned an error. */
    'Search By Bib Failure': props<{ error: string }>(),

    /** Runner clicks "Load more" in bib search mode. */
    'Load More Bib Photos': props<{ eventId: string; bibNumber: string; cursor: string }>(),
    /** Additional bib photos appended. */
    'Load More Bib Photos Success': props<{ photos: RunnerPhoto[]; nextCursor: string | null }>(),
    /** Load more failed (bib mode). */
    'Load More Bib Photos Failure': props<{ error: string }>(),

    /** Runner clicks a photo card — opens the detail overlay. */
    'Select Photo': props<{ photoId: string }>(),
    /** Runner closes the detail overlay. */
    'Deselect Photo': emptyProps(),
    /** Component destroyed — reset search state. */
    'Clear Results': emptyProps(),
  },
});
