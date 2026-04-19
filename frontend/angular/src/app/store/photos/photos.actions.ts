import { createActionGroup, emptyProps, props } from '@ngrx/store';

/** Real DynamoDB status values — never assign 'in_progress' to a Photo object. */
export type PhotoStatus = 'processing' | 'watermarking' | 'indexed' | 'review_required' | 'error';

/**
 * Extends PhotoStatus with virtual filter aliases accepted by the list-event-photos API.
 * 'in_progress' is a server-side aggregate for processing + watermarking (RS-018).
 * Use this type for filter state and API parameters, not for Photo.status.
 */
export type PhotoStatusFilter = PhotoStatus | 'in_progress';

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
    'Filter By Status': props<{ eventId: string; status: PhotoStatusFilter | null }>(),

    /** Reset the slice on navigation away. */
    'Clear Photos': emptyProps(),

    /** Patch a single photo in the list without a full reload (e.g. after bib re-tag). */
    'Upsert Photo': props<{ photo: Photo }>(),
  },
});
