import { createActionGroup, emptyProps, props } from '@ngrx/store';

export type PhotoStatus = 'processing' | 'indexed' | 'review_required' | 'error';

export interface Photo {
  id: string;
  status: PhotoStatus;
  thumbnailUrl: string | null;
  bibNumbers: string[];
  uploadedAt: string;
  errorReason: string | null;
}

export const PhotosActions = createActionGroup({
  source: 'Photos',
  events: {
    /** Initial load or reload after filter change. Resets the photos list. */
    'Load Photos': props<{ eventId: string }>(),
    'Load Photos Success': props<{ photos: Photo[]; nextCursor: string | null }>(),
    'Load Photos Failure': props<{ error: string }>(),

    /** Load the next page and append to the existing list. */
    'Load Next Page': props<{ eventId: string; cursor: string }>(),
    'Load Next Page Success': props<{ photos: Photo[]; nextCursor: string | null }>(),
    'Load Next Page Failure': props<{ error: string }>(),

    /** Change the active status filter. Triggers Load Photos after resetting the list. */
    'Filter By Status': props<{ eventId: string; status: PhotoStatus | null }>(),

    /** Reset the slice on navigation away. */
    'Clear Photos': emptyProps(),
  },
});
